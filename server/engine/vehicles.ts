import type { RtTrip, TripSnapshot } from '../realtime/snapshot.ts';
import { stopKey, tripKey } from '../realtime/snapshot.ts';
import { type PatternRow, type Schedule, type StopRow, routeKeyOf, stopKeyOf } from '../schedule.ts';
import type { FirstLeg, SecondLeg } from './connections.ts';
import { type Link, headingOf } from './links.ts';

export type VehicleContext = {
  schedule: Schedule;
  snapshot: TripSnapshot | null;
  now: number;
};

// How far ahead to look. Second legs reach further, since infrequent routes need hours to
// show three departures.
const FIRST_LEG_HORIZON = 3 * 3600;
const SECOND_LEG_HORIZON = 4 * 3600;
// How far back to look for vehicles that have left, which the rider may be on: long enough for
// Golden Gate's longest rides from Santa Rosa.
const UNDER_WAY_SECONDS = 3 * 3600;

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
        let alightAt: StopRow | null = null;
        for (const alight of candidates) {
          arrives = timeAfter(context, trip, index, staticTrip, pattern, alight);
          if (arrives) {
            alightAt = alight;
            break;
          }
        }
        if (!departs || !arrives || arrives.at < departs.at) continue;
        legs.set(tripKey(trip.agency, trip.tripId), {
          trip: tripKey(trip.agency, trip.tripId),
          route: routeKeyOf(schedule.route(routeId)),
          ...(alightAt ? { alight: stopKeyOf(alightAt) } : {}),
          board: stopKeyOf(origin),
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
    // Vehicles that have left From too, as the rider may be on one.
    for (const trip of schedule.scheduledTrips(pattern, origin, now - UNDER_WAY_SECONDS, now + FIRST_LEG_HORIZON, [alight, 0])) {
      if (legs.has(trip.key)) continue;
      const realtime = snapshot?.trips.get(trip.key);
      if (realtime && (realtime.canceled || skips(schedule, realtime, pattern, alight))) continue;
      const staticTrip = schedule.trips.get(trip.key);
      if (realtime && staticTrip && gone(schedule, realtime, pattern, origin)) {
        // Left From, so the feed no longer lists it there.
        const departs = timeAtPosition(context, realtime, staticTrip, pattern, origin);
        const arrives = timeAtPosition(context, realtime, staticTrip, pattern, alight);
        if (!departs || !arrives || arrives.at < departs.at) continue;
        legs.set(trip.key, {
          trip: trip.key,
          route: routeKeyOf(schedule.route(pattern.route)),
          alight: stopKeyOf(schedule.stop(pattern.stops[alight]!)),
          board: stopKeyOf(schedule.stop(pattern.stops[origin]!)),
          departs: departs.at,
          departDelay: departs.delay,
          arrives: arrives.at,
          arriveDelay: arrives.delay,
          live: true,
          canceled: false,
        });
        continue;
      }
      if (!realtime && (trip.times.get(0)?.departure ?? Infinity) < now) underway.add(trip.key);
      const departs = trip.times.get(origin);
      const arrives = trip.times.get(alight);
      if (!departs || !arrives) continue;
      legs.set(trip.key, {
        trip: trip.key,
        route: routeKeyOf(schedule.route(pattern.route)),
        alight: stopKeyOf(schedule.stop(pattern.stops[alight]!)),
        board: stopKeyOf(schedule.stop(pattern.stops[origin]!)),
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
// destination, if the rider set one: the first of `destinationStops` it stops at.
// With `underWay`, departures that have left too, as far back as a first vehicle that has left
// could have made one, so pairing gives each such vehicle the departure it really made, and drops
// the pair once that ride is over, rather than giving it a later one.
export function secondLegs(context: VehicleContext, link: Link, destinationStops: StopRow[], underWay = false): SecondLeg[] {
  const { schedule, snapshot, now } = context;
  const legs = new Map<string, SecondLeg>();
  const underway = new Set<string>();
  const routeIds = new Set(link.routes.map(({ id }) => id));
  const directionMatches = (pattern: PatternRow | undefined) => !pattern || link.direction === null || pattern.direction === link.direction;
  // Patterns the link boards, which a destination may have narrowed to those that get there.
  const patternIds = new Set(link.boardPatterns.map(({ pattern }) => pattern.id));

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
        ...(pattern ? { toward: headingOf(schedule, pattern, staticTrip?.headsign) } : {}),
        at: at.at,
        delay: at.delay,
        live: true,
        canceled: trip.canceled,
      };
      const reaches = destinationStops.flatMap((stop) => timeAfter(context, trip, index, staticTrip, pattern, stop) ?? []).sort((a, b) => a.at - b.at)[0];
      if (reaches) leg.destination = reaches.at;
      legs.set(leg.trip, leg);
    }
  }

  // The first of them the trip reaches, as a pinned trip ends there too.
  const destinationPositions = (pattern: PatternRow, from: number) => {
    const positions = destinationStops.map((stop) => pattern.stops.indexOf(stop.id, from + 1)).filter((position) => position !== -1);
    return positions.length > 0 ? [Math.min(...positions)] : [];
  };
  for (const { pattern, position } of link.boardPatterns) {
    if (!routeIds.has(pattern.route)) continue;
    const extra = destinationPositions(pattern, position);
    const reachesAt = extra[0];
    for (const trip of schedule.scheduledTrips(pattern, position, now - (underWay ? UNDER_WAY_SECONDS : 60), now + SECOND_LEG_HORIZON, [...extra, 0])) {
      if (legs.has(trip.key)) continue;
      const realtime = snapshot?.trips.get(trip.key);
      // A trip the feed knows but that does not list this stop has passed it, unless the feed
      // canceled it, or its predictions simply stop short of this stop (SamTrans and Golden Gate
      // predict about an hour ahead, and a long route's trip is on the road longer than that).
      if (realtime && !realtime.canceled && gone(schedule, realtime, pattern, position)) {
        const staticTrip = schedule.trips.get(trip.key);
        if (!underWay || !staticTrip) continue;
        const at = timeAtPosition(context, realtime, staticTrip, pattern, position);
        if (!at) continue;
        const reaches = reachesAt === undefined || skips(schedule, realtime, pattern, reachesAt) ? null : timeAtPosition(context, realtime, staticTrip, pattern, reachesAt);
        legs.set(trip.key, {
          trip: trip.key,
          route: routeKeyOf(schedule.route(pattern.route)),
          toward: headingOf(schedule, pattern, staticTrip.headsign),
          at: at.at,
          delay: at.delay,
          live: true,
          canceled: false,
          ...(reaches ? { destination: reaches.at } : {}),
        });
        continue;
      }
      if (!realtime && (trip.times.get(0)?.departure ?? Infinity) < now) underway.add(trip.key);
      const at = trip.times.get(position);
      if (!at) continue;
      const leg: SecondLeg = {
        trip: trip.key,
        route: routeKeyOf(schedule.route(pattern.route)),
        toward: headingOf(schedule, pattern, schedule.trips.get(trip.key)?.headsign),
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

// Whether a trip the feed knows will not be at `position` on its pattern: the feed lists that
// stop (as skipped, since a listed time would have matched already), or the trip has passed it.
// The feed lists only the stops still ahead, so the trip has passed when the first listed stop
// on its pattern comes later. Stops off the pattern, such as a detour's, say nothing either way.
// A trip whose listed stops all come before `position` has not reached it yet: its predictions
// just do not reach that far.
function gone(schedule: Schedule, trip: RtTrip, pattern: PatternRow, position: number) {
  if (skips(schedule, trip, pattern, position)) return true;
  for (const listed of trip.stops) {
    const stop = schedule.stopsByKey.get(stopKey(trip.agency, listed.stopId));
    const at = stop ? pattern.stops.indexOf(stop.id) : -1;
    if (at !== -1) return at > position;
  }
  return false;
}

function skips(schedule: Schedule, trip: RtTrip, pattern: PatternRow, position: number) {
  const stop = schedule.stop(pattern.stops[position]!);
  return trip.stops.some((listed) => listed.skipped && listed.stopId === stop.stopId);
}

// A scheduled trip that should be under way but is missing from the feed, within three minutes
// of a live trip on the same route, is most likely that same bus running on another trip's
// timetable. Showing both lists one bus twice.
// A canceled trip is live news but no bus, so it is never taken as the ghost's real bus.
function withoutGhosts<T extends { trip: string; route: string; live: boolean; canceled: boolean }>(legs: T[], underway: Set<string>, time: (leg: T) => number) {
  return legs.filter(
    (leg) =>
      !underway.has(leg.trip) ||
      !legs.some((other) => other.live && !other.canceled && other.route === leg.route && Math.abs(time(other) - time(leg)) <= 180),
  );
}

// A realtime trip's time at its stop `index`. Feeds may send only a delay, in which case the
// schedule supplies the time, or only a time, in which case the schedule supplies the delay.
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
  if (stopTime.time !== null) return { at: stopTime.time, delay: stopTime.delay ?? delayAt(context, stopTime.time, stopTime.sequence, staticTrip, pattern, stop) };
  if (stopTime.delay === null || !staticTrip || !pattern) return null;
  const position = pattern.stops.indexOf(stop.id);
  const scheduled = position === -1 ? null : context.schedule.scheduledTimeAt(staticTrip.row, position, context.now);
  return scheduled === null ? null : { at: scheduled + stopTime.delay, delay: stopTime.delay };
}

// How late a time the feed predicts without a delay runs, by the schedule, so the rider sees it
// as from a feed that sends both, and a pin taking the time less the delay gets the schedule's. On
// a loop that makes the stop twice, the visit is the one the update's stop sequence names, or else
// the one scheduled nearest the time, as expectedTimes in track.ts matches them.
function delayAt(context: VehicleContext, time: number, sequence: number | undefined, staticTrip: { row: number } | undefined, pattern: PatternRow | undefined, stop: StopRow) {
  if (!staticTrip || !pattern) return null;
  const visits = pattern.stops.flatMap((id, position) => (id === stop.id ? [position] : []));
  const named = sequence !== undefined && visits.includes(sequence - 1) ? [sequence - 1] : visits;
  const scheduled = named.map((position) => context.schedule.scheduledTimeAt(staticTrip.row, position, time)).filter((at) => at !== null);
  if (scheduled.length === 0) return null;
  return time - scheduled.reduce((best, at) => (Math.abs(time - at) < Math.abs(time - best) ? at : best));
}

// When a trip the feed knows is due at, or was at, a stop on its pattern: the feed's time where it
// lists the stop, or else the schedule plus the delay at the first stop it lists, as delays carry
// forward. A stop it has passed, which the feed no longer lists, is before now, so whatever reads
// the time counts the vehicle as gone from there, even where the delay later on says otherwise.
function timeAtPosition(context: VehicleContext, trip: RtTrip, staticTrip: { row: number }, pattern: PatternRow, position: number): TimeAt | null {
  const { schedule, now } = context;
  const stop = schedule.stop(pattern.stops[position]!);
  // On a loop that makes the stop twice, the update whose stop sequence names this visit.
  const listed = trip.stops.flatMap((update, index) => (update.stopId === stop.stopId ? [index] : []));
  const index = listed.find((index) => trip.stops[index]!.sequence === position + 1) ?? listed[0];
  if (index !== undefined) return timeAt(context, trip, index, staticTrip, pattern, stop);
  const scheduled = schedule.scheduledTimeAt(staticTrip.row, position, now);
  if (scheduled === null) return null;
  let delay: number | null = null;
  for (const [listed, update] of trip.stops.entries()) {
    const at = schedule.stopsByKey.get(stopKey(trip.agency, update.stopId));
    const time = at && !update.skipped ? timeAt(context, trip, listed, staticTrip, pattern, at) : null;
    if (time?.delay !== null && time?.delay !== undefined) {
      delay = time.delay;
      break;
    }
  }
  const at = scheduled + (delay ?? 0);
  return { at: gone(schedule, trip, pattern, position) ? Math.min(at, now - 1) : at, delay };
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
