import type { NearbyResponse, NearbyStop, Schematic } from '../../shared/api.ts';
import type { Link } from '../engine/links.ts';
import type { RealtimeView } from '../engine/trip.ts';
import { secondLegs } from '../engine/vehicles.ts';
import { Tables } from '../engine/views.ts';
import { decodePolyline, distanceMeters, type Point } from '../geo.ts';
import { get } from '../db.ts';
import type { Schedule, StopRow } from '../schedule.ts';

export const DEFAULT_NEARBY_METERS = 400;
const MAX_GROUPS = 16;
const ARRIVALS_PER_STOP = 3;

// Stops near the rider, one per route and direction (the nearest), each with its next arrivals,
// plus a schematic of the stops and route lines around them.
export function nearby(schedule: Schedule, realtime: RealtimeView, center: Point, radius: number, now: number): NearbyResponse {
  const tables = new Tables(schedule);
  type Candidate = { stop: StopRow; meters: number; route: number; direction: number | null; headsign: string; trips: number };
  const nearest = new Map<string, Candidate>();
  for (const stop of schedule.stops.values()) {
    // Vehicles stop at platforms and street stops, never at a station's own point.
    if (stop.kind !== 'stop' && stop.kind !== 'platform') continue;
    const meters = distanceMeters(center, stop.parent !== null && stop.access === 'bart' ? schedule.stop(stop.parent) : stop);
    if (meters > radius) continue;
    for (const served of schedule.stopRoutes.get(stop.id) ?? []) {
      const direction = served.direction === -1 ? null : served.direction;
      const key = `${served.route}|${direction}`;
      const current = nearest.get(key);
      if (!current || meters < current.meters || (meters === current.meters && served.trips > current.trips)) {
        nearest.set(key, { stop, meters, route: served.route, direction, headsign: served.headsign, trips: served.trips });
      }
    }
  }

  const context = { schedule, snapshot: realtime.trips, now };
  const groups: NearbyStop[] = [];
  for (const candidate of [...nearest.values()].sort((a, b) => a.meters - b.meters).slice(0, MAX_GROUPS)) {
    const route = schedule.route(candidate.route);
    const link: Link = {
      key: '',
      alight: candidate.stop,
      board: candidate.stop,
      routes: [route],
      direction: candidate.direction,
      headsign: candidate.headsign,
      boardPatterns: (schedule.patternsByStop.get(candidate.stop.id) ?? []).filter(
        ({ pattern, position }) => pattern.route === route.id && (candidate.direction === null || pattern.direction === candidate.direction) && position < pattern.stops.length - 1,
      ),
      firstLegs: [],
      walkMeters: 0,
      defaultMinutes: 0,
      stopsRidden: 0,
    };
    const arrivals = secondLegs(context, link, null)
      .filter(({ at, canceled }) => !canceled && at >= now - 30)
      .sort((a, b) => a.at - b.at)
      .slice(0, ARRIVALS_PER_STOP)
      .map(({ trip, at, delay, live }) => ({ trip, at, delay, live }));
    groups.push({
      stop: tables.stop(candidate.stop.parent !== null && candidate.stop.access === 'bart' ? schedule.stop(candidate.stop.parent) : candidate.stop),
      route: tables.route(route),
      direction: candidate.direction,
      headsign: candidate.headsign,
      meters: Math.round(candidate.meters),
      arrivals,
    });
  }

  return {
    generatedAt: realtime.updatedAt ?? now,
    nearby: groups,
    routes: tables.routes,
    stops: tables.stops,
    schematic: schematic(schedule, center, radius, [...nearest.values()]),
    feeds: [],
  };
}

const shapeCache = new WeakMap<Schedule, Map<number, Point[]>>();

// Positions as whole meters east and north of the rider, lines clipped to a square a bit
// larger than the search radius and thinned to points at least 8 m apart.
function schematic(schedule: Schedule, center: Point, radius: number, candidates: { stop: StopRow; route: number; direction: number | null }[]): Schematic {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = 111_320 * Math.cos((center.lat * Math.PI) / 180);
  const project = (point: Point): [number, number] => [
    Math.round((point.lon - center.lon) * metersPerDegreeLon),
    Math.round((point.lat - center.lat) * metersPerDegreeLat),
  ];
  const half = radius * 1.25;
  const inside = ([x, y]: [number, number]) => Math.abs(x) <= half && Math.abs(y) <= half;

  const stops = new Map<number, { stop: string; x: number; y: number }>();
  const tables = new Tables(schedule);
  for (const { stop } of candidates) {
    const shown = stop.parent !== null && stop.access === 'bart' ? schedule.stop(stop.parent) : stop;
    const [x, y] = project(shown);
    stops.set(shown.id, { stop: tables.stop(shown), x, y });
  }

  let cache = shapeCache.get(schedule);
  if (!cache) shapeCache.set(schedule, (cache = new Map()));
  const lines: Schematic['lines'] = [];
  const drawn = new Set<string>();
  for (const { route, direction } of candidates) {
    // The busiest pattern of each route and direction stands for its line.
    const pattern = (schedule.patternsByRoute.get(route) ?? [])
      .filter((candidate) => candidate.direction === direction && candidate.shape !== null)
      .sort((a, b) => b.trips - a.trips)[0];
    if (!pattern?.shape || drawn.has(`${route}|${pattern.shape}`)) continue;
    drawn.add(`${route}|${pattern.shape}`);
    let points = cache.get(pattern.shape);
    if (!points) {
      const row = get<{ polyline: string }>(schedule.db, 'SELECT polyline FROM shapes WHERE id = ?', pattern.shape);
      points = row ? decodePolyline(row.polyline) : [];
      cache.set(pattern.shape, points);
    }
    let segment: [number, number][] = [];
    const routeKey = tables.route(schedule.route(route));
    for (const point of points.map(project)) {
      if (inside(point)) {
        const last = segment.at(-1);
        if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) >= 8) segment.push(point);
      } else if (segment.length > 0) {
        segment.push(point);
        if (segment.length > 1) lines.push({ route: routeKey, points: segment });
        segment = [];
      }
    }
    if (segment.length > 1) lines.push({ route: routeKey, points: segment });
  }
  return { stops: [...stops.values()], lines };
}
