import type { AgencyId, Mode, Route, Stop } from '../../shared/api.ts';
import { bartStationCode } from '../bart-stations.ts';
import { compassLabel } from '../geo.ts';
import { type RouteRow, type Schedule, type StopRow, routeKeyOf, stopKeyOf } from '../schedule.ts';

// The route as riders know it: BART's feed calls its lines "Yellow-N" and "Yellow-S", and
// riders call both the Yellow line.
export function routeView(route: RouteRow): Route {
  return {
    key: routeKeyOf(route),
    agency: route.agency,
    name: routeName(route),
    longName: route.longName,
    mode: route.mode,
    color: route.color,
  };
}

// Muni's owl and bus-substitute routes are "NOWL" and "NBUS" in its feed, and the California
// cable car is "CA", which reads as the state. Riders say "N Owl", "N Bus", and "C".
function routeName(route: RouteRow) {
  if (route.agency === 'BA') return route.shortName.replace(/-[NS]$/, '');
  if (route.agency !== 'SF') return route.shortName;
  if (route.shortName === 'CA') return 'C';
  return route.shortName.replace(/^(\w+?)(OWL|BUS)$/, (_, line: string, kind: string) => `${line} ${kind === 'OWL' ? 'Owl' : 'Bus'}`);
}

export function stopView(schedule: Schedule, stop: StopRow): Stop {
  return {
    key: stopKeyOf(stop),
    agency: stop.agency,
    // BART's codes are 511's internal ids, printed nowhere. Golden Gate's stations use
    // abbreviations, also not on any sign.
    code: stop.agency === 'BA' || !/^\d+$/.test(stop.code ?? '') ? null : stop.code,
    name: stop.name.replace(/`/g, '’'),
    direction: stop.kind === 'station' || stop.bearing === null ? null : compassLabel(stop.bearing),
    mode: stopMode(schedule, stop),
    ...(schedule.sharedMembers.has(stop.id) ? { serves: ['BA', 'SF'] as const satisfies AgencyId[] } : {}),
    ...bartCode(stop),
  };
}

// BART's own code for a station, which its web pages use, so the page can link to it.
function bartCode(stop: StopRow) {
  if (stop.agency !== 'BA') return {};
  const code = bartStationCode(stop);
  return code ? { bart: code } : {};
}

function stopMode(schedule: Schedule, stop: StopRow): Mode {
  if (stop.access === 'bart') return 'bart';
  const counts = new Map<Mode, number>();
  for (const { route, trips } of schedule.stopRoutes.get(stop.id) ?? []) {
    const mode = schedule.route(route).mode;
    counts.set(mode, (counts.get(mode) ?? 0) + trips);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'bus';
}

// Collects the routes and stops a response refers to, so each appears once.
export class Tables {
  readonly routes: Record<string, Route> = {};
  readonly stops: Record<string, Stop> = {};
  private readonly schedule: Schedule;

  constructor(schedule: Schedule) {
    this.schedule = schedule;
  }

  route(route: RouteRow | string) {
    const row = typeof route === 'string' ? this.schedule.routesByKey.get(route) : route;
    if (!row) return typeof route === 'string' ? route : routeKeyOf(route);
    const key = routeKeyOf(row);
    this.routes[key] ??= routeView(row);
    return key;
  }

  stop(stop: StopRow) {
    const key = stopKeyOf(stop);
    this.stops[key] ??= stopView(this.schedule, stop);
    return key;
  }
}
