import type { RtTrip, TripSnapshot } from '../realtime/snapshot.ts';
import { stopKey, tripKey } from '../realtime/snapshot.ts';
import { type PatternRow, type Schedule, type StopRow, routeKeyOf } from '../schedule.ts';
import type { FirstLeg, SecondLeg } from './connections.ts';
import { type Link, destinationOf } from './links.ts';

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
  // Scheduled trips that should be on the road but are missing from the feed.
  const underway = new Set<string>();
  const allowed = (routeId: number) => !routeFilter || routeFilter.has(routeKeyOf(schedule.route(routeId)));

  const origins = new Map<number, StopRow>();
  // Where each first-leg pattern lets the rider off. At a shared station, BART and Muni Metro
  // patterns stop at different platforms of it.
  const alightFor = new Map<number, StopRow>();
  for (const { pattern, origin, alight } of link.firstLegs) {
    if (allowed(pattern.route)) origins.set(pattern.stops[origin]!, schedule.stop(pattern.stops[origin]!));
    alightFor.set(pattern.id, schedule.stop(pattern.stops[alight]!));
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
        // A trip the schedule does not have, such as an added BART train, may stop at any of them.
        // A known trip on a pattern this transfer point does not use belongs to another group.
        const candidates = pattern ? (alightFor.has(pattern.id) ? [alightFor.get(pattern.id)!] : []) : link.alights;
        let arrives: TimeAt | null = null;
        for (const alight of candidates) {
          arrives = timeAfter(context, trip, index, staticTrip, pattern, alight);
          if (arrives) break;
        }
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
    for (const trip of schedule.scheduledTrips(pattern, origin, now - 60, now + FIRST_LEG_HORIZON, [alight, 0])) {
      if (legs.has(trip.key)) continue;
      const realtime = snapshot?.trips.get(trip.key);
      if (realtime && (realtime.canceled || passed(schedule, realtime, pattern, origin))) continue;
      if (!realtime && (trip.times.get(0)?.departure ?? Infinity) < now) underway.add(trip.key);
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
  return withoutGhosts([...legs.values()], underway, ({ departs }) => departs);
}

// Every departure of the link's routes from its boarding stop, and when each reaches the
// destination stop, if the rider set one.
export function secondLegs(context: VehicleContext, link: Link, destination: StopRow | null): SecondLeg[] {
  const { schedule, snapshot, now } = context;
  const legs = new Map<string, SecondLeg>();
  const underway = new Set<string>();
  const routeIds = new Set(link.routes.map(({ id }) => id));
  const directionMatches = (pattern: PatternRow | undefined) => !pattern || link.direction === null || pattern.direction === link.direction;
  // Patterns the link boards, which a destination may have narrowed to those that get there.
  const patternIds = new Set(link.boardPatterns.map(({ pattern }) => pattern.id));
  // A BART station as the destination means whichever of its platforms the trip stops at.
  const destinationStops = destination ? schedule.boardingStops(destination) : [];

  const visits = link.boards.flatMap((board) => (snapshot?.byStop.get(stopKey(board.agency, board.stopId)) ?? []).map((visit) => ({ ...visit, board })));
  if (snapshot) {
    for (const { trip, index, board } of visits) {
      const staticTrip = schedule.trips.get(tripKey(trip.agency, trip.tripId));
      const pattern = staticTrip ? schedule.patterns.get(staticTrip.pattern) : undefined;
      const routeId = pattern?.route ?? schedule.routesByKey.get(`${trip.agency}:${trip.routeId}`)?.id;
      if (routeId === undefined || !routeIds.has(routeId) || !directionMatches(pattern) || (pattern && !patternIds.has(pattern.id))) continue;
      // A stop the trip ends at lets riders off but not on.
      if (index === trip.stops.length - 1 && pattern && pattern.stops.at(-1) === board.id) continue;
      const at = timeAt(context, trip, index, staticTrip, pattern, board);
      if (!at) continue;
      const leg: SecondLeg = {
        trip: tripKey(trip.agency, trip.tripId),
        route: routeKeyOf(schedule.route(routeId)),
        ...(pattern ? { toward: destinationOf(schedule, pattern, staticTrip?.headsign) } : {}),
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
    for (const trip of schedule.scheduledTrips(pattern, position, now - 60, now + SECOND_LEG_HORIZON, [...extra, 0])) {
      if (legs.has(trip.key)) continue;
      const realtime = snapshot?.trips.get(trip.key);
      // A trip the feed knows but that does not list this stop has passed it, unless the feed
      // canceled it, or its predictions simply stop short of this stop (SamTrans and Golden Gate
      // predict about an hour ahead, and a long route's trip is on the road longer than that).
      if (realtime && !realtime.canceled && passed(schedule, realtime, pattern, position)) continue;
      if (!realtime && (trip.times.get(0)?.departure ?? Infinity) < now) underway.add(trip.key);
      const at = trip.times.get(position);
      if (!at) continue;
      const leg: SecondLeg = {
        trip: trip.key,
        route: routeKeyOf(schedule.route(pattern.route)),
        toward: destinationOf(schedule, pattern, schedule.trips.get(trip.key)?.headsign),
        at: at.arrival,
        delay: null,
        // Past its predictions, a running trip has only its timetable time. A canceled one is live news.
        live: Boolean(realtime?.canceled),
        canceled: Boolean(realtime?.canceled),
      };
      const reaches = extra[0] === undefined ? undefined : trip.times.get(extra[0]);
      if (reaches) leg.destination = reaches.arrival;
      legs.set(trip.key, leg);
    }
  }
  return withoutGhosts([...legs.values()], underway, ({ at }) => at);
}

// Whether a trip the feed knows has already passed `position` on its pattern. The feed lists
// only the stops still ahead, so the trip has passed when its first listed stop comes later.
// A trip whose listed stops all come before `position` has not reached it yet: its
// predictions just do not reach that far.
function passed(schedule: Schedule, trip: RtTrip, pattern: PatternRow, position: number) {
  const first = trip.stops[0];
  if (!first) return false;
  const stop = schedule.stopsByKey.get(stopKey(trip.agency, first.stopId));
  const at = stop ? pattern.stops.indexOf(stop.id) : -1;
  return at > position;
}

// A scheduled trip that should be under way but is missing from the feed, within three minutes
// of a live trip on the same route, is most likely that same bus running on another trip's
// timetable. Showing both lists one bus twice.
function withoutGhosts<T extends { trip: string; route: string; live: boolean }>(legs: T[], underway: Set<string>, time: (leg: T) => number) {
  return legs.filter(
    (leg) => !underway.has(leg.trip) || !legs.some((other) => other.live && other.route === leg.route && Math.abs(time(other) - time(leg)) <= 180),
  );
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
