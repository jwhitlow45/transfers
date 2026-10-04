import type { Alert, AlertRelevance, AgencyId, Departure, DestinationsResponse, FeedStatus, Group, TripResponse } from '../../shared/api.ts';
import type { Agency } from '../config.ts';
import type { RtAlert, TripSnapshot } from '../realtime/snapshot.ts';
import { type Schedule, type StopRow, routeKeyOf, stopKeyOf } from '../schedule.ts';
import { type FirstLeg, type PairingOptions, type SecondLeg, pairConnections } from './connections.ts';
import { type Link, findLinks } from './links.ts';
import type { RouteRow } from '../schedule.ts';
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
  // At a shared station: ride from or catch BART, Muni Metro, or both when absent.
  fromAgencies?: Agency[];
  toAgencies?: Agency[];
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

function cachedLinks(schedule: Schedule, from: StopRow, to: { stop: StopRow } | { route: RouteRow }, request: TripRequest) {
  let cache = linkCache.get(schedule);
  if (!cache) linkCache.set(schedule, (cache = new Map()));
  const { walk, speed, fromAgencies, toAgencies } = request;
  const key = `${from.id}|${'stop' in to ? `s${to.stop.id}` : `r${to.route.id}`}|${walk ?? ''}|${speed ?? ''}|${fromAgencies?.join() ?? ''}|${toAgencies?.join() ?? ''}`;
  let links = cache.get(key);
  if (!links) {
    links = findLinks(schedule, from, to, {
      ...(walk ? { maxWalkMeters: walk } : {}),
      ...(speed ? { walkSpeed: speed } : {}),
      ...(fromAgencies?.length ? { fromAgencies: new Set(fromAgencies) } : {}),
      ...(toAgencies?.length ? { toAgencies: new Set(toAgencies) } : {}),
    });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    cache.set(key, links);
  }
  return links;
}

function resolveEnds(schedule: Schedule, request: Pick<TripRequest, 'from' | 'to'>) {
  const from = schedule.stopsByKey.get(request.from);
  if (!from) throw new RequestError(404, `No stop ${request.from}`);
  const toRoute = request.to.startsWith('route:') ? schedule.routesByKey.get(request.to.slice('route:'.length)) : undefined;
  const toStop = toRoute ? undefined : schedule.stopsByKey.get(request.to);
  if (!toRoute && !toStop) throw new RequestError(404, `No stop or route ${request.to}`);
  return { from, to: toStop ? { stop: toStop } : { route: toRoute! } };
}

// For each transfer point, the stops its routes reach after boarding, in riding order. Most
// riders ride the busiest pattern, so its stops come first and other branches follow.
export function destinations(schedule: Schedule, request: TripRequest): DestinationsResponse {
  const { from, to } = resolveEnds(schedule, request);
  const tables = new Tables(schedule);
  const groups: DestinationsResponse['groups'] = [];
  for (const link of cachedLinks(schedule, from, to, request)) {
    const stops: string[] = [];
    const seen = new Set<number>();
    for (const { pattern, position } of [...link.boardPatterns].sort((a, b) => b.pattern.trips - a.pattern.trips)) {
      for (const id of pattern.stops.slice(position + 1)) {
        if (seen.has(id)) continue;
        seen.add(id);
        const stop = schedule.stop(id);
        // BART riders get off at a station, not a platform.
        stops.push(tables.stop(stop.parent !== null && stop.access === 'bart' ? schedule.stop(stop.parent) : stop));
      }
    }
    groups.push({ board: tables.stop(link.board), routes: link.routes.map((route) => tables.route(route)), headsign: link.headsign, stops: [...new Set(stops)] });
  }
  return { groups, routes: tables.routes, stops: tables.stops };
}

export function planTrip(schedule: Schedule, realtime: RealtimeView, request: TripRequest, now: number): TripResponse {
  const { from, to } = resolveEnds(schedule, request);
  const toStop = 'stop' in to ? to.stop : undefined;
  const toRoute = 'route' in to ? to.route : undefined;
  const destination = request.dest ? schedule.stopsByKey.get(request.dest) ?? null : null;

  const tables = new Tables(schedule);
  const allLinks = cachedLinks(schedule, from, to, request);
  const links = destination ? towardDestination(schedule, allLinks, destination, toStop ?? null) : allLinks;
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
    const feeders = link.firstLegs
      .filter(({ pattern }) => !firstFilter || firstFilter.has(routeKeyOf(schedule.route(pattern.route))))
      .map(({ pattern, origin }) => ({ pattern, position: origin }));
    const headway = request.max === undefined ? schedule.headwayMinutes(feeders, now) : null;
    const max = Math.max(min, request.max ?? defaultMaximum(min, headway));
    const first = firstLegs(context, linkForRoutes, firstFilter);
    const second = secondLegs(context, linkForRoutes, destination);
    const pairing = { now, min, max, hide: request.hide ?? 0, count: DEPARTURES_PER_GROUP, showHidden: request.hidden ?? false };
    const departures = pairConnections(first, second, pairing);
    const widen = connects(departures) ? undefined : widenWindow(first, second, pairing);
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
      firstRoutes: [...new Set(link.firstLegs.map(({ pattern }) => pattern.route))].map((id) => tables.route(schedule.route(id))),
      window: { min, max },
      ...(widen ? { widen } : {}),
      departures,
    });
    for (const stop of [link.alight, link.board, ...link.alights, ...link.boards]) tripStops.add(stopKeyOf(stop));
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
    alerts: (() => {
      const alerts = relevantAlerts(realtime.alerts, tripStops, tripRoutes, agencies);
      // Alerts name platforms, so their stops join the tables for the page to name them.
      for (const key of alerts.flatMap(({ stops }) => stops)) {
        const stop = schedule.stopsByKey.get(key);
        if (stop) tables.stop(stop);
      }
      return alerts;
    })(),
    feeds: [...agencies].map((agency) => ({ agency, state: realtime.status(agency), updatedAt: realtime.updatedAt })),
  };
}

// With a destination set, only routes that get there count, and a transfer point none of whose
// routes do drops out. Where the rider catches a train at a shared station, every train that
// gets there pools into one group, whichever system or platform it leaves from.
function towardDestination(schedule: Schedule, links: Link[], destination: StopRow, toStop: StopRow | null): Link[] {
  const targets = new Set(schedule.boardingStops(destination).map(({ id }) => id));
  const reaching = links.flatMap((link) => {
    const boardPatterns = link.boardPatterns.filter(({ pattern, position }) => pattern.stops.slice(position + 1).some((id) => targets.has(id)));
    if (boardPatterns.length === 0) return [];
    const routeIds = new Set(boardPatterns.map(({ pattern }) => pattern.route));
    return [{ ...link, boardPatterns, routes: link.routes.filter(({ id }) => routeIds.has(id)) }];
  });
  if (!toStop || !schedule.sharedMembers.has(toStop.id)) return reaching;
  const pooled = new Map<number, Link>();
  for (const link of reaching) {
    const current = pooled.get(link.alight.id);
    if (!current) {
      pooled.set(link.alight.id, { ...link, key: `${link.alight.id}>${toStop.id}`, board: toStop, direction: null, headsign: destination.name });
      continue;
    }
    const firstLegs = new Map([...current.firstLegs, ...link.firstLegs].map((leg) => [`${leg.pattern.id}|${leg.origin}|${leg.alight}`, leg]));
    pooled.set(link.alight.id, {
      ...current,
      routes: [...new Set([...current.routes, ...link.routes])],
      boards: [...new Set([...current.boards, ...link.boards])],
      boardPatterns: [...current.boardPatterns, ...link.boardPatterns],
      firstLegs: [...firstLegs.values()],
      walkMeters: Math.min(current.walkMeters, link.walkMeters),
      defaultMinutes: Math.max(current.defaultMinutes, link.defaultMinutes),
      stopsRidden: Math.min(current.stopsRidden, link.stopsRidden),
    });
  }
  return [...pooled.values()];
}

const connects = (departures: Departure[]) => departures.some(({ canceled, connections }) => !canceled && connections.some(({ hidden }) => !hidden));

// The smallest symmetric widening of an empty window that finds a connection, within half an hour.
function widenWindow(first: FirstLeg[], second: SecondLeg[], pairing: PairingOptions) {
  for (let step = 1; step <= 30; step++) {
    const min = Math.max(0, pairing.min - step);
    const max = pairing.max + step;
    if (connects(pairConnections(first, second, { ...pairing, min, max, showHidden: false }))) return { min, max };
  }
  return null;
}

// Alerts that name a stop on the trip (for a route on the trip, or for every route there),
// that cover a trip route as a whole, or that cover a whole agency the trip uses. An alert
// about the same route at a stop the rider never uses is left out.
const LINE_WIDE_STOPS = 20;

function alertView(alert: RtAlert, relevance: AlertRelevance, routes: Set<string>, stops: Set<string>): Alert {
  return {
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
  };
}

export function relevantAlerts(alerts: RtAlert[], stops: Set<string>, routes: Set<string>, agencies: Set<AgencyId>): Alert[] {
  const order: Record<AlertRelevance, number> = { stop: 0, route: 1, agency: 2 };
  const results: Alert[] = [];
  for (const alert of alerts) {
    // Some alerts name every stop on a line, as Muni does for one elevator outage. Naming that
    // many stops says nothing about any one of them, so such an alert counts for its routes.
    const lineWide = alert.stops.length > LINE_WIDE_STOPS;
    if (lineWide) {
      const coversRoute = alert.routes.some((route) => routes.has(route));
      if (coversRoute) results.push(alertView(alert, 'route', routes, new Set()));
      continue;
    }
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
    results.push(alertView(alert, relevance, routes, stops));
  }
  return results.sort((a, b) => order[a.relevance] - order[b.relevance]);
}
