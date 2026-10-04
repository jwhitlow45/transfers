import type { RtTrip, TripSnapshot } from '../realtime/snapshot.ts';
import { stopKey, tripKey } from '../realtime/snapshot.ts';
import { type PatternRow, type Schedule, type StopRow, routeKeyOf } from '../schedule.ts';
import type { FirstLeg, SecondLeg } from './connections.ts';
import type { Link } from './links.ts';

export type VehicleContext = {
  schedule: Schedule;
  snapshot: TripSnapshot | null;
  now: number;
};

// How far ahead to look. Second legs reach further, since infrequent routes need hours to
// show three departures.
const FIRST_LEG_HORIZON = 3 * 3600;
const SECOND_LEG_HORIZON = 4 * 3600;

type TimeAt = { at: number; delay: number | null };

// Every first-leg vehicle that leaves the From stop and reaches the link's alight stop: live
// predictions where the feed has them, and scheduled trips the feed does not know about.
export function firstLegs(context: VehicleContext, link: Link, routeFilter: Set<string> | null): FirstLeg[] {
  const { schedule, snapshot, now } = context;
  const legs = new Map<string, FirstLeg>();
  const allowed = (routeId: number) => !routeFilter || routeFilter.has(routeKeyOf(schedule.route(routeId)));

  const origins = new Map<number, StopRow>();
  for (const { pattern, origin } of link.firstLegs) {
    if (allowed(pattern.route)) origins.set(pattern.stops[origin]!, schedule.stop(pattern.stops[origin]!));
  }

  if (snapshot) {
    for (const origin of origins.values()) {
      for (const { trip, index } of snapshot.byStop.get(stopKey(origin.agency, origin.stopId)) ?? []) {
        if (trip.canceled) continue;
        const staticTrip = schedule.trips.get(tripKey(trip.agency, trip.tripId));
        const pattern = staticTrip ? schedule.patterns.get(staticTrip.pattern) : undefined;
        const routeId = pattern?.route ?? schedule.routesByKey.get(`${trip.agency}:${trip.routeId}`)?.id;
        if (routeId === undefined || !allowed(routeId) || link.routes.some(({ id }) => id === routeId)) continue;
        const departs = timeAt(context, trip, index, staticTrip, pattern, origin);
        const arrives = timeAfter(context, trip, index, staticTrip, pattern, link.alight);
        if (!departs || !arrives || arrives.at < departs.at) continue;
        legs.set(tripKey(trip.agency, trip.tripId), {
          trip: tripKey(trip.agency, trip.tripId),
          route: routeKeyOf(schedule.route(routeId)),
          departs: departs.at,
          departDelay: departs.delay,
          arrives: arrives.at,
          arriveDelay: arrives.delay,
          live: true,
          canceled: false,
        });
      }
    }
  }

  for (const { pattern, origin, alight } of link.firstLegs) {
    if (!allowed(pattern.route)) continue;
    for (const trip of schedule.scheduledTrips(pattern, origin, now - 60, now + FIRST_LEG_HORIZON, [alight])) {
      // The feed knowing the trip at all means its predictions win, even when the trip has
      // already passed the From stop and so is left out above.
      if (legs.has(trip.key) || snapshot?.trips.has(trip.key)) continue;
      const departs = trip.times.get(origin);
      const arrives = trip.times.get(alight);
      if (!departs || !arrives) continue;
      legs.set(trip.key, {
        trip: trip.key,
        route: routeKeyOf(schedule.route(pattern.route)),
        departs: departs.departure,
        departDelay: null,
        arrives: arrives.arrival,
        arriveDelay: null,
        live: false,
        canceled: false,
      });
    }
  }
  return [...legs.values()];
}

// Every departure of the link's routes from its boarding stop, and when each reaches the
// destination stop, if the rider set one.
export function secondLegs(context: VehicleContext, link: Link, destination: StopRow | null): SecondLeg[] {
  const { schedule, snapshot, now } = context;
  const legs = new Map<string, SecondLeg>();
  const routeIds = new Set(link.routes.map(({ id }) => id));
  const directionMatches = (pattern: PatternRow | undefined) => !pattern || link.direction === null || pattern.direction === link.direction;
  // A BART station as the destination means whichever of its platforms the trip stops at.
  const destinationStops = destination ? schedule.boardingStops(destination) : [];

  if (snapshot) {
    for (const { trip, index } of snapshot.byStop.get(stopKey(link.board.agency, link.board.stopId)) ?? []) {
      const staticTrip = schedule.trips.get(tripKey(trip.agency, trip.tripId));
      const pattern = staticTrip ? schedule.patterns.get(staticTrip.pattern) : undefined;
      const routeId = pattern?.route ?? schedule.routesByKey.get(`${trip.agency}:${trip.routeId}`)?.id;
      if (routeId === undefined || !routeIds.has(routeId) || !directionMatches(pattern)) continue;
      // A stop the trip ends at lets riders off but not on.
      if (index === trip.stops.length - 1 && pattern && pattern.stops.at(-1) === link.board.id) continue;
      const at = timeAt(context, trip, index, staticTrip, pattern, link.board);
      if (!at) continue;
      const leg: SecondLeg = {
        trip: tripKey(trip.agency, trip.tripId),
        route: routeKeyOf(schedule.route(routeId)),
        at: at.at,
        delay: at.delay,
        live: true,
        canceled: trip.canceled,
      };
      for (const stop of destinationStops) {
        const reaches = timeAfter(context, trip, index, staticTrip, pattern, stop);
        if (reaches) {
          leg.destination = reaches.at;
          break;
        }
      }
      legs.set(leg.trip, leg);
    }
  }

  const destinationPositions = (pattern: PatternRow, from: number) => {
    for (const stop of destinationStops) {
      const position = pattern.stops.indexOf(stop.id, from + 1);
      if (position !== -1) return [position];
    }
    return [];
  };
  for (const { pattern, position } of link.boardPatterns) {
    if (!routeIds.has(pattern.route)) continue;
    const extra = destinationPositions(pattern, position);
    for (const trip of schedule.scheduledTrips(pattern, position, now - 60, now + SECOND_LEG_HORIZON, extra)) {
      if (legs.has(trip.key)) continue;
      const realtime = snapshot?.trips.get(trip.key);
      // A trip the feed knows but that no longer lists this stop has already passed it,
      // unless the feed canceled the whole trip.
      if (realtime && !realtime.canceled) continue;
      const at = trip.times.get(position);
      if (!at) continue;
      const leg: SecondLeg = {
        trip: trip.key,
        route: routeKeyOf(schedule.route(pattern.route)),
        at: at.arrival,
        delay: null,
        live: Boolean(realtime),
        canceled: Boolean(realtime?.canceled),
      };
      const reaches = extra[0] === undefined ? undefined : trip.times.get(extra[0]);
      if (reaches) leg.destination = reaches.arrival;
      legs.set(trip.key, leg);
    }
  }
  return [...legs.values()];
}

// A realtime trip's time at its stop `index`. Feeds may send only a delay, in which case the
// schedule supplies the time.
function timeAt(
  context: VehicleContext,
  trip: RtTrip,
  index: number,
  staticTrip: { row: number } | undefined,
  pattern: PatternRow | undefined,
  stop: StopRow,
): TimeAt | null {
  const stopTime = trip.stops[index];
  if (!stopTime || stopTime.skipped) return null;
  if (stopTime.time !== null) return { at: stopTime.time, delay: stopTime.delay };
  if (stopTime.delay === null || !staticTrip || !pattern) return null;
  const position = pattern.stops.indexOf(stop.id);
  const scheduled = position === -1 ? null : context.schedule.scheduledTimeAt(staticTrip.row, position, context.now);
  return scheduled === null ? null : { at: scheduled + stopTime.delay, delay: stopTime.delay };
}

// A realtime trip's time at a later stop. When the feed leaves that stop out, the schedule
// time plus the latest known delay stands in, as GTFS-realtime says delays carry forward.
function timeAfter(
  context: VehicleContext,
  trip: RtTrip,
  fromIndex: number,
  staticTrip: { row: number } | undefined,
  pattern: PatternRow | undefined,
  stop: StopRow,
): TimeAt | null {
  for (let index = fromIndex + 1; index < trip.stops.length; index++) {
    const stopTime = trip.stops[index]!;
    if (stopTime.stopId !== stop.stopId) continue;
    if (stopTime.skipped) return null;
    return timeAt(context, trip, index, staticTrip, pattern, stop);
  }
  if (!staticTrip || !pattern) return null;
  const origin = trip.stops[fromIndex];
  const fromPosition = origin ? pattern.stops.findIndex((id) => context.schedule.stop(id).stopId === origin.stopId) : -1;
  const position = pattern.stops.indexOf(stop.id, fromPosition + 1);
  if (fromPosition === -1 || position === -1) return null;
  const scheduled = context.schedule.scheduledTimeAt(staticTrip.row, position, context.now);
  const delay = [...trip.stops.slice(0, fromIndex + 1)].reverse().find(({ delay }) => delay !== null)?.delay ?? null;
  return scheduled === null ? null : { at: scheduled + (delay ?? 0), delay };
}
