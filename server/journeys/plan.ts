import type { AgencyId } from '../../shared/api.ts';
import type { Journey, JourneyEnd, JourneyLeg, JourneysResponse, PlaceResult } from '../../shared/journeys.ts';
import { walkSeconds } from '../../shared/walk.ts';
import { arrivalStops, headingOf, walkPoints } from '../engine/links.ts';
import { type AccessNeeds, type RealtimeView, SAME_RUN_SECONDS, serviceStatus, stationOutages } from '../engine/realtime-view.ts';
import { predictedTimes } from '../engine/track.ts';
import { Tables } from '../engine/views.ts';
import { STEP_FREE_MINUTES, type WalkSettings, atRailStation, transferSeconds } from '../engine/walk.ts';
import { distanceMeters, type Point } from '../geo.ts';
import { RequestError } from '../http.ts';
import { type Schedule, type StopRow, routeKeyOf, stopKeyOf } from '../schedule.ts';
import { addDays, serviceDate, serviceDayStart } from '../time.ts';
import { footpathsFor, walksFor } from './footpaths.ts';
import { type Access, type Network, type Path, type RideLeg, raptor } from './raptor.ts';
import { type PatternTrips, timetableFor } from './timetable.ts';

// Where a journey starts or ends, as the planner takes it: a stop, or a point the rider walks from
// or to, such as where they are or a place they searched for.
export type Endpoint = { kind: 'stop'; stop: StopRow } | { kind: 'point'; name: string; at: Point };

export type JourneyOptions = WalkSettings & AccessNeeds & { maxRides?: number; count?: number };

// Three changes at most: four vehicles take a rider anywhere these agencies reach.
const MAX_RIDES = 4;
const JOURNEYS = 5;
// How far ahead of now a journey may arrive: enough for a long ride on routes that run hourly.
const HORIZON_SECONDS = 4 * 3600;
// How far ahead of the searches to come prepareJourneys loads timetables, longer than the server
// waits between calls to it.
const PREPARE_AHEAD_SECONDS = 10 * 60;
// How far a rider walks between a point and a stop, and further when nothing is that close.
const ACCESS_METERS = 800;
const FAR_ACCESS_METERS = 1600;
// Ends closer than this get a walk among their journeys, as do any it gets between soonest.
const WALK_ONLY_METERS = 2000;
// Changing vehicles without leaving the stop.
const CHANGE_SECONDS = 60;
// What one more change has to give the rider, in setting off later and arriving sooner.
const CHANGE_WORTH_SECONDS = 5 * 60;
// At most this many searches for each journey asked for, as many a search finds only journeys
// another beats.
const MAX_SEARCHES_PER_JOURNEY = 3;
// Enough for "Your location" or a place's name. A label comes back in the answer, so it is capped.
const MAX_LABEL_LENGTH = 100;

// Both ends as a request names them (see placeEnd and pointEnd in shared/journeys.ts), each point
// with the label the page shows for it. `place` finds a place in the place list by id.
export function readEnds(schedule: Schedule, params: URLSearchParams, place: (id: string) => PlaceResult | null) {
  const [from, to] = [params.get('from'), params.get('to')];
  if (!from || !to) throw new RequestError(400, 'Send from and to');
  if (from === to) throw new RequestError(400, 'From and To are the same place');
  return { from: readEnd(schedule, from, params.get('fl'), place), to: readEnd(schedule, to, params.get('tl'), place) };
}

function readEnd(schedule: Schedule, value: string, label: string | null, place: (id: string) => PlaceResult | null): Endpoint {
  if (value.startsWith('place:')) {
    const found = place(value.slice('place:'.length));
    // The list is rebuilt weekly, and a place gone from OpenStreetMap leaves with it.
    if (!found) throw new RequestError(404, 'That place is not in the list anymore');
    return { kind: 'point', name: found.name, at: { lat: found.lat, lon: found.lon } };
  }
  if (value.startsWith('@')) {
    const [, lat, lon] = (value.match(/^@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/) ?? []).map(Number);
    if (lat === undefined || lon === undefined || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new RequestError(400, 'That is not a place on the map');
    return { kind: 'point', name: label?.trim().slice(0, MAX_LABEL_LENGTH) || 'Your location', at: { lat, lon } };
  }
  const stop = schedule.stopsByKey.get(value);
  if (!stop) throw new RequestError(404, `No stop ${value}`);
  return { kind: 'stop', stop };
}

// The next few ways from one end to the other, with any number of vehicles, soonest first.
export function planJourneys(schedule: Schedule, realtime: RealtimeView, from: Endpoint, to: Endpoint, now: number, options: JourneyOptions = {}): JourneysResponse {
  const network = liveNetwork(schedule, realtime, now, options);
  const starts = accessTo(schedule, from, 'start', options.speed);
  const ends = accessTo(schedule, to, 'end', options.speed);
  const maxRides = options.maxRides ?? MAX_RIDES;
  const count = options.count ?? JOURNEYS;
  let journeys: Journey[] = [];
  // Each search sets off just after the fastest journey the last one found, for the next way to
  // go, until there are enough worth showing, and one more, which may yet beat the last of them.
  let leaveAt = now;
  for (let search = 0; search < count * MAX_SEARCHES_PER_JOURNEY && starts.length > 0 && ends.length > 0 && journeys.length <= count; search++) {
    const paths = raptor(network, starts, ends, leaveAt, maxRides, now + HORIZON_SECONDS);
    const fastest = paths.at(-1);
    if (!fastest) break;
    journeys = keepBest([...journeys, ...paths.map((path) => journeyOf(schedule, network, latestBoarding(network, path)))]);
    leaveAt = leavesAt(fastest) + 60;
  }
  // Walking all the way is one of the ways between ends close enough, and between any, when it
  // gets there first in the hours a search looks ahead. Vehicles it beats drop out.
  const walk = walkOnly(from, to, now, options.speed);
  const soonest = Math.min(now + HORIZON_SECONDS, ...journeys.map(({ arrives }) => arrives));
  if (walk.meters <= WALK_ONLY_METERS || walk.journey.arrives <= soonest) journeys = keepBest([...journeys, walk.journey]);
  journeys.sort((a, b) => a.leaves - b.leaves || a.arrives - b.arrives);
  const shown = journeys.slice(0, count);
  // With no way at all, a point no stop is near is why.
  const far = shown.length > 0 ? null : from.kind === 'point' && starts.length === 0 ? 'from' : to.kind === 'point' && ends.length === 0 ? 'to' : null;
  const tables = new Tables(schedule);
  const { alerts, feeds } = serviceStatus(schedule, realtime, tables, tabulate(schedule, tables, shown, [from, to]));
  return {
    generatedAt: now,
    dataAt: realtime.updatedAt,
    from: endView(tables, from),
    to: endView(tables, to),
    journeys: shown,
    routes: tables.routes,
    stops: tables.stops,
    alerts,
    ...(options.stepFree || options.escalators ? { access: accessOutages(schedule, tables, realtime, options, shown) } : {}),
    ...(far ? { notice: { kind: 'far' as const, end: far } } : {}),
    feeds,
  };
}

// The service dates a search from `now` reads: trips after midnight belong to the day before,
// and a journey late at night reaches the next.
function searchDates(now: number) {
  const today = serviceDate(now);
  return [addDays(today, -1), today, ...(serviceDayStart(addDays(today, 1)) < now + HORIZON_SECONDS ? [addDays(today, 1)] : [])];
}

// Loads what searches from now to a while ahead will read, so no rider waits on it: each day's
// timetable and the walks between stops, about a second each. One at a time, with requests let
// through between, and `schedule` read again for each, as a rebuild may swap it out meanwhile.
// Returns the dates loaded, or none without a schedule.
export async function prepareJourneys(schedule: () => Schedule | null, now: number) {
  const dates = [...new Set([...searchDates(now), ...searchDates(now + PREPARE_AHEAD_SECONDS)])];
  const steps = [...dates.map((date) => (current: Schedule) => timetableFor(current, date)), footpathsFor];
  for (const step of steps) {
    await new Promise((resolve) => setImmediate(resolve));
    const current = schedule();
    if (!current) return [];
    step(current);
  }
  return dates;
}

type LiveNetwork = Network & { prediction: (trips: PatternTrips, trip: number) => Prediction | null };

// A trip's run as the feed predicts it: when it reaches each stop (null where it skips the stop or
// is canceled), the feed's own delay at each stop it lists, and the first stop it has yet to leave.
type Prediction = { times: (number | null)[]; reported: (number | null)[]; ahead: number };

// The timetable for the days a journey from now can use, with the feed's predictions over it.
// Canceled trips have no times, so no journey relies on one.
function liveNetwork(schedule: Schedule, realtime: RealtimeView, now: number, options: JourneyOptions): LiveNetwork {
  const tables = searchDates(now).map((date) => timetableFor(schedule, date));
  const footpaths = footpathsFor(schedule);
  // Each stop's walks for the rider's settings, worked out the first time the search walks on.
  const walks = new Map<number, Access[]>();
  // A rider who needs elevators takes longer to change at a station, as the transfer results
  // allow (engine/trip.ts).
  const stepFreeSeconds = (...stops: number[]) => (options.stepFree && stops.some((stop) => atRailStation(schedule.stop(stop))) ? STEP_FREE_MINUTES * 60 : 0);
  const tripsOf = new Map<number, PatternTrips[]>();
  const stopsOf = new Map<number, StopRow[]>();
  // Worked out the first time the search reaches each trip.
  const predictions = new Map<PatternTrips, (Prediction | null | undefined)[]>();
  const prediction = (trips: PatternTrips, trip: number) => {
    let list = predictions.get(trips);
    if (!list) predictions.set(trips, (list = []));
    if (list[trip] !== undefined) return list[trip];
    const rt = realtime.trips?.trips.get(trips.keys[trip]!);
    const width = trips.pattern.stops.length * 2;
    const first = trips.times[trip * width + 1]!;
    const last = trips.times[trip * width + width - 2]!;
    const sameRun = now > first - SAME_RUN_SECONDS && now < last + SAME_RUN_SECONDS;
    let found: Prediction | null = null;
    if (rt && sameRun && rt.canceled) found = { times: trips.pattern.stops.map(() => null), reported: [], ahead: 0 };
    else if (rt && sameRun) {
      let stops = stopsOf.get(trips.pattern.id);
      if (!stops) stopsOf.set(trips.pattern.id, (stops = trips.pattern.stops.map((id) => schedule.stop(id))));
      const scheduled = stops.map((_, position) => trips.times[trip * width + position * 2]!);
      const predicted = predictedTimes(scheduled, stops, rt, now);
      if (predicted.predicted) found = { times: predicted.times, reported: predicted.reported, ahead: predicted.ahead };
    }
    list[trip] = found;
    return found;
  };
  return {
    stopCount: Math.max(...schedule.stops.keys()) + 1,
    patternsAt: (stop) => schedule.patternsByStop.get(stop) ?? [],
    trips: (pattern) => {
      let list = tripsOf.get(pattern.id);
      if (!list) tripsOf.set(pattern.id, (list = tables.flatMap(({ byPattern }) => byPattern.get(pattern.id) ?? [])));
      return list;
    },
    arrival: (trips, trip, position) => {
      const live = prediction(trips, trip);
      if (!live) return trips.times[(trip * trips.pattern.stops.length + position) * 2]!;
      return position < live.ahead ? null : live.times[position]!;
    },
    departure: (trips, trip, position) => {
      const at = (trip * trips.pattern.stops.length + position) * 2;
      const live = prediction(trips, trip);
      if (!live) return trips.times[at + 1]!;
      const arrives = live.times[position];
      // A stop the trip has left is no place to catch it. Elsewhere it leaves after the stop's
      // scheduled wait.
      return position < live.ahead || arrives === null || arrives === undefined ? null : arrives + (trips.times[at + 1]! - trips.times[at]!);
    },
    footpaths: (stop) => {
      let list = walks.get(stop);
      if (!list) {
        list = walksFor(footpaths.get(stop), options);
        if (options.stepFree) list = list.map((walk) => ({ ...walk, seconds: walk.seconds + stepFreeSeconds(stop, walk.stop) }));
        walks.set(stop, list);
      }
      return list;
    },
    changeSeconds: (stop) => CHANGE_SECONDS + stepFreeSeconds(stop),
    prediction,
  };
}

// The stops a journey can start or end at, with the walk to or from each: a stop's own platforms,
// and at the end a stop on its corner too, as a ride to a named stop ends in the transfer results,
// or else the stops around a point, timed as a transfer's walk is, from a station's entrances.
function accessTo(schedule: Schedule, end: Endpoint, side: 'start' | 'end', speed?: number): Access[] {
  if (end.kind === 'stop') return (side === 'start' ? schedule.boardingStops(end.stop) : arrivalStops(schedule, end.stop)).map((stop) => ({ stop: stop.id, seconds: 0 }));
  const around = [...schedule.patternsByStop.keys()].map((id) => {
    const stop = schedule.stop(id);
    return { stop, meters: Math.min(...walkPoints(schedule, stop).map((point) => distanceMeters(end.at, point))) };
  });
  const near = around.filter(({ meters }) => meters <= ACCESS_METERS);
  return (near.length > 0 ? near : around.filter(({ meters }) => meters <= FAR_ACCESS_METERS)).map(({ stop, meters }) => {
    const [exit, entry] = side === 'start' ? (['street', stop.access] as const) : ([stop.access, 'street'] as const);
    return { stop: stop.id, seconds: Math.ceil(transferSeconds({ exit, entry, meters, ...(speed ? { speed } : {}) })) };
  });
}

// The router finds the soonest arrival by boarding each vehicle as soon as it can, which can mean
// an early first train and a long wait to change. A rider would rather wait where they start, so
// each vehicle, from the last back, becomes the latest of its own that still makes the next.
function latestBoarding(network: Network, path: Path): Path {
  const legs = [...path.legs];
  // When the rider must be where the next leg starts.
  let deadline = Infinity;
  for (let index = legs.length - 1; index >= 0; index--) {
    const leg = legs[index]!;
    if (leg.kind === 'walk') {
      deadline -= leg.seconds;
      continue;
    }
    let ride: RideLeg = leg;
    if (deadline !== Infinity) {
      const width = leg.trips.pattern.stops.length * 2;
      for (let trip = leg.trip + 1; trip < leg.trips.keys.length; trip++) {
        if (leg.trips.times[trip * width + leg.board * 2 + 1]! > deadline) break;
        const departs = network.departure(leg.trips, trip, leg.board);
        const arrives = network.arrival(leg.trips, trip, leg.alight);
        if (departs !== null && arrives !== null && departs >= ride.departs && arrives <= deadline) ride = { ...leg, trip, departs, arrives };
      }
      legs[index] = ride;
    }
    deadline = ride.departs - (legs[index - 1]?.kind === 'ride' ? network.changeSeconds(ride.from) : 0);
  }
  return { ...path, legs };
}

// When the rider sets off: as late as still makes the first vehicle.
function leavesAt(path: Path) {
  let walked = path.start.seconds;
  for (const leg of path.legs) {
    if (leg.kind === 'ride') return leg.departs - walked;
    walked += leg.seconds;
  }
  return path.arrives - walked - path.end.seconds;
}

// A rider changes at a BART station, not a platform, and a shared station holds Muni Metro's
// platforms too, so the page names each stop as its stop page does.
const stopKey = (schedule: Schedule, stop: number) => stopKeyOf(schedule.stationOf(schedule.stop(stop)));

function journeyOf(schedule: Schedule, network: LiveNetwork, path: Path): Journey {
  const legs: JourneyLeg[] = [];
  const walk = (from: string | null, to: string | null, seconds: number) => {
    if (seconds <= 0) return;
    const last = legs.at(-1);
    // A walk on from where a walk ended is one walk.
    if (last?.kind === 'walk') {
      last.to = to;
      last.seconds += seconds;
    } else legs.push({ kind: 'walk', from, to, seconds });
  };
  walk(null, stopKey(schedule, path.start.stop), path.start.seconds);
  for (const leg of path.legs) {
    if (leg.kind === 'walk') {
      walk(stopKey(schedule, leg.from), stopKey(schedule, leg.to), leg.seconds);
      continue;
    }
    const { pattern, keys, times } = leg.trips;
    const width = pattern.stops.length * 2;
    const live = network.prediction(leg.trips, leg.trip);
    // As the results count it: the feed's own delay where it gives one.
    const delay = (position: number, at: number, scheduled: number) => (live ? (live.reported[position] ?? at - scheduled) : null);
    legs.push({
      kind: 'ride',
      trip: keys[leg.trip]!,
      route: routeKeyOf(schedule.route(pattern.route)),
      toward: headingOf(schedule, pattern, schedule.trips.get(keys[leg.trip]!)?.headsign),
      from: stopKey(schedule, leg.from),
      to: stopKey(schedule, leg.to),
      departs: leg.departs,
      arrives: leg.arrives,
      departDelay: delay(leg.board, leg.departs, times[leg.trip * width + leg.board * 2 + 1]!),
      arriveDelay: delay(leg.alight, leg.arrives, times[leg.trip * width + leg.alight * 2]!),
      live: live !== null,
      stops: leg.alight - leg.board,
    });
  }
  walk(stopKey(schedule, path.end.stop), null, path.end.seconds);
  return { leaves: leavesAt(path), arrives: path.arrives, rides: path.rides, legs };
}

// Each way to go once, leaving out one another journey beats: with as many changes, setting off
// no sooner and arriving no later. Each change more has to be worth CHANGE_WORTH_SECONDS to the
// rider, in setting off later and arriving sooner together, so a bus for a few blocks to save
// walking them, or three buses for a minute ahead of the next direct one, is left out.
function keepBest(journeys: Journey[]) {
  const signature = (journey: Journey) => journey.legs.map((leg) => (leg.kind === 'ride' ? `${leg.trip}@${leg.from}>${leg.to}` : '')).join('|');
  const unique = [...new Map(journeys.map((journey) => [signature(journey), journey])).values()];
  const beats = (other: Journey, journey: Journey) => {
    const later = journey.leaves - other.leaves;
    const sooner = other.arrives - journey.arrives;
    if (other.rides === journey.rides) return later <= 0 && sooner <= 0 && (later < 0 || sooner < 0);
    const worth = (journey.rides - other.rides) * CHANGE_WORTH_SECONDS;
    return other.rides < journey.rides && later <= worth && sooner <= worth && later + sooner < worth;
  };
  return unique.filter((journey) => !unique.some((other) => other !== journey && beats(other, journey)));
}

// Walking all the way, setting off now, and how far that is.
function walkOnly(from: Endpoint, to: Endpoint, now: number, speed?: number): { meters: number; journey: Journey } {
  const at = (end: Endpoint) => (end.kind === 'stop' ? end.stop : end.at);
  const meters = distanceMeters(at(from), at(to));
  const seconds = Math.ceil(walkSeconds(meters, speed));
  const key = (end: Endpoint) => (end.kind === 'stop' ? stopKeyOf(end.stop) : null);
  return { meters, journey: { leaves: now, arrives: now + seconds, rides: 0, legs: [{ kind: 'walk', from: key(from), to: key(to), seconds }] } };
}

// Puts the stops and routes the journeys name in the tables, and gives the stops, routes and
// agencies they use, with the stops they start and end at, for the alerts and feeds that bear on
// them. Alerts may name a BART stop by platform or station.
function tabulate(schedule: Schedule, tables: Tables, journeys: Journey[], ends: Endpoint[]) {
  const stops = new Set<string>();
  const routes = new Set<string>();
  const agencies = new Set<AgencyId>();
  const addStop = (stop: StopRow) => {
    tables.stop(stop);
    for (const each of [stop, schedule.stationOf(stop), ...schedule.boardingStops(stop)]) stops.add(stopKeyOf(each));
  };
  for (const end of ends) {
    if (end.kind !== 'stop') continue;
    addStop(end.stop);
    // A shared station belongs to both systems, so its own agency says nothing about the trip.
    if (!schedule.sharedMembers.has(end.stop.id)) agencies.add(end.stop.agency);
  }
  for (const { legs } of journeys) {
    for (const leg of legs) {
      for (const key of [leg.from, leg.to]) {
        const stop = key === null ? undefined : schedule.stopsByKey.get(key);
        if (stop) addStop(stop);
      }
      if (leg.kind !== 'ride') continue;
      const route = schedule.routesByKey.get(leg.route);
      if (!route) continue;
      tables.route(route);
      routes.add(leg.route);
      agencies.add(route.agency);
    }
  }
  return { stops, routes, agencies };
}

// The elevator and escalator outages the rider asked about at the stations the journeys use.
// Where a journey only passes through a shared station on Muni Metro, BART's platforms there are
// none of its way.
function accessOutages(schedule: Schedule, tables: Tables, realtime: RealtimeView, needs: AccessNeeds, journeys: Journey[]) {
  const legs = journeys.flatMap(({ legs }) => legs);
  const keys = legs.flatMap(({ from, to }) => [from, to]).filter((key) => key !== null);
  const bartAt = new Set(legs.flatMap((leg) => (leg.kind === 'ride' && schedule.routesByKey.get(leg.route)?.agency === 'BA' ? [leg.from, leg.to] : [])));
  return stationOutages(schedule, tables, realtime.access ?? [], needs, bartAt, keys);
}

function endView(tables: Tables, end: Endpoint): JourneyEnd {
  return end.kind === 'stop' ? { kind: 'stop', stop: tables.stop(end.stop) } : { kind: 'point', name: end.name, lat: end.at.lat, lon: end.at.lon };
}
