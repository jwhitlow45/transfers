import type { TrackLeg, TrackResponse } from '../../shared/api.ts';
import { bearingDegrees, distanceMeters, type Point } from '../geo.ts';
import { RequestError } from '../http.ts';
import type { RtStopTime, RtTrip, RtVehicle, TripSnapshot, VehicleSnapshot } from '../realtime/snapshot.ts';
import type { Schedule, StopRow } from '../schedule.ts';
import { headingOf } from './links.ts';
import { projector, shapePoints } from './shapes.ts';
import { Tables } from './views.ts';

// Stops drawn before the rider's when the vehicle has no position to start from.
const STOPS_BEFORE = 3;
// A route's line passes its stops within this distance, as stops sit at the curb beside it.
const PASS_METERS = 60;

// `marks` are other stops of the rider's to show on the way, such as where they get on and where
// they transfer.
// `span` is the stretch of the trip, by stop position, that an open map already shows: it is
// drawn again whatever the vehicle has done since, so the stops stay put while the vehicle moves.
// `transfer` is the vehicle the rider changes to, and the stop where they board it. `fitOnBoard`
// is the rider's setting to zoom a pinned map in once the vehicle leaves where they get on.
// `whole` draws the trip from its first stop to its last instead, whatever the span.
type TrackRequest = { trip: string; stop: string; marks?: string[]; span?: [number, number]; transfer?: TrackRequest; fitOnBoard?: boolean; whole?: boolean };

// The trip and where it visits the rider's stop, or a 404 when the trip is not in the schedule or
// does not stop there. Called before waiting on 511 too, so a bad request is turned away at once.
export function trackTarget(schedule: Schedule, request: TrackRequest) {
  const trip = schedule.trips.get(request.trip);
  const pattern = trip ? schedule.patterns.get(trip.pattern) : undefined;
  // Trips 511 runs that its published schedule leaves out have no line or stops to draw.
  if (!trip || !pattern) throw new RequestError(404, 'This trip is not in the published schedule, so there is no map for it');
  const target = schedule.stopsByKey.get(request.stop);
  if (!target) throw new RequestError(404, `No stop ${request.stop}`);
  const visits = visitsTo(schedule, pattern.stops, target);
  if (visits.length === 0) throw new RequestError(404, 'That trip does not stop there');
  return { trip, pattern, target, visits };
}

// The rider's stops on this trip, given in the order their journey makes them, such as where they
// get on and then where they transfer. Each way of fitting the journey to the trip starts at one
// visit to the first stop it makes, with each later stop at the first visit after the one before,
// so on a loop the transfer never comes before boarding. The journey is the first fit still under
// way when the vehicle gets where it is going, or else the last. A stop the trip does not make,
// or not in that order, is left out.
export function markVisits(schedule: Schedule, patternStops: number[], keys: string[], vehicleAt: number) {
  const visits = keys.map((key) => {
    const stop = schedule.stopsByKey.get(key);
    return stop ? visitsTo(schedule, patternStops, stop) : [];
  });
  const first = visits.findIndex((list) => list.length > 0);
  if (first === -1) return keys.map(() => null);
  const fits = visits[first]!.map((start) => {
    let floor = start;
    return visits.map((list, n) => {
      if (n < first) return null;
      if (n === first) return start;
      const visit = list.find((index) => index >= floor);
      if (visit === undefined) return null;
      floor = visit;
      return visit;
    });
  });
  // A fit that makes every later stop beats one that runs out of trip.
  const whole = fits.filter((fit) => fit.slice(first).every((visit) => visit !== null));
  const candidates = whole.length > 0 ? whole : fits;
  return candidates.find((fit) => Math.max(...fit.filter((visit) => visit !== null)) >= vehicleAt) ?? candidates.at(-1)!;
}

// Where along its stops a trip calls at a stop. A station is called at by its platforms.
export function visitsTo(schedule: Schedule, patternStops: number[], stop: StopRow) {
  const platforms = new Set(schedule.boardingStops(stop).map(({ id }) => id));
  return patternStops.flatMap((id, index) => (platforms.has(id) ? [index] : []));
}

type Live = { vehicles: VehicleSnapshot | null; trips?: TripSnapshot | null };

// A vehicle's live map: its trip's line from where the vehicle is to one stop past the rider's,
// with the stops on the way and the vehicle itself. `trips` gives when it is due at each stop, and
// places a vehicle that reports no position. With `transfer`, the vehicle the rider changes to is
// drawn on the same map. A transfer trip the schedule lacks, or that does not stop where asked, is
// left off rather than failing the map.
export function trackVehicle(schedule: Schedule, live: Live, request: TrackRequest, now: number): TrackResponse {
  const leg = placeLeg(schedule, live, request, now);
  let transfer: Leg | null = null;
  if (request.transfer) {
    try {
      transfer = placeLeg(schedule, live, request.transfer, now);
    } catch (error) {
      if (!(error instanceof RequestError)) throw error;
    }
  }
  // The middle of the stops drawn, or of the pinned spans, leaving out the vehicles, so an open map
  // keeps every stop at the same place on each refresh while only the vehicles move.
  const centered = [...leg.centered, ...(transfer?.centered ?? [])];
  const center = {
    lat: (Math.min(...centered.map(({ lat }) => lat)) + Math.max(...centered.map(({ lat }) => lat))) / 2,
    lon: (Math.min(...centered.map(({ lon }) => lon)) + Math.max(...centered.map(({ lon }) => lon))) / 2,
  };
  const project = projector(center);
  const tables = new Tables(schedule);
  return {
    generatedAt: now,
    dataAt: (leg.estimate?.source === 'predicted' ? live.trips?.fetchedAt : live.vehicles?.fetchedAt) ?? null,
    center: { lat: Number(center.lat.toFixed(6)), lon: Number(center.lon.toFixed(6)) },
    ...drawLeg(schedule, leg, project, tables),
    ...(transfer ? { transfer: drawLeg(schedule, transfer, project, tables) } : {}),
    routes: tables.routes,
    stops: tables.stops,
  };
}

type Leg = ReturnType<typeof placeLeg>;

// Where one vehicle is along its trip, where the rider's stops are on it, and which stretch of it
// to draw, before any of it is placed on the picture.
function placeLeg(schedule: Schedule, live: Live, request: TrackRequest, now: number) {
  const { trip, pattern, target, visits } = trackTarget(schedule, request);
  const stops = pattern.stops.map((id) => schedule.stop(id));
  // Where the line passes each stop, found in travel order from the trip's start, so a loop, or a
  // street the route comes back along, matches the pass the trip makes there.
  const shape = pattern.shape === null ? [] : shapePoints(schedule, pattern.shape);
  const passes: number[] = [];
  for (const stop of stops) passes.push(passAt(shape, stop, passes.at(-1) ?? 0));

  const reported = live.vehicles?.byTrip.get(request.trip) ?? null;
  // When the vehicle is due at each stop, for the list and for placing a vehicle that reports no
  // position: BART and the ferry report none, nor does a bus whose GPS is off.
  const rt = live.trips?.trips.get(request.trip);
  const expected = expectedTimes(schedule, trip.row, stops, rt, now);
  const estimate = reported ? null : estimatePlace(stops, { shape, passes }, expected, rt?.canceled ?? false, now);
  const vehicle: Point | null = reported ?? estimate?.point ?? null;
  const missing = vehicle ? undefined : estimate?.missing;
  const vehicleAt = reported ? placeOf(schedule, trip.row, stops, { shape, passes }, reported, now) : (estimate?.next ?? -1);
  const marked = markVisits(schedule, pattern.stops, request.marks ?? [], vehicleAt);
  // The stop watched is at its place in the rider's journey when it is one of their marked stops.
  // Otherwise, on a trip that makes it twice, as on a loop, it is the visit the vehicle reaches
  // next, or the last once it has made them all.
  const watched = marked[(request.marks ?? []).indexOf(request.stop)];
  const targetAt = watched ?? visits.find((index) => index >= vehicleAt) ?? visits.at(-1)!;
  const coming = vehicleAt !== -1 && vehicleAt <= targetAt;
  // The rider's marked stops still ahead of the vehicle, or all of them with no position. A fresh
  // picture leaves out stops the vehicle has passed, so fitting it later zooms in.
  const markedAt = marked.filter((index): index is number => index !== null && (vehicleAt === -1 || index >= vehicleAt - 1));
  // From the stop behind the vehicle, so it sits on the line, to one past the rider's, or on to
  // the vehicle when it has gone past, and taking in the marked stops ahead.
  const span = request.span && request.span[0] >= 0 && request.span[0] <= request.span[1] && request.span[1] < stops.length ? request.span : null;
  // Once the vehicle has left where the rider gets on, their first marked stop, a pinned picture
  // drops what came before it, once, so a long ride zooms in on what is left of it, when the
  // rider has that setting on.
  const boardAt = marked.find((index) => index !== null) ?? null;
  const pinnedFrom = span && request.fitOnBoard && boardAt !== null && vehicleAt > boardAt ? Math.max(span[0], boardAt) : span?.[0];
  // A pinned span grows only to take in a vehicle that has left it, so it stays on the line, or the
  // stop watched, when a loop moves it to a visit outside.
  // The stop behind the vehicle, so it sits on the line rather than off its start.
  const behind = vehicleAt === -1 ? Infinity : Math.max(0, Math.min(vehicleAt - 1, estimate?.from ?? vehicleAt));
  // Past the stop watched with more of the rider's stops ahead, as when they have boarded and
  // watch where they got on, the picture follows the ride on from the vehicle, and the stop
  // watched is drawn only if it falls within.
  const aboard = vehicleAt > targetAt && markedAt.some((index) => index >= vehicleAt);
  // A pinned picture reaches forward for the stop watched, when a loop moves it to a later visit,
  // but never back: a stop before where it starts was left out on purpose, by a fit or the zoom in
  // after boarding, and stays out whatever the vehicle's position does later.
  const ahead = span && targetAt >= pinnedFrom! ? [targetAt] : [];
  const from = request.whole ? 0 : span ? Math.min(pinnedFrom!, behind) : Math.max(0, Math.min(coming || aboard ? behind : targetAt - STOPS_BEFORE, ...markedAt));
  const to = request.whole ? stops.length - 1 : span ? Math.max(span[1], vehicleAt, ...ahead) : Math.min(stops.length - 1, Math.max(aboard ? -1 : targetAt + 1, vehicleAt, ...markedAt));
  const shown = stops.slice(from, to + 1);
  const centered = span && !request.whole ? stops.slice(pinnedFrom!, span[1] + 1) : shown;
  return { trip, pattern, target, stops, shape, passes, rt, expected, reported, estimate, vehicle, missing, vehicleAt, targetAt, coming, marked, from, to, shown, centered };
}

// One leg placed on the picture: its line, its stops with when the vehicle is due at each, and the
// vehicle.
function drawLeg(schedule: Schedule, leg: Leg, project: (point: Point) => [number, number], tables: Tables): TrackLeg {
  const { trip, pattern, target, shape, passes, rt, expected, reported, estimate, missing, vehicleAt, targetAt, coming, marked, from, to, shown } = leg;
  // The stretch of the trip's shape between the first and last stops drawn.
  const stretch = shape.slice(passes[from], passes[to]! + 1).map(project);
  // Thinned to about 300 points across the picture, finer than a phone draws it, so a long ride
  // over the bridge stays as small as a short one.
  const [width, height] = ([0, 1] as const).map((axis) => Math.max(...stretch.map((point) => point[axis])) - Math.min(...stretch.map((point) => point[axis])));
  const spacing = Math.max(5, Math.hypot(width!, height!) / 300);
  const line: [number, number][] = [];
  for (const point of stretch) {
    const last = line.at(-1);
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) >= spacing) line.push(point);
  }
  const final = stretch.at(-1);
  if (final && line.at(-1) !== final) line.push(final);
  return {
    route: tables.route(schedule.route(pattern.route)),
    headsign: headingOf(schedule, pattern, trip.headsign || pattern.headsign),
    target: tables.stop(schedule.stationOf(target)),
    path: shown.map((stop, index) => {
      const [x, y] = project(stop);
      // A canceled trip is due nowhere.
      return { stop: tables.stop(stop), x, y, at: rt?.canceled ? null : (expected.times[from + index] ?? null) };
    }),
    span: [from, to],
    targetIndex: targetAt >= from && targetAt <= to ? targetAt - from : null,
    // A marked stop outside what is drawn, such as one passed before the picture was fitted, has
    // no place in it.
    marks: marked.map((index) => (index === null || index < from || index > to ? null : index - from)),
    nextIndex: vehicleAt === -1 ? null : vehicleAt - from,
    line,
    vehicle: reported
      ? { ...pointOf(project(reported)), bearing: reported.bearing, at: reported.at }
      : estimate?.point
        ? { ...pointOf(project(estimate.point)), bearing: estimate.point.bearing, at: null, estimate: estimate.source }
        : null,
    ...(missing ? { missing } : {}),
    stopsAway: coming ? targetAt - vehicleAt : null,
    passed: vehicleAt > targetAt,
  };
}

const pointOf = ([x, y]: [number, number]) => ({ x, y });

// Where along its stops the vehicle is: the stop it reports heading to or standing at. A stop the
// trip makes twice is told apart by the sequence the vehicle reports, which Muni and SamTrans
// count from 1 along the trip, or else by which visit is scheduled nearest now. Golden Gate
// reports no stop, so its vehicles head to the first stop the line reaches past them, which the
// nearest stop alone would get wrong just after a stop. Where the line passes them twice, the
// pass whose next stop is scheduled nearest now is the one.
function placeOf(schedule: Schedule, tripRow: number, stops: StopRow[], line: { shape: Point[]; passes: number[] }, vehicle: RtVehicle, now: number) {
  const { sequence, stopId } = vehicle;
  const offBy = (index: number) => Math.abs((schedule.scheduledTimeAt(tripRow, index, now) ?? Infinity) - now);
  const soonest = (indexes: number[]) => indexes.reduce((best, index) => (offBy(index) < offBy(best) ? index : best));
  if (sequence !== null && stopId !== null && stops[sequence - 1]?.stopId === stopId) return sequence - 1;
  if (stopId === null && line.shape.length > 0) {
    const ahead = (along: number) => {
      const next = line.passes.findIndex((pass) => pass >= along);
      return next === -1 ? stops.length - 1 : next;
    };
    return soonest(passesNear(line.shape, vehicle).map(ahead));
  }
  const named = stopId ?? stops[nearest(stops, vehicle)]!.stopId;
  const visits = stops.flatMap((stop, index) => (stop.stopId === named ? [index] : []));
  return visits.length === 0 ? nearest(stops, vehicle) : soonest(visits);
}

// Where a vehicle that reports no position should be: between the last stop it was due to leave
// and the next, as far along the line as the time between them has run. Without a place, why
// not: it is canceled, its trip has yet to start, or its trip has ended.
function estimatePlace(stops: StopRow[], line: { shape: Point[]; passes: number[] }, { times, predicted }: ReturnType<typeof expectedTimes>, canceled: boolean, now: number): Estimate {
  if (canceled) return { missing: 'canceled' };
  const next = times.findIndex((time) => time !== null && time > now);
  if (next === 0) return { missing: 'not-started' };
  if (next === -1) return times.some((time) => time !== null) ? { missing: 'ended' } : {};
  // From the last stop it was due at, passing over a skipped one, which has no time. With none
  // left yet, as when its first stop is skipped, it has not started.
  const left = times.findLastIndex((time, index) => index < next && time !== null);
  if (left === -1) return { missing: 'not-started' };
  const arrives = times[next]!;
  const share = Math.min(1, Math.max(0, (now - times[left]!) / (arrives - times[left]!)));
  const point = alongLine(line.shape, line.passes[left]!, line.passes[next]!, share, stops[left]!, stops[next]!);
  return { next, from: left, point, source: predicted ? 'predicted' : 'scheduled' };
}

type Estimate =
  | { next: number; from: number; point: Point & { bearing: number | null }; source: 'predicted' | 'scheduled'; missing?: undefined }
  | { missing?: 'canceled' | 'not-started' | 'ended'; next?: undefined; from?: undefined; point?: undefined; source?: undefined };

// When the trip is due at each stop: the feed's predicted time where it lists the stop, or else
// the schedule plus the latest delay before it, as GTFS-realtime says delays carry forward. A
// prediction with only a time carries the delay it implies. Without the trip in the feed, the
// schedule alone. `near` picks the day's run the schedule means, the one running nearest it.
export function expectedTimes(schedule: Schedule, tripRow: number, stops: StopRow[], rt: RtTrip | undefined, now: number, near = now) {
  const scheduled = stops.map((_, index) => schedule.scheduledTimeAt(tripRow, index, near));
  // The feed's stops matched to positions in order. The feed drops visits already made, so a stop
  // a loop makes twice is told apart by the update's stop sequence, or else by which visit is
  // scheduled nearest its predicted time. The schedule keeps positions rather than GTFS
  // stop_sequence, so this assumes sequences count 1, 2, 3 along the trip, as placeOf does. A feed
  // that numbers otherwise rarely names a matching visit and falls back to time.
  const listed = new Map<number, RtStopTime>();
  let from = 0;
  for (const update of rt?.stops ?? []) {
    const visits = stops.flatMap((stop, index) => (index >= from && stop.stopId === update.stopId ? [index] : []));
    if (visits.length === 0) continue;
    const offBy = (index: number) => (update.time === null || scheduled[index] === null ? Infinity : Math.abs(update.time - scheduled[index]!));
    const bySequence = update.sequence !== undefined && visits.includes(update.sequence - 1) ? update.sequence - 1 : null;
    const at = bySequence ?? visits.reduce((best, index) => (offBy(index) < offBy(best) ? index : best));
    listed.set(at, update);
    from = at + 1;
  }
  // The feed's own delay at each stop it lists, which on BART can differ by a minute or so from its
  // time less the schedule here. The results show this one.
  const reported = scheduled.map((_, index) => listed.get(index)?.delay ?? null);
  if (listed.size === 0) return { times: scheduled, scheduled, reported, predicted: false };
  const delayAt = (index: number, update: RtStopTime) => update.delay ?? (update.time !== null && scheduled[index] !== null ? update.time - scheduled[index]! : null);
  const first = Math.min(...listed.keys());
  let delay = delayAt(first, listed.get(first)!) ?? 0;
  const times = scheduled.map((time, index) => {
    // The feed lists only stops still ahead, so the trip has left every stop before its first.
    if (index < first) return time === null ? null : Math.min(time + delay, now);
    const update = listed.get(index);
    if (update?.skipped) return null;
    const known = update ? delayAt(index, update) : null;
    if (known !== null) delay = known;
    if (update?.time !== null && update?.time !== undefined) return update.time;
    return time === null ? null : time + delay;
  });
  return { times, scheduled, reported, predicted: true };
}

// The point a share of the way along the line from one shape point to another, and the way the
// line heads there. With no shape between them, the straight line between the two stops.
function alongLine(shape: Point[], from: number, to: number, share: number, start: Point, end: Point) {
  const stretch = shape.length > 0 && to > from ? shape.slice(from, to + 1) : [start, end];
  const lengths = stretch.slice(1).map((point, index) => distanceMeters(stretch[index]!, point));
  let remaining = share * lengths.reduce((sum, length) => sum + length, 0);
  for (const [index, length] of lengths.entries()) {
    if (remaining > length && index < lengths.length - 1) {
      remaining -= length;
      continue;
    }
    const [a, b] = [stretch[index]!, stretch[index + 1]!];
    const part = length === 0 ? 0 : Math.min(1, remaining / length);
    return { lat: a.lat + (b.lat - a.lat) * part, lon: a.lon + (b.lon - a.lon) * part, bearing: length === 0 ? null : Math.round(bearingDegrees(a, b)) };
  }
  return { lat: start.lat, lon: start.lon, bearing: null };
}

// Each time the line passes a place: the closest point of each run of points within
// PASS_METERS of it, or else the line's nearest point.
function passesNear(shape: Point[], place: Point) {
  const passes: number[] = [];
  let within = false;
  for (const [index, point] of shape.entries()) {
    const meters = distanceMeters(point, place);
    if (meters > PASS_METERS) within = false;
    else if (!within) {
      within = true;
      passes.push(index);
    } else if (meters < distanceMeters(shape[passes.at(-1)!]!, place)) passes[passes.length - 1] = index;
  }
  return passes.length > 0 ? passes : [nearest(shape, place)];
}

// The shape point where the line passes a stop, searching on from `from`: the closest point of
// the first pass that comes within PASS_METERS, so a later pass by the same corner is not taken
// for it. A stop the line never comes that near takes the closest point after `from`.
function passAt(shape: Point[], stop: Point, from: number) {
  let best = -1;
  for (let index = from; index < shape.length; index++) {
    const meters = distanceMeters(shape[index]!, stop);
    if (best === -1) {
      if (meters <= PASS_METERS) best = index;
      continue;
    }
    const closest = distanceMeters(shape[best]!, stop);
    if (meters < closest) best = index;
    else if (meters > closest + PASS_METERS) break;
  }
  return best !== -1 ? best : from + nearest(shape.slice(from), stop);
}

function nearest(points: (Point | StopRow)[], to: Point) {
  let best = 0;
  for (let index = 1; index < points.length; index++) {
    if (distanceMeters(points[index]!, to) < distanceMeters(points[best]!, to)) best = index;
  }
  return best;
}
