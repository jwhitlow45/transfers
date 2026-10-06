import type { PinnedLeg, PinnedStop, PinnedTrip } from '../../shared/api.ts';
import { type RtTrip, type TripSnapshot, stopKey } from '../realtime/snapshot.ts';
import type { Schedule, StopRow } from '../schedule.ts';
import { expectedTimes, visitsTo } from './track.ts';
import type { Tables } from './views.ts';

// A trip the rider pinned: each vehicle by trip key, and the stops where they leave it and board
// the next. From and the destination come from the search, so changing the destination moves the
// end of the trip. `at` is when the last vehicle was due where the rider boards it, as they
// pinned it, which tells that day's run of each trip from the same trip on other days.
export type PinRequest = { first?: { trip: string; alight: string }; second: { trip: string; board: string }; at: number };

// Predictions are for a trip's run today. A run pinned further from now than this is another
// day's, which keeps to its schedule.
const SAME_RUN_SECONDS = 6 * 3600;

export function pinnedTrip(schedule: Schedule, snapshot: TripSnapshot | null, pin: PinRequest, from: string, dest: string | undefined, tables: Tables, now: number): PinnedTrip {
  const second = pinnedLeg(schedule, snapshot, pin.second.trip, pin.second.board, dest, { at: pin.at }, tables, now);
  if (!pin.first) return { second };
  return { first: pinnedLeg(schedule, snapshot, pin.first.trip, from, pin.first.alight, { before: pin.at }, tables, now), second };
}

// Which of a trip's visits to the rider's stops the pin means, on a trip that makes one twice, as
// a loop does. Fixed by the pinned run's schedule rather than where the vehicle is, so the times
// stay those of the same visits as it goes. The second vehicle boards at the visit due nearest the
// pinned time. The first lets the rider off at the last visit before then, which they boarded at
// the visit before that.
type Anchor = { at: number } | { before: number };

// When one vehicle is due where the rider gets on it and off it, as the live map works it out:
// predictions where the feed has them, carried forward, and the schedule otherwise.
function pinnedLeg(schedule: Schedule, snapshot: TripSnapshot | null, trip: string, on: string, off: string | undefined, anchor: Anchor, tables: Tables, now: number): PinnedLeg | null {
  const onStop = schedule.stopsByKey.get(on);
  const offStop = off === undefined ? undefined : schedule.stopsByKey.get(off);
  if (!onStop) return null;
  const near = 'at' in anchor ? anchor.at : anchor.before;
  const rt = Math.abs(near - now) <= SAME_RUN_SECONDS ? snapshot?.trips.get(trip) : undefined;
  const row = schedule.trips.get(trip);
  const pattern = row ? schedule.patterns.get(row.pattern) : undefined;
  if (!row || !pattern) return rt ? addedLeg(schedule, rt, trip, onStop, offStop, tables) : null;
  const stops = pattern.stops.map((id) => schedule.stop(id));
  const { times, scheduled, predicted } = expectedTimes(schedule, row.row, stops, rt, now, near);
  const onVisits = visitsTo(schedule, pattern.stops, onStop);
  const offVisits = offStop ? visitsTo(schedule, pattern.stops, offStop) : [];
  const gap = (index: number, time: number) => Math.abs((scheduled[index] ?? Infinity) - time);
  const nearest = (visits: number[], time: number) => (visits.length === 0 ? null : visits.reduce((best, index) => (gap(index, time) < gap(best, time) ? index : best)));
  let onAt: number | null;
  let offAt: number | null;
  if ('at' in anchor) {
    onAt = nearest(onVisits, anchor.at);
    offAt = onAt === null ? null : (offVisits.find((index) => index > onAt!) ?? null);
  } else {
    const before = offVisits.filter((index) => (scheduled[index] ?? Infinity) <= anchor.before);
    offAt = before.at(-1) ?? nearest(offVisits, anchor.before);
    onAt = offAt === null ? nearest(onVisits, anchor.before) : ([...onVisits].reverse().find((index) => index < offAt!) ?? null);
  }
  const at = (index: number | null | undefined, stop: StopRow): PinnedStop | null => {
    const time = index === null || index === undefined ? null : times[index];
    if (time === null || time === undefined) return null;
    const planned = scheduled[index!];
    return { stop: tables.stop(stop), at: time, delay: predicted && planned !== null && planned !== undefined ? time - planned : null };
  };
  return {
    trip,
    route: tables.route(schedule.route(pattern.route)),
    on: at(onAt, onStop),
    // The destination only counts once the vehicle has picked the rider up.
    off: offStop && onAt !== null && offAt !== null && offAt > onAt ? at(offAt, offStop) : null,
    live: predicted,
    ...(rt?.canceled ? { canceled: true } : {}),
  };
}

// A trip the schedule lacks, such as an extra BART train, known only by the feed, which lists
// only the stops still ahead of it, so a stop it has passed comes back null. `added` tells the page
// to keep the time it last had.
function addedLeg(schedule: Schedule, rt: RtTrip, trip: string, onStop: StopRow, offStop: StopRow | undefined, tables: Tables): PinnedLeg | null {
  const route = schedule.routesByKey.get(`${rt.agency}:${rt.routeId}`);
  if (!route) return null;
  const keys = (stop: StopRow) => new Set(schedule.boardingStops(stop).map((platform) => stopKey(platform.agency, platform.stopId)));
  const find = (stop: StopRow, after: number) => {
    const platforms = keys(stop);
    const index = rt.stops.findIndex((update, position) => position > after && platforms.has(stopKey(rt.agency, update.stopId)));
    return index === -1 ? null : index;
  };
  const onAt = find(onStop, -1);
  const offAt = offStop ? find(offStop, onAt ?? -1) : null;
  const at = (index: number | null, stop: StopRow): PinnedStop | null => {
    const update = index === null ? undefined : rt.stops[index];
    if (!update || update.skipped || update.time === null) return null;
    return { stop: tables.stop(stop), at: update.time, delay: update.delay };
  };
  return { trip, route: tables.route(route), on: at(onAt, onStop), off: offStop ? at(offAt, offStop) : null, live: true, added: true, ...(rt.canceled ? { canceled: true } : {}) };
}
