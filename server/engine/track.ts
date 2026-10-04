import type { TrackResponse } from '../../shared/api.ts';
import { bearingDegrees, distanceMeters, type Point } from '../geo.ts';
import type { RtStopTime, RtTrip, RtVehicle, TripSnapshot, VehicleSnapshot } from '../realtime/snapshot.ts';
import type { Schedule, StopRow } from '../schedule.ts';
import { projector, shapePoints } from './shapes.ts';
import { RequestError } from './trip.ts';
import { Tables } from './views.ts';

// Stops drawn before the rider's when the vehicle has no position to start from.
const STOPS_BEFORE = 3;
// A route's line passes its stops within this distance, as stops sit at the curb beside it.
const PASS_METERS = 60;

// `marks` are other stops of the rider's to show on the way, such as where they get on and where
// they transfer.
type TrackRequest = { trip: string; stop: string; marks?: string[] };

// The trip and where it visits the rider's stop, or a 404 when the trip is not in the schedule or
// does not stop there. Called before waiting on 511 too, so a bad request is turned away at once.
export function trackTarget(schedule: Schedule, request: TrackRequest) {
  const trip = schedule.trips.get(request.trip);
  const pattern = trip ? schedule.patterns.get(trip.pattern) : undefined;
  // Trips 511 runs that its published schedule leaves out have no line or stops to draw.
  if (!trip || !pattern) throw new RequestError(404, 'This trip is not in the published schedule, so there is no map for it');
  const target = schedule.stopsByKey.get(request.stop);
  if (!target) throw new RequestError(404, 'Unknown stop');
  const visits = visitsTo(schedule, pattern.stops, target);
  if (visits.length === 0) throw new RequestError(404, 'That trip does not stop there');
  return { trip, pattern, target, visits };
}

// Where along its stops a trip calls at a stop. A station is called at by its platforms.
function visitsTo(schedule: Schedule, patternStops: number[], stop: StopRow) {
  const platforms = new Set(schedule.boardingStops(stop).map(({ id }) => id));
  return patternStops.flatMap((id, index) => (platforms.has(id) ? [index] : []));
}

// A vehicle's live map: its trip's line from where the vehicle is to one stop past the rider's,
// with the stops on the way and the vehicle itself. `trips` places a vehicle that reports no
// position.
export function trackVehicle(schedule: Schedule, live: { vehicles: VehicleSnapshot | null; trips?: TripSnapshot | null }, request: TrackRequest, now: number): TrackResponse {
  const { trip, pattern, target, visits } = trackTarget(schedule, request);
  const stops = pattern.stops.map((id) => schedule.stop(id));
  // Where the line passes each stop, found in travel order from the trip's start, so a loop, or a
  // street the route comes back along, matches the pass the trip makes there.
  const shape = pattern.shape === null ? [] : shapePoints(schedule, pattern.shape);
  const passes: number[] = [];
  for (const stop of stops) passes.push(passAt(shape, stop, passes.at(-1) ?? 0));

  const reported = live.vehicles?.byTrip.get(request.trip) ?? null;
  // BART and the ferry report no positions, nor does a bus whose GPS is off, so those vehicles
  // are placed by when they are due at their stops.
  const estimate = reported ? null : estimatePlace(schedule, trip.row, stops, { shape, passes }, live.trips?.trips.get(request.trip), now);
  const vehicle: Point | null = reported ?? estimate?.point ?? null;
  const missing = vehicle ? undefined : estimate?.missing;
  const vehicleAt = reported ? placeOf(schedule, trip.row, stops, { shape, passes }, reported, now) : (estimate?.next ?? -1);
  // A trip that makes the rider's stop twice, as on a loop, is watched to the visit it reaches
  // next, or the last once it has made them all.
  const targetAt = visits.find((index) => index >= vehicleAt) ?? visits.at(-1)!;
  const coming = vehicleAt !== -1 && vehicleAt <= targetAt;
  const passed = vehicleAt > targetAt;
  // The rider's other stops on this trip, at the visit nearest the one watched. A stop the trip
  // does not make is left out.
  const marked = (request.marks ?? []).map((key) => {
    const stop = schedule.stopsByKey.get(key);
    const markVisits = stop ? visitsTo(schedule, pattern.stops, stop) : [];
    return markVisits.length === 0 ? null : markVisits.reduce((best, index) => (Math.abs(index - targetAt) < Math.abs(best - targetAt) ? index : best));
  });
  const markedAt = marked.filter((index) => index !== null);
  // From the stop behind the vehicle, so it sits on the line, to one past the rider's, or on to
  // the vehicle when it has gone past, and taking in every marked stop.
  const from = Math.max(0, Math.min(coming ? Math.min(vehicleAt - 1, estimate?.from ?? vehicleAt) : targetAt - STOPS_BEFORE, ...markedAt));
  const to = Math.min(stops.length - 1, Math.max(targetAt + 1, vehicleAt, ...markedAt));
  const shown = stops.slice(from, to + 1);

  // The middle of everything drawn, so the picture centers on the trip from vehicle to stop.
  const places: Point[] = [...shown, ...(vehicle ? [vehicle] : [])];
  const project = projector({
    lat: (Math.min(...places.map(({ lat }) => lat)) + Math.max(...places.map(({ lat }) => lat))) / 2,
    lon: (Math.min(...places.map(({ lon }) => lon)) + Math.max(...places.map(({ lon }) => lon))) / 2,
  });

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

  const tables = new Tables(schedule);
  const route = schedule.route(pattern.route);
  return {
    generatedAt: now,
    dataAt: (estimate?.source === 'predicted' ? live.trips?.fetchedAt : live.vehicles?.fetchedAt) ?? null,
    route: tables.route(route),
    headsign: trip.headsign || pattern.headsign,
    target: tables.stop(schedule.stationOf(target)),
    path: shown.map((stop) => {
      const [x, y] = project(stop);
      return { stop: tables.stop(stop), x, y };
    }),
    targetIndex: targetAt - from,
    marks: marked.map((index) => (index === null ? null : index - from)),
    nextIndex: vehicleAt === -1 ? null : vehicleAt - from,
    line,
    vehicle: reported
      ? { ...pointOf(project(reported)), bearing: reported.bearing, at: reported.at }
      : estimate?.point
        ? { ...pointOf(project(estimate.point)), bearing: estimate.point.bearing, at: null, estimate: estimate.source }
        : null,
    ...(missing ? { missing } : {}),
    stopsAway: coming ? targetAt - vehicleAt : null,
    passed,
    routes: tables.routes,
    stops: tables.stops,
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
function estimatePlace(schedule: Schedule, tripRow: number, stops: StopRow[], line: { shape: Point[]; passes: number[] }, rt: RtTrip | undefined, now: number): Estimate {
  if (rt?.canceled) return { missing: 'canceled' };
  const { times, predicted } = expectedTimes(schedule, tripRow, stops, rt, now);
  const next = times.findIndex((time) => time !== null && time > now);
  if (next === 0) return { missing: 'not-started' };
  if (next === -1) return times.some((time) => time !== null) ? { missing: 'ended' } : {};
  // From the last stop it was due at, passing over a skipped one, which has no time.
  const left = times.findLastIndex((time, index) => index < next && time !== null);
  const from = left === -1 ? next - 1 : left;
  const arrives = times[next]!;
  const share = left === -1 ? 0 : Math.min(1, Math.max(0, (now - times[left]!) / (arrives - times[left]!)));
  const point = alongLine(line.shape, line.passes[from]!, line.passes[next]!, share, stops[from]!, stops[next]!);
  return { next, from, point, source: predicted ? 'predicted' : 'scheduled' };
}

type Estimate =
  | { next: number; from: number; point: Point & { bearing: number | null }; source: 'predicted' | 'scheduled'; missing?: undefined }
  | { missing?: 'canceled' | 'not-started' | 'ended'; next?: undefined; from?: undefined; point?: undefined; source?: undefined };

// When the trip is due at each stop: the feed's predicted time where it lists the stop, or else
// the schedule plus the latest delay before it, as GTFS-realtime says delays carry forward. A
// prediction with only a time carries the delay it implies. Without the trip in the feed, the
// schedule alone.
function expectedTimes(schedule: Schedule, tripRow: number, stops: StopRow[], rt: RtTrip | undefined, now: number) {
  const scheduled = stops.map((_, index) => schedule.scheduledTimeAt(tripRow, index, now));
  // The feed's stops matched to positions in order. The feed drops visits already made, so a stop
  // a loop makes twice is told apart by the update's stop sequence, counted from 1 along the trip,
  // or else by which visit is scheduled nearest its predicted time.
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
  if (listed.size === 0) return { times: scheduled, predicted: false };
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
  return { times, predicted: true };
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
