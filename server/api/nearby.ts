import type { NearbyResponse, NearbyStop, Schematic } from '../../shared/api.ts';
import type { Link } from '../engine/links.ts';
import { projector, shapePoints } from '../engine/shapes.ts';
import type { RealtimeView } from '../engine/trip.ts';
import { secondLegs } from '../engine/vehicles.ts';
import { Tables } from '../engine/views.ts';
import { distanceMeters, type Point } from '../geo.ts';
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
  // BART riders pick a platform, not a line, so lines through the same platform share a row.
  const bartLines = new Map<number, Candidate[]>();
  for (const stop of schedule.stops.values()) {
    // Vehicles stop at platforms and street stops, never at a station's own point.
    if (stop.kind !== 'stop' && stop.kind !== 'platform') continue;
    const meters = distanceMeters(center, stop.parent !== null && stop.access === 'bart' ? schedule.stop(stop.parent) : stop);
    if (meters > radius) continue;
    for (const served of schedule.stopRoutes.get(stop.id) ?? []) {
      const direction = served.direction === -1 ? null : served.direction;
      if (stop.access === 'bart') {
        const lines = bartLines.get(stop.id) ?? [];
        bartLines.set(stop.id, [...lines, { stop, meters, route: served.route, direction, headsign: served.headsign, trips: served.trips }]);
        continue;
      }
      const key = `${served.route}|${direction}`;
      const current = nearest.get(key);
      if (!current || meters < current.meters || (meters === current.meters && served.trips > current.trips)) {
        nearest.set(key, { stop, meters, route: served.route, direction, headsign: served.headsign, trips: served.trips });
      }
    }
  }

  type Row = Candidate & { routes: number[] };
  const rows: Row[] = [...nearest.values()].map((candidate) => ({ ...candidate, routes: [candidate.route] }));
  for (const lines of bartLines.values()) {
    const busiest = [...lines].sort((a, b) => b.trips - a.trips);
    const headsigns = [...new Set(busiest.map(({ headsign }) => headsign))];
    rows.push({ ...busiest[0]!, routes: [...new Set(busiest.map(({ route }) => route))], headsign: headsigns.slice(0, 3).join(' / ') });
  }

  const context = { schedule, snapshot: realtime.trips, now };
  const groups: NearbyStop[] = [];
  for (const candidate of rows.sort((a, b) => a.meters - b.meters)) {
    if (groups.length === MAX_GROUPS) break;
    const routes = candidate.routes.map((id) => schedule.route(id));
    const routeIds = new Set(candidate.routes);
    const link: Link = {
      key: '',
      kind: 'walk',
      alight: candidate.stop,
      alights: [candidate.stop],
      board: candidate.stop,
      boards: [candidate.stop],
      routes,
      direction: candidate.direction,
      headsign: candidate.headsign,
      boardPatterns: (schedule.patternsByStop.get(candidate.stop.id) ?? []).filter(
        ({ pattern, position }) => routeIds.has(pattern.route) && (candidate.direction === null || pattern.direction === candidate.direction) && position < pattern.stops.length - 1,
      ).map((entry) => ({ ...entry, stop: candidate.stop })),
      firstLegs: [],
      walkMeters: 0,
      longestWalkMeters: 0,
      defaultMinutes: 0,
      stopsRidden: 0,
    };
    const arrivals = secondLegs(context, link, null)
      .filter(({ at, canceled }) => !canceled && at >= now - 30)
      .sort((a, b) => a.at - b.at)
      .slice(0, ARRIVALS_PER_STOP)
      .map(({ trip, route, at, delay, live }) => ({ trip, route: tables.route(schedule.routesByKey.get(route)!), at, delay, live }));
    // A route not running for hours, such as an owl route by day, makes room for one that is.
    if (arrivals.length === 0) continue;
    groups.push({
      stop: tables.stop(candidate.stop.parent !== null && candidate.stop.access === 'bart' ? schedule.stop(candidate.stop.parent) : candidate.stop),
      routes: routes.map((route) => tables.route(route)),
      direction: candidate.direction,
      headsign: candidate.headsign,
      meters: Math.round(candidate.meters),
      arrivals,
    });
  }

  return {
    generatedAt: now,
    dataAt: realtime.updatedAt,
    nearby: groups,
    routes: tables.routes,
    stops: tables.stops,
    schematic: schematic(schedule, center, radius, [...nearest.values(), ...[...bartLines.values()].flat()]),
    feeds: [],
  };
}

// Positions as whole meters east and north of the rider, lines clipped to a square a bit
// larger than the search radius and thinned to points at least 8 m apart.
function schematic(schedule: Schedule, center: Point, radius: number, candidates: { stop: StopRow; route: number; direction: number | null }[]): Schematic {
  const project = projector(center);
  const half = radius * 1.25;
  const inside = ([x, y]: [number, number]) => Math.abs(x) <= half && Math.abs(y) <= half;

  const stops = new Map<number, { stop: string; x: number; y: number }>();
  const tables = new Tables(schedule);
  for (const { stop } of candidates) {
    const shown = stop.parent !== null && stop.access === 'bart' ? schedule.stop(stop.parent) : stop;
    const [x, y] = project(shown);
    stops.set(shown.id, { stop: tables.stop(shown), x, y });
  }

  const lines: Schematic['lines'] = [];
  const drawn = new Set<string>();
  for (const { route, direction } of candidates) {
    // The busiest pattern of each route and direction stands for its line.
    const pattern = (schedule.patternsByRoute.get(route) ?? [])
      .filter((candidate) => candidate.direction === direction && candidate.shape !== null)
      .sort((a, b) => b.trips - a.trips)[0];
    if (!pattern?.shape || drawn.has(`${route}|${pattern.shape}`)) continue;
    drawn.add(`${route}|${pattern.shape}`);
    const points = shapePoints(schedule, pattern.shape);
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
