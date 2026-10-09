import type { RouteSearchResult, RouteStops, SearchResponse, StopSearchResult } from '../../shared/api.ts';
import { bartSiblings, headingOf, rankedHeadings } from '../engine/links.ts';
import { Tables, routeView, stopView } from '../engine/views.ts';
import { distanceMeters, type Point } from '../geo.ts';
import { searchQuery, searchText } from '../gtfs/search-text.ts';
import { type PatternRow, type RouteRow, type Schedule, type StopRow, routeKeyOf } from '../schedule.ts';
import { all } from '../db.ts';

const LIMIT = 12;

// The stops riders search for: BART stations rather than their platforms, and boarding stops
// everywhere else (see buildSearchIndex).
const isSearchable = (stop: StopRow) =>
  (stop.kind === 'station' && stop.access === 'bart') || stop.kind === 'stop' || (stop.kind === 'platform' && stop.access !== 'bart');

export function search(schedule: Schedule, text: string, options: { routes: boolean; near?: Point }): SearchResponse {
  const query = text.trim();
  const tables = new Tables(schedule);
  const response: SearchResponse = { results: [], routes: tables.routes };
  if (!query) return response;

  let stops: StopRow[];
  // "stop 13477" and "#13477" are stop codes too.
  const code = query.replace(/^(stop\s*#?|#)\s*/i, '');
  if (/^\d+$/.test(code)) {
    // A stop code, matched from its start: "134" lists 13400 through 13499.
    stops = [...schedule.stops.values()]
      .filter((stop) => isSearchable(stop) && stop.agency !== 'BA' && stop.code?.startsWith(code) && schedule.stopRoutes.has(stop.id))
      .sort((a, b) => (a.code?.length ?? 0) - (b.code?.length ?? 0) || (a.code ?? '').localeCompare(b.code ?? ''));
  } else {
    // One or two letters ("N") match stop names and codes only, or every stop a route by that
    // letter serves would match through its route list.
    const match = searchQuery(query, query.trim().length <= 2 ? ['name', 'code'] : undefined);
    // Stations and subway and ferry stops are looked up on their own, ahead of the rest, so the
    // ranking below sees them. By text rank alone, "mont" puts Montgomery Station 73rd of 74
    // matches, behind every street stop on Montgomery St and Monterey Blvd. The limit leaves room
    // for the shared stations' Muni Metro platforms, which are dropped below.
    const ids = match
      ? [
          ...all<{ id: number }>(schedule.db, "SELECT rowid AS id FROM stop_search WHERE stop_search MATCH ? AND rowid IN (SELECT id FROM stops WHERE access <> 'street') ORDER BY rank LIMIT 40", match),
          ...all<{ id: number }>(schedule.db, 'SELECT rowid AS id FROM stop_search WHERE stop_search MATCH ? ORDER BY rank LIMIT 60', match),
        ].filter(({ id }, index, list) => list.findIndex((other) => other.id === id) === index)
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
    // Nearest first among stops of one name, such as a street's two sides, so where the rider is
    // picks the side without burying a better match for what they typed.
    const near = options.near;
    const firstOf = new Map<string, number>();
    stops.forEach((stop, index) => {
      if (!firstOf.has(searchText(stop.name))) firstOf.set(searchText(stop.name), index);
    });
    const place = (stop: StopRow) => firstOf.get(searchText(stop.name))!;
    stops.sort((a, b) => place(a) - place(b) || distanceMeters(near, a) - distanceMeters(near, b));
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
    for (const route of routes) tables.route(route);
    const leaving = (schedule.patternsByStop.get(stop.id) ?? []).filter(({ pattern, position }) => position < pattern.stops.length - 1).map(({ pattern }) => pattern);
    stopResults.push({
      type: 'stop',
      ...stopView(schedule, stop),
      routes: sortRoutes(routes).map(routeKeyOf),
      // BART's lines head everywhere, so its stations list lines, not headsigns.
      toward: stop.access === 'bart' ? [] : rankedHeadings(schedule, leaving).slice(0, 3),
    });
  }
  // A route named exactly ("22") is almost surely what was meant. Place names also appear in
  // long route names ("Daly City BART - Terra Nova HS"), so those routes come after the best
  // few stops, where "fillmore" still finds the 22 near the top.
  const room = LIMIT - routeMatches.exact.length - routeMatches.byLongName.length;
  const results = [...routeMatches.exact, ...stopResults.slice(0, 3), ...routeMatches.byLongName, ...stopResults.slice(3, Math.max(3, room))];
  for (const result of results) {
    if (result.type === 'route') tables.route(result.route);
  }
  response.results = results;
  // From has to be a stop, so naming a route there lists the stops it makes.
  if (!options.routes) {
    const along = namedRoutes(schedule, query).map((route) => routeStops(schedule, route));
    if (along.length > 0) response.along = along;
    for (const { route } of along) tables.route(route);
  }
  return response;
}

// Routes named exactly what was typed ("22", "N", "Yellow"). BART runs each line as two routes,
// one per direction, and one stands for both.
function namedRoutes(schedule: Schedule, query: string) {
  const lower = query.toLowerCase();
  const seen = new Set<string>();
  const named: RouteRow[] = [];
  for (const route of schedule.routes.values()) {
    const name = routeView(route).name;
    if (name.toLowerCase() !== lower || (route.agency === 'BA' && seen.has(name))) continue;
    named.push(route);
    if (route.agency === 'BA') seen.add(name);
  }
  return sortRoutes(named).slice(0, 4);
}

const bartLine = (schedule: Schedule, route: RouteRow) => (route.agency === 'BA' ? bartSiblings(schedule, route) : [route]);

// The stops a route makes, in riding order, for each direction. Every pattern adds its stops
// to the order of the busiest one, so short runs, branches and late-night variants all show.
// A rider boards at a BART station, not a platform, so a line lists its stations once.
function routeStops(schedule: Schedule, route: RouteRow): RouteStops {
  const byDirection = new Map<number, PatternRow[]>();
  for (const member of bartLine(schedule, route)) {
    for (const pattern of schedule.patternsByRoute.get(member.id) ?? []) {
      const id = pattern.direction ?? 0;
      byDirection.set(id, [...(byDirection.get(id) ?? []), pattern]);
    }
  }
  const directions = [...byDirection]
    .sort(([a], [b]) => a - b)
    .map(([id, patterns]) => {
      const busiest = [...patterns].sort((a, b) => b.trips - a.trips);
      const top = busiest[0]!;
      const headsign = headingOf(schedule, top);
      const stations = new Set(mergeOrder(busiest.map(({ stops }) => stops)).map((stop) => schedule.stationOf(schedule.stop(stop))));
      const stops = [...stations].filter(isSearchable).map(
        (stop): StopSearchResult => ({ type: 'stop', ...stopView(schedule, stop), routes: [], toward: route.agency === 'BA' ? [] : [headsign] }),
      );
      return { id, name: schedule.directionName(top.route, top.direction), headsign, stops };
    });
  return { route: routeKeyOf(route), directions: route.agency === 'BA' ? directions.slice(0, 1) : directions };
}

// Merges stop sequences into one order: each stop not yet placed goes right after the stop
// before it in its own sequence. Stops before a sequence's first known stop, such as where a
// short run starts, go just before that stop. A stop seen again, as on a loop, keeps its first
// place.
export function mergeOrder(sequences: number[][]) {
  const order: number[] = [];
  for (const sequence of sequences) {
    let at = -1;
    let leading: number[] = [];
    for (const stop of sequence) {
      const found = order.indexOf(stop);
      if (found === -1 && at === -1) leading.push(stop);
      else if (found === -1) order.splice(++at, 0, stop);
      else if (at === -1) {
        order.splice(found, 0, ...leading);
        at = found + leading.length;
        leading = [];
      } else if (found > at) at = found;
    }
    order.push(...leading);
  }
  return order;
}

// Routes whose name matches exactly ("22", "N", "Yellow"), and routes whose long name contains
// every word typed ("fillmore").
function routeResults(schedule: Schedule, query: string) {
  const lower = query.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  // BART's long names list stations ("Millbrae/SF Int'l SFO to Antioch"), so a station search
  // would turn up lines, not the station.
  const byLongName = [...schedule.routes.values()].filter(
    (route) => route.agency !== 'BA' && lower.length >= 3 && routeView(route).name.toLowerCase() !== lower && words.every((word) => route.longName.toLowerCase().includes(word)),
  );
  return { exact: routeSummaries(schedule, namedRoutes(schedule, query)), byLongName: routeSummaries(schedule, sortRoutes(byLongName).slice(0, 3)) };
}

function routeSummaries(schedule: Schedule, routes: RouteRow[]): RouteSearchResult[] {
  return routes.map((route) => {
      // A BART line's two routes are its two directions.
      const members = bartLine(schedule, route);
      const directions = new Map<number, { id: number; name: string | null; headsign: string; trips: number }>();
      for (const member of members) {
        for (const pattern of schedule.patternsByRoute.get(member.id) ?? []) {
          const id = pattern.direction ?? 0;
          const current = directions.get(id);
          if (!current || pattern.trips > current.trips) {
            directions.set(id, { id, name: schedule.directionName(member.id, pattern.direction), headsign: headingOf(schedule, pattern), trips: pattern.trips });
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
