import type { PatternRow } from '../schedule.ts';
import type { PatternTrips } from './timetable.ts';

// RAPTOR (Delling, Pajor and Werneck, "Round-Based Public Transit Routing", 2012): round k finds
// the earliest the rider can reach each stop with k vehicles, by riding every pattern from the
// stops the last round reached, then walking on to stops nearby. Each round that reaches the end
// sooner than the rounds before gives one journey: the fastest for that many vehicles.

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

type Label =
  | { kind: 'start'; access: Access }
  | { kind: 'walk'; from: number; seconds: number }
  | { kind: 'ride'; trips: PatternTrips; trip: number; board: number; alight: number; from: number };

// Trips run late more often than early: a trip due this long before the rider is ready may still
// be catchable, and one due this long after the best found cannot beat it.
const LATE_SECONDS = 3600;
const EARLY_SECONDS = 600;

// The fastest way to the end for each number of vehicles up to `maxRides` that arrives sooner than
// any with fewer, fewest first, setting off at `leaveAt` and arriving before `latest`.
export function raptor(network: Network, starts: Access[], ends: Access[], leaveAt: number, maxRides: number, latest = Infinity): Path[] {
  const best = new Float64Array(network.stopCount).fill(Infinity);
  const rounds: Float64Array[] = [];
  const labels: Map<number, Label>[] = [];
  const endAt = new Map<number, number>();
  for (const end of ends) endAt.set(end.stop, Math.min(endAt.get(end.stop) ?? Infinity, end.seconds));
  let bound = latest;
  const paths: Path[] = [];

  // Round 0: walking to the first stops.
  let current = new Float64Array(network.stopCount).fill(Infinity);
  let label = new Map<number, Label>();
  let marked = new Set<number>();
  for (const access of starts) {
    const at = leaveAt + access.seconds;
    if (at >= current[access.stop]!) continue;
    current[access.stop] = at;
    best[access.stop] = at;
    label.set(access.stop, { kind: 'start', access });
    marked.add(access.stop);
  }
  walk(network, current, best, label, marked, [...marked], bound);
  rounds.push(current);
  labels.push(label);
  bound = Math.min(bound, record(0));

  for (let k = 1; k <= maxRides && marked.size > 0; k++) {
    const previous = current;
    const previousLabel = label;
    current = new Float64Array(network.stopCount).fill(Infinity);
    label = new Map();
    // Each pattern from the first of its stops the last round reached.
    const queue = new Map<PatternRow, number>();
    for (const stop of marked) {
      for (const { pattern, position } of network.patternsAt(stop)) queue.set(pattern, Math.min(queue.get(pattern) ?? Infinity, position));
    }
    const rode: number[] = [];
    marked = new Set();
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
            if (arrives !== null && arrives < Math.min(best[stop]!, bound)) {
              current[stop] = arrives;
              best[stop] = arrives;
              label.set(stop, { kind: 'ride', ...ride, alight: position });
              if (!marked.has(stop)) rode.push(stop);
              marked.add(stop);
            }
            // A trip that skips the stop keeps the rider aboard: with no time there, it cannot be
            // weighed against one boarded there.
            const departs = network.departure(trips, ride.trip, position);
            if (departs === null) continue;
            now = departs;
          }
          if (position === stops.length - 1 || previous[stop] === Infinity) continue;
          // Changing at the stop the last vehicle let the rider off at takes a moment. A walk
          // there already counts the time.
          const ready = previous[stop]! + (previousLabel.get(stop)?.kind === 'ride' ? network.changeSeconds : 0);
          if (ready > now) continue;
          const earlier = earliest(network, trips, position, ready, now);
          if (earlier !== null) ride = { trips, trip: earlier, board: position, from: stop };
        }
      }
    }
    walk(network, current, best, label, marked, rode, bound);
    rounds.push(current);
    labels.push(label);
    bound = Math.min(bound, record(k));
  }
  return paths;

  // The journey this round makes, when it reaches the end sooner than any before. Returns when.
  function record(k: number) {
    let arrives = Infinity;
    let end: Access | null = null;
    for (const [stop, seconds] of endAt) {
      const at = rounds[k]![stop]! + seconds;
      if (at < arrives) {
        arrives = at;
        end = { stop, seconds };
      }
    }
    if (!end || arrives >= bound) return Infinity;
    paths.push(trace(k, end, arrives));
    return arrives;
  }

  function trace(k: number, end: Access, arrives: number): Path {
    const legs: (RideLeg | WalkLeg)[] = [];
    let stop = end.stop;
    let round = k;
    for (;;) {
      const step = labels[round]!.get(stop)!;
      if (step.kind === 'start') return { rides: k, start: step.access, end, legs, arrives };
      if (step.kind === 'walk') {
        legs.unshift({ kind: 'walk', from: step.from, to: stop, seconds: step.seconds });
        stop = step.from;
        continue;
      }
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
      stop = step.from;
      round--;
    }
  }
}

// Walks on from the stops just reached to those nearby, where that gets there sooner.
function walk(network: Network, current: Float64Array, best: Float64Array, label: Map<number, Label>, marked: Set<number>, from: number[], bound: number) {
  for (const stop of from) {
    for (const path of network.footpaths(stop)) {
      const at = current[stop]! + path.seconds;
      if (at >= Math.min(best[path.stop]!, bound)) continue;
      current[path.stop] = at;
      best[path.stop] = at;
      label.set(path.stop, { kind: 'walk', from: stop, seconds: path.seconds });
      marked.add(path.stop);
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
