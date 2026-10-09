import type { NearbyArrival, NearbyResponse, NearbyStop, Schematic } from '../../shared/api.ts';
import { type Link, rankedHeading } from '../engine/links.ts';
import { projector, shapePoints } from '../engine/shapes.ts';
import type { RealtimeView } from '../engine/realtime-view.ts';
import { secondLegs } from '../engine/vehicles.ts';
import { Tables } from '../engine/views.ts';
import { distanceMeters, type Point } from '../geo.ts';
import { routeKeyOf, type Schedule, type StopRow, stopKeyOf } from '../schedule.ts';

export const DEFAULT_NEARBY_METERS = 400;
const MAX_GROUPS = 16;
const ARRIVALS_PER_STOP = 3;

// Stops near the rider, one per route and direction, each with its next arrivals, plus a
// schematic of the stops and route lines around them. Each route shows at its nearest stop with
// something coming within the arrivals' horizon, so one whose nearest stop is idle, such as a
// stop only a night variant serves, shows at the next. A route with nothing coming at any stop in
// range is left out, making room for one farther off.
type Candidate = { stop: StopRow; meters: number; route: number; direction: number | null; trips: number };
export type BoardingRow = Candidate & { key: string; routes: number[]; headsign: string };

// Each route and direction boarding at `stops`, a row each, with how far each stop is and where
// it heads, as results name it. BART riders pick a platform, not a line, so lines through the same
// platform share a row, and `bartLines` keeps each platform's own.
export function boardingRows(schedule: Schedule, stops: Iterable<StopRow>, metersTo: (stop: StopRow) => number) {
  const rows: BoardingRow[] = [];
  const bartLines = new Map<number, Candidate[]>();
  const leaving = (stop: number) => (schedule.patternsByStop.get(stop) ?? []).filter(({ pattern, position }) => position < pattern.stops.length - 1).map(({ pattern }) => pattern);
  for (const stop of stops) {
    // Vehicles stop at platforms and street stops, never at a station's own point.
    if (stop.kind !== 'stop' && stop.kind !== 'platform') continue;
    const meters = metersTo(stop);
    if (!Number.isFinite(meters)) continue;
    for (const served of schedule.stopRoutes.get(stop.id) ?? []) {
      const direction = served.direction === -1 ? null : served.direction;
      const line = { stop, meters, route: served.route, direction, trips: served.trips };
      if (stop.access === 'bart') {
        bartLines.set(stop.id, [...(bartLines.get(stop.id) ?? []), line]);
        continue;
      }
      const patterns = leaving(stop.id).filter((pattern) => pattern.route === served.route && pattern.direction === direction);
      rows.push({ ...line, key: `${served.route}|${direction}`, routes: [served.route], headsign: rankedHeading(schedule, patterns, [schedule.route(served.route)]) });
    }
  }
  for (const [platform, lines] of bartLines) {
    const busiest = [...lines].sort((a, b) => b.trips - a.trips);
    const routes = [...new Set(busiest.map(({ route }) => route))];
    // Where every line through the platform goes: "Antioch, Dublin/Pleasanton, Richmond".
    rows.push({ ...busiest[0]!, key: `bart|${platform}`, routes, headsign: rankedHeading(schedule, leaving(platform), routes.map((id) => schedule.route(id))) });
  }
  return { rows, bartLines };
}

// The next `count` arrivals of a row's routes at its stop, soonest first, leaving out canceled
// trips and those already gone.
export function arrivalsFor(context: { schedule: Schedule; snapshot: RealtimeView['trips']; now: number }, tables: Tables, row: BoardingRow, count: number): NearbyArrival[] {
  const { schedule, now } = context;
  const routeIds = new Set(row.routes);
  const link: Link = {
    key: '',
    kind: 'walk',
    alight: row.stop,
    alights: [row.stop],
    board: row.stop,
    boards: [row.stop],
    routes: row.routes.map((id) => schedule.route(id)),
    direction: row.direction,
    headsign: row.headsign,
    boardPatterns: (schedule.patternsByStop.get(row.stop.id) ?? [])
      .filter(({ pattern, position }) => routeIds.has(pattern.route) && (row.direction === null || pattern.direction === row.direction) && position < pattern.stops.length - 1)
      .map((entry) => ({ ...entry, stop: row.stop })),
    firstLegs: [],
    walkMeters: 0,
    longestWalkMeters: 0,
    defaultMinutes: 0,
    stopsRidden: 0,
  };
  return secondLegs(context, link, [])
    .filter(({ at, canceled }) => !canceled && at >= now - 30)
    .sort((a, b) => a.at - b.at)
    .slice(0, count)
    .map(({ trip, route, at, delay, live }) => ({ trip, route: tables.route(schedule.routesByKey.get(route)!), at, delay, live }));
}

export function nearby(schedule: Schedule, realtime: RealtimeView, center: Point, radius: number, now: number): NearbyResponse {
  const tables = new Tables(schedule);
  // Every stop in range for each route and direction.
  const { rows, bartLines } = boardingRows(schedule, schedule.stops.values(), (stop) => {
    const meters = distanceMeters(center, stop.parent !== null && stop.access === 'bart' ? schedule.stop(stop.parent) : stop);
    return meters <= radius ? meters : Infinity;
  });
  // Nearest first, and at one distance, the stop more trips serve.
  rows.sort((a, b) => a.meters - b.meters || b.trips - a.trips);
  const nearest = new Map<string, BoardingRow>();
  for (const row of rows) if (!nearest.has(row.key)) nearest.set(row.key, row);

  const context = { schedule, snapshot: realtime.trips, now };
  const groups: NearbyStop[] = [];
  const shown = new Map<string, BoardingRow>();
  for (const candidate of rows) {
    if (groups.length === MAX_GROUPS) break;
    if (shown.has(candidate.key)) continue;
    const routes = candidate.routes.map((id) => schedule.route(id));
    const arrivals = arrivalsFor(context, tables, candidate, ARRIVALS_PER_STOP);
    // Nothing coming here: the route's next nearest stop gets its turn.
    if (arrivals.length === 0) continue;
    shown.set(candidate.key, candidate);
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
    // Each route's nearest stop, and any farther one it shows at instead.
    schematic: schematic(schedule, center, radius, [...[...nearest.values(), ...shown.values()].filter(({ stop }) => stop.access !== 'bart'), ...[...bartLines.values()].flat()]),
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
  for (const { stop } of candidates) {
    const shown = stop.parent !== null && stop.access === 'bart' ? schedule.stop(stop.parent) : stop;
    const [x, y] = project(shown);
    stops.set(shown.id, { stop: stopKeyOf(shown), x, y });
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
    const routeKey = routeKeyOf(schedule.route(route));
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
