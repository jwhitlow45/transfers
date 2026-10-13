import type { PatternRow } from '../schedule.ts';
import type { PatternTrips } from './timetable.ts';

// RAPTOR (Delling, Pajor and Werneck, "Round-Based Public Transit Routing", 2012): round k finds
// the earliest the rider can reach each stop with k vehicles, by riding every pattern from the
// stops the last round reached, then walking on to stops nearby. Each round from the first that
// reaches the end sooner than the rounds before gives one journey: the fastest for that many
// vehicles. Walking all the way is the planner's to offer, timed straight there rather than by
// way of stops, so round 0 gives no journey, and leaves out none that is slower than walking.

// A stop with the seconds it takes to walk between it and where the rider starts or ends.
export type Access = { stop: number; seconds: number };

// What the router reads, so it knows nothing of how the timetable is stored or kept live.
export type Network = {
  stopCount: number;
  patternsAt: (stop: number) => readonly { pattern: PatternRow; position: number }[];
  // The trips of a pattern on each service date loaded, in lists in which none overtakes another
  // (see patternTrips), each in the order they leave.
  trips: (pattern: PatternRow) => PatternTrips[];
  // A trip's arrival or departure at a position, live where the feed predicts it, or null where it
  // does not stop or has already gone.
  arrival: (trips: PatternTrips, trip: number, position: number) => number | null;
  departure: (trips: PatternTrips, trip: number, position: number) => number | null;
  // Stops a short walk away, with the seconds the walk and any station stairs take.
  footpaths: (stop: number) => Access[];
  // Seconds to change vehicles without leaving the stop.
  changeSeconds: number;
};

export type RideLeg = { kind: 'ride'; trips: PatternTrips; trip: number; board: number; alight: number; from: number; to: number; departs: number; arrives: number };
export type WalkLeg = { kind: 'walk'; from: number; to: number; seconds: number };
export type Path = { rides: number; start: Access; end: Access; legs: (RideLeg | WalkLeg)[]; arrives: number };

// How the rider reached a stop in a round: by starting there, or off a vehicle.
type Arrival = { kind: 'start'; access: Access } | { kind: 'ride'; trips: PatternTrips; trip: number; board: number; alight: number; from: number };
// How the rider came to be ready to board at a stop in a round: by staying where they arrived,
// or walking there from where they did.
type Readiness = { kind: 'stay' } | { kind: 'walk'; from: number; seconds: number };

// What a round found: when the rider can arrive at each stop, which is what the end and the walks
// on from it count from, and when they can be ready to board there, which the next round counts
// from. Off a vehicle, the two differ by the moment a change takes, so a walk that arrives later
// can still have the rider ready sooner.
type Round = { arrived: Float64Array; arrivals: Map<number, Arrival>; ready: Float64Array; readiness: Map<number, Readiness> };

// Trips run late more often than early: a trip due this long before the rider is ready may still
// be catchable, and one due this long after the best found cannot beat it.
const LATE_SECONDS = 3600;
const EARLY_SECONDS = 600;

// The fastest way to the end for each number of vehicles from one up to `maxRides` that arrives
// sooner than any with fewer, fewest first, setting off at `leaveAt` and arriving before `latest`.
export function raptor(network: Network, starts: Access[], ends: Access[], leaveAt: number, maxRides: number, latest = Infinity): Path[] {
  // The soonest the rider has arrived at each stop, and been ready to board there, in any round
  // so far, which a later round, with a vehicle more, has to beat. A vehicle that gets somewhere
  // after a walk did is no use, as walking on from where that walk set off serves as well.
  const bestArrived = new Float64Array(network.stopCount).fill(Infinity);
  const bestReady = new Float64Array(network.stopCount).fill(Infinity);
  const rounds: Round[] = [];
  const endAt = new Map<number, number>();
  for (const end of ends) endAt.set(end.stop, Math.min(endAt.get(end.stop) ?? Infinity, end.seconds));
  let bound = latest;
  const paths: Path[] = [];

  // Round 0: walking to the first stops.
  let round = newRound();
  const started: number[] = [];
  for (const access of starts) {
    const at = leaveAt + access.seconds;
    if (at >= round.arrived[access.stop]!) continue;
    if (round.arrived[access.stop] === Infinity) started.push(access.stop);
    round.arrived[access.stop] = at;
    bestArrived[access.stop] = at;
    round.arrivals.set(access.stop, { kind: 'start', access });
  }
  let marked = getReady(round, started);
  rounds.push(round);

  for (let k = 1; k <= maxRides && marked.size > 0; k++) {
    const previous = round;
    round = newRound();
    // Each pattern from the first of its stops the last round reached.
    const queue = new Map<PatternRow, number>();
    for (const stop of marked) {
      for (const { pattern, position } of network.patternsAt(stop)) queue.set(pattern, Math.min(queue.get(pattern) ?? Infinity, position));
    }
    const rode: number[] = [];
    // Each list of a pattern's trips on its own, as the first of one to leave a stop may reach the
    // next after a trip of another. Live times can still put a trip behind the next in its own
    // list, which the router does not look for.
    for (const [pattern, from] of queue) {
      const stops = pattern.stops;
      for (const trips of network.trips(pattern)) {
        let ride: { trips: PatternTrips; trip: number; board: number; from: number } | null = null;
        for (let position = from; position < stops.length; position++) {
          const stop = stops[position]!;
          let now = Infinity;
          if (ride) {
            const arrives = network.arrival(trips, ride.trip, position);
            if (arrives !== null && arrives < Math.min(bestArrived[stop]!, bound)) {
              if (round.arrived[stop] === Infinity) rode.push(stop);
              round.arrived[stop] = arrives;
              bestArrived[stop] = arrives;
              round.arrivals.set(stop, { kind: 'ride', ...ride, alight: position });
            }
            // A trip that skips the stop keeps the rider aboard: with no time there, it cannot be
            // weighed against one boarded there.
            const departs = network.departure(trips, ride.trip, position);
            if (departs === null) continue;
            now = departs;
          }
          const ready = previous.ready[stop]!;
          if (position === stops.length - 1 || ready === Infinity || ready > now) continue;
          const earlier = earliest(network, trips, position, ready, now);
          if (earlier !== null) ride = { trips, trip: earlier, board: position, from: stop };
        }
      }
    }
    marked = getReady(round, rode);
    rounds.push(round);
    bound = Math.min(bound, record(k));
  }
  return paths;

  function newRound(): Round {
    const empty = () => new Float64Array(network.stopCount).fill(Infinity);
    return { arrived: empty(), arrivals: new Map(), ready: empty(), readiness: new Map() };
  }

  // When the rider can board at the stops the round reached, and those a short walk on: changing
  // where a vehicle let them off takes a moment, while a walk counts its own time. Returns the
  // stops where that is sooner than before, for the next round to board at.
  function getReady({ arrived, arrivals, ready, readiness }: Round, reached: number[]) {
    const marked = new Set<number>();
    const offer = (stop: number, at: number, how: Readiness) => {
      if (at >= Math.min(bestReady[stop]!, bound)) return;
      ready[stop] = at;
      bestReady[stop] = at;
      readiness.set(stop, how);
      marked.add(stop);
    };
    for (const stop of reached) {
      offer(stop, arrived[stop]! + (arrivals.get(stop)!.kind === 'ride' ? network.changeSeconds : 0), { kind: 'stay' });
      for (const path of network.footpaths(stop)) {
        const at = arrived[stop]! + path.seconds;
        offer(path.stop, at, { kind: 'walk', from: stop, seconds: path.seconds });
        bestArrived[path.stop] = Math.min(bestArrived[path.stop]!, at);
      }
    }
    return marked;
  }

  // The journey this round makes, when it reaches the end sooner than any before. Returns when.
  function record(k: number) {
    const { arrived, ready } = rounds[k]!;
    let arrives = Infinity;
    let end: Access | null = null;
    for (const [stop, seconds] of endAt) {
      // Staying where a vehicle let the rider off never has them ready before they arrive, so the
      // sooner of the two is a ride or a walk there.
      const at = Math.min(arrived[stop]!, ready[stop]!) + seconds;
      if (at < arrives) {
        arrives = at;
        end = { stop, seconds };
      }
    }
    if (!end || arrives >= bound) return Infinity;
    paths.push(trace(k, end, arrives));
    return arrives;
  }

  // Back from the end: how the rider arrived at each stop in a round, and before that, how they
  // got ready to board where the round's vehicle picked them up.
  function trace(k: number, end: Access, arrives: number): Path {
    const legs: (RideLeg | WalkLeg)[] = [];
    // Where the rider got ready at `stop` in a round from: there, or where a walk set off.
    const readyFrom = (round: number, stop: number) => {
      const how = rounds[round]!.readiness.get(stop)!;
      if (how.kind === 'stay') return stop;
      legs.unshift({ kind: 'walk', from: how.from, to: stop, seconds: how.seconds });
      return how.from;
    };
    let stop = rounds[k]!.ready[end.stop]! < rounds[k]!.arrived[end.stop]! ? readyFrom(k, end.stop) : end.stop;
    for (let round = k; ; round--) {
      const step = rounds[round]!.arrivals.get(stop)!;
      if (step.kind === 'start') return { rides: k, start: step.access, end, legs, arrives };
      legs.unshift({
        kind: 'ride',
        trips: step.trips,
        trip: step.trip,
        board: step.board,
        alight: step.alight,
        from: step.from,
        to: stop,
        departs: network.departure(step.trips, step.trip, step.board)!,
        arrives: network.arrival(step.trips, step.trip, step.alight)!,
      });
      stop = readyFrom(round - 1, step.from);
    }
  }
}

// The trip of a list that leaves a position soonest at or after `ready`, if before `before`.
function earliest(network: Network, trips: PatternTrips, position: number, ready: number, before: number) {
  const width = trips.pattern.stops.length * 2;
  const scheduled = (trip: number) => trips.times[trip * width + position * 2 + 1]!;
  // The first trip scheduled to leave no more than LATE_SECONDS before the rider is ready.
  let low = 0;
  let high = trips.keys.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (scheduled(middle) < ready - LATE_SECONDS) low = middle + 1;
    else high = middle;
  }
  let found: { trip: number; departs: number } | null = null;
  for (let trip = low; trip < trips.keys.length; trip++) {
    const soonest = Math.min(before, found?.departs ?? Infinity);
    if (scheduled(trip) > soonest + EARLY_SECONDS) break;
    const departs = network.departure(trips, trip, position);
    if (departs === null || departs < ready || departs >= soonest) continue;
    found = { trip, departs };
  }
  return found?.trip ?? null;
}
