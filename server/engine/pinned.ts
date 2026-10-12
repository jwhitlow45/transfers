import type { PinRequest, PinnedLeg, PinnedStop, PinnedTrip } from '../../shared/api.ts';
import { type RtTrip, type TripSnapshot, stopKey } from '../realtime/snapshot.ts';
import type { Schedule, StopRow } from '../schedule.ts';
import { SAME_RUN_SECONDS } from './realtime-view.ts';
import { expectedTimes, visitsTo } from './track.ts';
import type { Tables } from './views.ts';

// A trip the rider pinned, as its vehicles run now. From and the destination come from the
// search, so changing the destination moves the end of the trip.
export function pinnedTrip(schedule: Schedule, snapshot: TripSnapshot | null, pin: PinRequest, from: string, dest: string[], tables: Tables, now: number): PinnedTrip {
  const second = pinnedLeg(schedule, snapshot, pin.second.trip, pin.second.board, dest, { on: pin.at }, tables, now);
  if (!pin.first) return { second };
  // A pin from before the first vehicle's own time was kept names it by the second's, just after.
  return { first: pinnedLeg(schedule, snapshot, pin.first.trip, from, [pin.first.alight], { off: pin.first.at ?? pin.at }, tables, now), second };
}

// Which of a trip's visits to the rider's stops the pin means, on a trip that makes one twice, as
// a loop does: the one scheduled nearest the pinned time, where the rider gets on the second
// vehicle and off the first. Fixed by the schedule rather than where the vehicle is, so the times
// stay those of the same visits as it goes. The first vehicle picks the rider up at its visit to
// From before that.
type Anchor = { on: number } | { off: number };

// When one vehicle is due where the rider gets on it and off it, as the live map works it out:
// predictions where the feed has them, carried forward, and the schedule otherwise. The rider gets
// off at the first of `off` the vehicle reaches, as a ride straight to a stop may end across the
// street from it.
function pinnedLeg(schedule: Schedule, snapshot: TripSnapshot | null, trip: string, on: string, off: string[], anchor: Anchor, tables: Tables, now: number): PinnedLeg | null {
  const onStop = schedule.stopsByKey.get(on);
  const offStops = off.flatMap((key) => schedule.stopsByKey.get(key) ?? []);
  if (!onStop) return null;
  const near = 'on' in anchor ? anchor.on : anchor.off;
  const rt = Math.abs(near - now) <= SAME_RUN_SECONDS ? snapshot?.trips.get(trip) : undefined;
  const row = schedule.trips.get(trip);
  const pattern = row ? schedule.patterns.get(row.pattern) : undefined;
  if (!row || !pattern) return rt ? addedLeg(schedule, rt, trip, onStop, offStops, tables) : null;
  const stops = pattern.stops.map((id) => schedule.stop(id));
  const { times, scheduled, reported, predicted } = expectedTimes(schedule, row.row, stops, rt, now, near);
  const onVisits = visitsTo(schedule, pattern.stops, onStop);
  const offVisits = offStops.flatMap((stop) => visitsTo(schedule, pattern.stops, stop)).sort((a, b) => a - b);
  const offStopAt = (index: number) => offStops.find((stop) => visitsTo(schedule, pattern.stops, stop).includes(index))!;
  const gap = (index: number, time: number) => Math.abs((scheduled[index] ?? Infinity) - time);
  const nearest = (visits: number[], time: number) => (visits.length === 0 ? null : visits.reduce((best, index) => (gap(index, time) < gap(best, time) ? index : best)));
  let onAt: number | null;
  let offAt: number | null;
  if ('on' in anchor) {
    onAt = nearest(onVisits, anchor.on);
    offAt = onAt === null ? null : (offVisits.find((index) => index > onAt!) ?? null);
  } else {
    offAt = nearest(offVisits, anchor.off);
    onAt = offAt === null ? nearest(onVisits, anchor.off) : ([...onVisits].reverse().find((index) => index < offAt!) ?? null);
  }
  const at = (index: number | null | undefined, stop: StopRow): PinnedStop | null => {
    const time = index === null || index === undefined ? null : times[index];
    if (time === null || time === undefined) return null;
    const planned = scheduled[index!];
    // As the results count it: the feed's own delay where it gives one.
    const delay = !predicted ? null : (reported[index!] ?? (planned === null || planned === undefined ? null : time - planned));
    return { stop: tables.stop(stop), at: time, delay };
  };
  return {
    trip,
    route: tables.route(schedule.route(pattern.route)),
    on: at(onAt, onStop),
    // The destination only counts once the vehicle has picked the rider up.
    off: onAt !== null && offAt !== null && offAt > onAt ? at(offAt, offStopAt(offAt)) : null,
    live: predicted,
    ...(rt?.canceled ? { canceled: true } : {}),
  };
}

// A trip the schedule lacks, such as an extra BART train, known only by the feed, which lists
// only the stops still ahead of it, so a stop it has passed comes back null. `added` tells the page
// to keep the time it last had.
function addedLeg(schedule: Schedule, rt: RtTrip, trip: string, onStop: StopRow, offStops: StopRow[], tables: Tables): PinnedLeg | null {
  const route = schedule.routesByKey.get(`${rt.agency}:${rt.routeId}`);
  if (!route) return null;
  const keys = (stop: StopRow) => new Set(schedule.boardingStops(stop).map((platform) => stopKey(platform.agency, platform.stopId)));
  const find = (stop: StopRow, after: number) => {
    const platforms = keys(stop);
    const index = rt.stops.findIndex((update, position) => position > after && platforms.has(stopKey(rt.agency, update.stopId)));
    return index === -1 ? null : index;
  };
  const onAt = find(onStop, -1);
  const offs = offStops.flatMap((stop) => {
    const index = find(stop, onAt ?? -1);
    return index === null ? [] : [{ index, stop }];
  });
  const offAt = offs.sort((a, b) => a.index - b.index)[0];
  const at = (index: number | null, stop: StopRow): PinnedStop | null => {
    const update = index === null ? undefined : rt.stops[index];
    if (!update || update.skipped || update.time === null) return null;
    return { stop: tables.stop(stop), at: update.time, delay: update.delay };
  };
  return { trip, route: tables.route(route), on: at(onAt, onStop), off: offAt ? at(offAt.index, offAt.stop) : null, live: true, added: true, ...(rt.canceled ? { canceled: true } : {}) };
}
