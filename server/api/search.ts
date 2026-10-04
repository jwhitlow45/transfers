import type { RouteSearchResult, SearchResponse, StopSearchResult } from '../../shared/api.ts';
import { destinationOf } from '../engine/links.ts';
import { routeView, stopView } from '../engine/views.ts';
import { distanceMeters, type Point } from '../geo.ts';
import { searchQuery, searchText } from '../gtfs/search-text.ts';
import { type RouteRow, type Schedule, type StopRow, routeKeyOf } from '../schedule.ts';
import { all } from '../db.ts';

const LIMIT = 12;

// The stops riders search for: BART stations rather than their platforms, and boarding stops
// everywhere else (see buildSearchIndex).
const isSearchable = (stop: StopRow) =>
  (stop.kind === 'station' && stop.access === 'bart') || stop.kind === 'stop' || (stop.kind === 'platform' && stop.access !== 'bart');

export function search(schedule: Schedule, text: string, options: { routes: boolean; near?: Point }): SearchResponse {
  const query = text.trim();
  const response: SearchResponse = { results: [], routes: {} };
  if (!query) return response;

  let stops: StopRow[];
  if (/^\d+$/.test(query)) {
    // A stop code, matched from its start: "134" lists 13400 through 13499.
    stops = [...schedule.stops.values()]
      .filter((stop) => isSearchable(stop) && stop.agency !== 'BA' && stop.code?.startsWith(query) && schedule.stopRoutes.has(stop.id))
      .sort((a, b) => (a.code?.length ?? 0) - (b.code?.length ?? 0) || (a.code ?? '').localeCompare(b.code ?? ''));
  } else {
    // One or two letters ("N") match stop names only, or every stop a route by that letter
    // serves would match through its route list.
    const match = searchQuery(query, query.trim().length <= 2 ? ['name', 'code'] : undefined);
    const ids = match
      ? all<{ id: number }>(schedule.db, 'SELECT rowid AS id FROM stop_search WHERE stop_search MATCH ? ORDER BY rank LIMIT 60', match)
      : [];
    // A shared station's Muni Metro platforms answer to the station by name, and to their own
    // codes only when searched by number.
    const found = ids
      .map(({ id }) => schedule.stops.get(id))
      .filter((stop): stop is StopRow => stop !== undefined && !(stop.agency === 'SF' && schedule.sharedStation.has(stop.id)));
    // Names that start with what was typed come first, and stations before street stops, so
    // "montgomery" finds the BART and Muni Metro stations before every stop on Montgomery St.
    // Muni names its underground stations "Metro Castro Station/Downtown", so "castro" should
    // find them as if the name began with it.
    const typed = searchText(query);
    const starts = (stop: StopRow) => searchText(stop.name).replace(/^metro /, '').startsWith(typed);
    const rank = (stop: StopRow) => (starts(stop) ? 0 : 2) + (stop.access === 'street' ? 1 : 0);
    stops = found.map((stop, index) => ({ stop, index, rank: rank(stop) })).sort((a, b) => a.rank - b.rank || a.index - b.index).map(({ stop }) => stop);
  }
  if (options.near) {
    const near = options.near;
    stops.sort((a, b) => distanceMeters(near, a) - distanceMeters(near, b));
  }

  const routeMatches = options.routes ? routeResults(schedule, query) : { exact: [], byLongName: [] };
  const stopResults: StopSearchResult[] = [];
  for (const stop of stops.slice(0, LIMIT)) {
    const members = schedule.sharedMembers.get(stop.id) ?? [];
    const served = [stop, ...members].flatMap(({ id }) => schedule.stopRoutes.get(id) ?? []);
    // BART runs each line as two routes, one per direction, and riders know one Yellow line.
    const byName = new Map<string, RouteRow>();
    for (const { route: id } of served) {
      const route = schedule.route(id);
      const name = routeView(route).name;
      if (!byName.has(name)) byName.set(name, route);
    }
    const routes = [...byName.values()];
    for (const route of routes) response.routes[routeKeyOf(route)] ??= routeView(route);
    stopResults.push({
      type: 'stop',
      ...stopView(schedule, stop),
      routes: sortRoutes(routes).map(routeKeyOf),
      // BART's lines head everywhere, so its stations list lines, not headsigns.
      toward: stop.access === 'bart' ? [] : [...new Set(served.map(({ headsign }) => headsign))].slice(0, 3),
    });
  }
  // A route named exactly ("22") is almost surely what was meant. Place names also appear in
  // long route names ("Daly City BART - Terra Nova HS"), so those routes come after the best
  // few stops, where "fillmore" still finds the 22 near the top.
  const room = LIMIT - routeMatches.exact.length - routeMatches.byLongName.length;
  const results = [...routeMatches.exact, ...stopResults.slice(0, 3), ...routeMatches.byLongName, ...stopResults.slice(3, Math.max(3, room))];
  for (const result of results) {
    if (result.type === 'route') response.routes[result.route] ??= routeView(schedule.routesByKey.get(result.route)!);
  }
  response.results = results;
  return response;
}

// Routes whose name matches exactly ("22", "N", "Yellow"), and routes whose long name contains
// every word typed ("fillmore").
function routeResults(schedule: Schedule, query: string) {
  const lower = query.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  const exact: RouteRow[] = [];
  const byLongName: RouteRow[] = [];
  // BART runs each line as two routes, one per direction. One result stands for both.
  const seen = new Set<string>();
  for (const route of schedule.routes.values()) {
    const name = routeView(route).name;
    if (route.agency === 'BA' && seen.has(name)) continue;
    if (name.toLowerCase() === lower) exact.push(route);
    // BART's long names list stations ("Millbrae/SF Int'l SFO to Antioch"), so a station search
    // would turn up lines, not the station.
    else if (route.agency !== 'BA' && lower.length >= 3 && words.every((word) => route.longName.toLowerCase().includes(word))) byLongName.push(route);
    else continue;
    if (route.agency === 'BA') seen.add(name);
  }
  return { exact: routeSummaries(schedule, sortRoutes(exact).slice(0, 4)), byLongName: routeSummaries(schedule, sortRoutes(byLongName).slice(0, 3)) };
}

function routeSummaries(schedule: Schedule, routes: RouteRow[]): RouteSearchResult[] {
  return routes.map((route) => {
      // A BART line's two routes are its two directions.
      const members = route.agency === 'BA' ? [...schedule.routes.values()].filter((other) => other.agency === 'BA' && routeView(other).name === routeView(route).name) : [route];
      const directions = new Map<number, { id: number; name: string | null; headsign: string; trips: number }>();
      for (const member of members) {
        for (const pattern of schedule.patternsByRoute.get(member.id) ?? []) {
          const id = pattern.direction ?? 0;
          const current = directions.get(id);
          if (!current || pattern.trips > current.trips) {
            directions.set(id, { id, name: schedule.directionName(member.id, pattern.direction), headsign: destinationOf(schedule, pattern), trips: pattern.trips });
          }
        }
      }
      return {
        type: 'route' as const,
        route: routeKeyOf(route),
        directions: [...directions.values()].sort((a, b) => a.id - b.id).map(({ id, name, headsign }) => ({ id, name, headsign })),
      };
  });
}

function sortRoutes<T extends { agency: string; shortName: string }>(routes: T[]) {
  const agencyOrder = ['SF', 'BA', 'SM', 'GG', 'GF'];
  return [...routes].sort(
    (a, b) => agencyOrder.indexOf(a.agency) - agencyOrder.indexOf(b.agency) || a.shortName.localeCompare(b.shortName, 'en', { numeric: true }),
  );
}
