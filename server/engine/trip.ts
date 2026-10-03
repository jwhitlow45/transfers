import type { Alert, AlertRelevance, AgencyId, FeedStatus, Group, TripResponse } from '../../shared/api.ts';
import type { Agency } from '../config.ts';
import type { RtAlert, TripSnapshot } from '../realtime/snapshot.ts';
import { type Schedule, type StopRow, routeKeyOf, stopKeyOf } from '../schedule.ts';
import { pairConnections } from './connections.ts';
import { type Link, findLinks } from './links.ts';
import { firstLegs, secondLegs } from './vehicles.ts';
import { Tables } from './views.ts';
import { defaultMaximum } from './walk.ts';

export type TripRequest = {
  from: string;
  // A stop key, or "route:" and a route key.
  to: string;
  min?: number;
  max?: number;
  hide?: number;
  walk?: number;
  speed?: number;
  dest?: string;
  firstRoutes?: string[];
  secondRoutes?: string[];
  hidden?: boolean;
};

export type RealtimeView = {
  trips: TripSnapshot | null;
  alerts: RtAlert[];
  status: (agency: Agency) => FeedStatus['state'];
  updatedAt: number | null;
};

export class RequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const DEPARTURES_PER_GROUP = 3;

// Transfer points depend only on the schedule and walking settings, so they are worked out once
// per schedule build and reused by every refresh.
const linkCache = new WeakMap<Schedule, Map<string, Link[]>>();

function cachedLinks(schedule: Schedule, from: StopRow, to: { stop: StopRow } | { route: import('../schedule.ts').RouteRow }, walk?: number, speed?: number) {
  let cache = linkCache.get(schedule);
  if (!cache) linkCache.set(schedule, (cache = new Map()));
  const key = `${from.id}|${'stop' in to ? `s${to.stop.id}` : `r${to.route.id}`}|${walk ?? ''}|${speed ?? ''}`;
  let links = cache.get(key);
  if (!links) {
    links = findLinks(schedule, from, to, { ...(walk ? { maxWalkMeters: walk } : {}), ...(speed ? { walkSpeed: speed } : {}) });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    cache.set(key, links);
  }
  return links;
}

export function planTrip(schedule: Schedule, realtime: RealtimeView, request: TripRequest, now: number): TripResponse {
  const from = schedule.stopsByKey.get(request.from);
  if (!from) throw new RequestError(404, `No stop ${request.from}`);
  const toRoute = request.to.startsWith('route:') ? schedule.routesByKey.get(request.to.slice('route:'.length)) : undefined;
  const toStop = toRoute ? undefined : schedule.stopsByKey.get(request.to);
  if (!toRoute && !toStop) throw new RequestError(404, `No stop or route ${request.to}`);
  const destination = request.dest ? schedule.stopsByKey.get(request.dest) ?? null : null;

  const tables = new Tables(schedule);
  const links = cachedLinks(schedule, from, toStop ? { stop: toStop } : { route: toRoute! }, request.walk, request.speed);
  const firstFilter = request.firstRoutes?.length ? new Set(request.firstRoutes) : null;
  const secondFilter = request.secondRoutes?.length ? new Set(request.secondRoutes) : null;
  const context = { schedule, snapshot: realtime.trips, now };

  const groups: Group[] = [];
  const tripStops = new Set<string>([...schedule.boardingStops(from), from].map(stopKeyOf));
  const tripRoutes = new Set<string>();
  const agencies = new Set<AgencyId>([from.agency]);
  for (const link of links) {
    const routes = link.routes.filter((route) => !secondFilter || secondFilter.has(routeKeyOf(route)));
    if (routes.length === 0) continue;
    const linkForRoutes = routes.length === link.routes.length ? link : { ...link, routes };
    const min = request.min ?? link.defaultMinutes;
    const headway = request.max === undefined ? schedule.headwayMinutes(link.boardPatterns, now) : null;
    const max = Math.max(min, request.max ?? defaultMaximum(min, headway));
    const departures = pairConnections(firstLegs(context, linkForRoutes, firstFilter), secondLegs(context, linkForRoutes, destination), {
      now,
      min,
      max,
      hide: request.hide ?? 0,
      count: DEPARTURES_PER_GROUP,
      showHidden: request.hidden ?? false,
    });
    for (const departure of departures) {
      tables.route(departure.route);
      for (const connection of departure.connections) tables.route(connection.route);
    }
    groups.push({
      alight: tables.stop(link.alight),
      board: tables.stop(link.board),
      routes: routes.map((route) => tables.route(route)),
      direction: link.direction,
      headsign: link.headsign,
      walkMeters: link.walkMeters,
      window: { min, max },
      departures,
    });
    tripStops.add(stopKeyOf(link.alight)).add(stopKeyOf(link.board));
    for (const route of routes) tripRoutes.add(routeKeyOf(route));
    for (const { pattern } of link.firstLegs) tripRoutes.add(routeKeyOf(schedule.route(pattern.route)));
    agencies.add(link.alight.agency).add(link.board.agency);
  }
  tables.stop(from);
  if (toStop) tables.stop(toStop);
  if (toRoute) tables.route(toRoute);
  if (destination) {
    tables.stop(destination);
    tripStops.add(stopKeyOf(destination));
  }

  return {
    generatedAt: now,
    from: stopKeyOf(from),
    to: toStop ? { stop: stopKeyOf(toStop) } : { route: routeKeyOf(toRoute!) },
    groups,
    routes: tables.routes,
    stops: tables.stops,
    alerts: relevantAlerts(realtime.alerts, tripStops, tripRoutes, agencies),
    feeds: [...agencies].map((agency) => ({ agency, state: realtime.status(agency), updatedAt: realtime.updatedAt })),
  };
}

// Alerts that name a stop on the trip (for a route on the trip, or for every route there),
// that cover a trip route as a whole, or that cover a whole agency the trip uses. An alert
// about the same route at a stop the rider never uses is left out.
export function relevantAlerts(alerts: RtAlert[], stops: Set<string>, routes: Set<string>, agencies: Set<AgencyId>): Alert[] {
  const order: Record<AlertRelevance, number> = { stop: 0, route: 1, agency: 2 };
  const results: Alert[] = [];
  for (const alert of alerts) {
    const pairedStops = new Set(alert.routeStops.map((pair) => pair.split('|')[1]));
    const routesWithStops = new Set(alert.routeStops.map((pair) => pair.split('|')[0]));
    const namesTripStop =
      alert.routeStops.some((pair) => {
        const [route, stop] = pair.split('|');
        return stops.has(stop!) && routes.has(route!);
      }) || alert.stops.some((stop) => stops.has(stop) && !pairedStops.has(stop));
    const coversTripRoute = alert.routes.some((route) => routes.has(route) && !routesWithStops.has(route));
    const coversAgency = alert.agencyWide && alert.agencies.some((agency) => agencies.has(agency));
    const relevance: AlertRelevance | null = namesTripStop ? 'stop' : coversTripRoute ? 'route' : coversAgency ? 'agency' : null;
    if (!relevance) continue;
    results.push({
      id: alert.id,
      relevance,
      agency: alert.agencies[0]!,
      header: alert.header,
      description: alert.description,
      url: alert.url,
      effect: alert.effect,
      activeUntil: alert.activeUntil,
      routes: alert.routes.filter((route) => routes.has(route)),
      stops: alert.stops.filter((stop) => stops.has(stop)),
    });
  }
  return results.sort((a, b) => order[a.relevance] - order[b.relevance]);
}
