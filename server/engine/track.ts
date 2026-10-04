import type { TrackResponse } from '../../shared/api.ts';
import { distanceMeters, type Point } from '../geo.ts';
import type { VehicleSnapshot } from '../realtime/snapshot.ts';
import type { Schedule, StopRow } from '../schedule.ts';
import { projector, shapePoints } from './shapes.ts';
import { RequestError } from './trip.ts';
import { Tables } from './views.ts';

// Stops drawn before the rider's when the vehicle has no position to start from.
const STOPS_BEFORE = 3;

// A vehicle's live map: its trip's line from where the vehicle is to one stop past the rider's,
// with the stops on the way and the vehicle itself.
export function trackVehicle(schedule: Schedule, vehicles: VehicleSnapshot | null, request: { trip: string; stop: string }, now: number): TrackResponse {
  const trip = schedule.trips.get(request.trip);
  const pattern = trip ? schedule.patterns.get(trip.pattern) : undefined;
  if (!trip || !pattern) throw new RequestError(404, 'That trip is not in the schedule');
  const target = schedule.stopsByKey.get(request.stop);
  if (!target) throw new RequestError(404, 'Unknown stop');
  // A station is boarded at one of its platforms.
  const boarding = new Set(schedule.boardingStops(target).map(({ id }) => id));
  const targetAt = pattern.stops.findIndex((id) => boarding.has(id));
  if (targetAt === -1) throw new RequestError(404, 'That trip does not stop there');
  const stops = pattern.stops.map((id) => schedule.stop(id));

  const vehicle = vehicles?.byTrip.get(request.trip) ?? null;
  // Where along its stops the vehicle is: the stop it reports heading to or standing at, or else
  // the nearest one.
  const reported = vehicle?.stopId ? stops.findIndex((stop) => stop.stopId === vehicle.stopId) : -1;
  const vehicleAt = !vehicle ? -1 : reported !== -1 ? reported : nearest(stops, vehicle);
  const coming = vehicleAt !== -1 && vehicleAt <= targetAt;
  const passed = vehicleAt > targetAt;
  // From the stop behind the vehicle, so it sits on the line, to one past the rider's, or on to
  // the vehicle when it has gone past.
  const from = Math.max(0, coming ? vehicleAt - 1 : targetAt - STOPS_BEFORE);
  const to = Math.min(stops.length - 1, Math.max(targetAt + 1, vehicleAt));
  const shown = stops.slice(from, to + 1);

  // The middle of everything drawn, so the picture centers on the trip from vehicle to stop.
  const places: Point[] = [...shown, ...(vehicle ? [vehicle] : [])];
  const project = projector({
    lat: (Math.min(...places.map(({ lat }) => lat)) + Math.max(...places.map(({ lat }) => lat))) / 2,
    lon: (Math.min(...places.map(({ lon }) => lon)) + Math.max(...places.map(({ lon }) => lon))) / 2,
  });

  // The stretch of the trip's shape between the first and last stops drawn. Searching on from the
  // first keeps a loop from matching its far side.
  const shape = pattern.shape === null ? [] : shapePoints(schedule, pattern.shape);
  const start = nearest(shape, shown[0]!);
  const end = start + nearest(shape.slice(start), shown.at(-1)!);
  const stretch = shape.slice(start, end + 1).map(project);
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
    dataAt: vehicles?.fetchedAt ?? null,
    route: tables.route(route),
    headsign: trip.headsign || pattern.headsign,
    target: tables.stop(schedule.stationOf(target)),
    path: shown.map((stop) => {
      const [x, y] = project(stop);
      return { stop: tables.stop(stop), x, y };
    }),
    targetIndex: targetAt - from,
    nextIndex: vehicleAt === -1 ? null : vehicleAt - from,
    line,
    vehicle: vehicle ? { ...pointOf(project(vehicle)), bearing: vehicle.bearing, at: vehicle.at } : null,
    stopsAway: coming ? targetAt - vehicleAt : null,
    passed,
    routes: tables.routes,
    stops: tables.stops,
  };
}

const pointOf = ([x, y]: [number, number]) => ({ x, y });

function nearest(points: (Point | StopRow)[], to: Point) {
  let best = 0;
  for (let index = 1; index < points.length; index++) {
    if (distanceMeters(points[index]!, to) < distanceMeters(points[best]!, to)) best = index;
  }
  return best;
}
