import type { Alert, AlertRelevance, AgencyId, Departure, DestinationsResponse, FeedStatus, Group, Notice, TripResponse } from '../../shared/api.ts';
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

// Transfer points depend on the schedule, walking settings, and which patterns are running, so
// they are worked out once per quarter hour and reused by every refresh in it. With `now` null,
// every pattern counts, which tells an idle route from one that never comes near.
const linkCache = new WeakMap<Schedule, Map<string, Link[]>>();

function cachedLinks(schedule: Schedule, from: StopRow, to: { stop: StopRow } | { route: RouteRow }, request: TripRequest, now: number | null) {
  let cache = linkCache.get(schedule);
  if (!cache) linkCache.set(schedule, (cache = new Map()));
  const { walk, speed, fromAgencies, toAgencies } = request;
  const when = now === null ? 'all' : Math.floor(now / 900);
  const key = `${from.id}|${'stop' in to ? `s${to.stop.id}` : `r${to.route.id}`}|${walk ?? ''}|${speed ?? ''}|${fromAgencies?.join() ?? ''}|${toAgencies?.join() ?? ''}|${when}`;
  let links = cache.get(key);
  if (!links) {
    links = findLinks(schedule, from, to, {
      ...(walk ? { maxWalkMeters: walk } : {}),
      ...(speed ? { walkSpeed: speed } : {}),
      ...(fromAgencies?.length ? { fromAgencies: new Set(fromAgencies) } : {}),
      ...(toAgencies?.length ? { toAgencies: new Set(toAgencies) } : {}),
      ...(now === null ? {} : { running: schedule.runningPatterns(now) }),
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
  for (const link of cachedLinks(schedule, from, to, request, null)) {
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
  const allLinks = cachedLinks(schedule, from, to, request, now);
  const links = destination ? towardDestination(schedule, allLinks, destination, toStop ?? null) : allLinks;
  const notice = links.length > 0 ? undefined : emptyNotice(schedule, from, to, request, allLinks.length > 0 && destination !== null, now);
  const firstFilter = request.firstRoutes?.length ? new Set(request.firstRoutes) : null;
  const secondFilter = request.secondRoutes?.length ? new Set(request.secondRoutes) : null;
  const context = { schedule, snapshot: realtime.trips, now };

  const groups: Group[] = [];
  const tripStops = new Set<string>([...schedule.boardingStops(from), from].map(stopKeyOf));
  const tripRoutes = new Set<string>();
  // A shared station belongs to both systems, so its own agency says nothing about the trip.
  const agencies = new Set<AgencyId>(schedule.sharedMembers.has(from.id) ? [] : [from.agency]);
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
    // Riding straight to a named stop, the time each departure reaches it is the point.
    const reaching = link.kind === 'walk' && toStop && !schedule.boardingStops(toStop).includes(link.board) ? toStop : null;
    const second = secondLegs(context, linkForRoutes, destination ?? reaching);
    let departures: Departure[];
    let widen: { min: number; max: number } | null = null;
    if (link.kind === 'walk') {
      departures = walkDepartures(second, now, link.defaultMinutes);
    } else {
      const first = firstLegs(context, linkForRoutes, firstFilter);
      const pairing = { now, min, max, hide: request.hide ?? 0, count: DEPARTURES_PER_GROUP, showHidden: request.hidden ?? false };
      departures = pairConnections(first, second, pairing);
      widen = connects(departures) ? null : widenWindow(first, second, pairing);
    }
    // A trip going somewhere other than the group's usual destination says where.
    for (const departure of departures) if (departure.toward === link.headsign) delete departure.toward;
    for (const departure of departures) {
      tables.route(departure.route);
      for (const connection of departure.connections) tables.route(connection.route);
    }
    groups.push({
      ...(link.kind === 'walk' ? { kind: 'walk' as const } : {}),
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
    for (const { pattern } of link.firstLegs) {
      tripRoutes.add(routeKeyOf(schedule.route(pattern.route)));
      agencies.add(schedule.route(pattern.route).agency);
    }
    agencies.add(link.board.agency);
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
    dataAt: realtime.updatedAt,
    systems: feasibleSystems(schedule, from, to, request, destination, now),
    ...(notice ? { notice } : {}),
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
  const pooled = new Map<string, Link>();
  for (const link of reaching) {
    const key = `${link.kind}|${link.alight.id}`;
    const current = pooled.get(key);
    if (!current) {
      pooled.set(key, { ...link, key: `${key}>${toStop.id}`, board: toStop, direction: null, headsign: destination.name });
      continue;
    }
    const firstLegs = new Map([...current.firstLegs, ...link.firstLegs].map((leg) => [`${leg.pattern.id}|${leg.origin}|${leg.alight}`, leg]));
    pooled.set(key, {
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

// At a shared station, which systems give a transfer within the usual walk, tried one at a
// time. The page offers the BART or Muni Metro choice only when both do: Muni Metro from
// Montgomery reaches the 48 only by a long walk from Church St, so it is no real option there.
function feasibleSystems(schedule: Schedule, from: StopRow, to: { stop: StopRow } | { route: RouteRow }, request: TripRequest, destination: StopRow | null, now: number) {
  const systems: { from?: AgencyId[]; to?: AgencyId[] } = {};
  const works = (change: Partial<TripRequest>) => {
    const links = cachedLinks(schedule, from, to, { ...request, ...change }, now);
    const toStop = 'stop' in to ? to.stop : null;
    return (destination ? towardDestination(schedule, links, destination, toStop) : links).some(({ long }) => !long);
  };
  if (schedule.sharedMembers.has(from.id)) systems.from = (['BA', 'SF'] as const).filter((agency) => works({ fromAgencies: [agency] }));
  if ('stop' in to && schedule.sharedMembers.has(to.stop.id)) systems.to = (['BA', 'SF'] as const).filter((agency) => works({ toAgencies: [agency] }));
  return systems;
}

const connects = (departures: Departure[]) => departures.some(({ canceled, connections }) => !canceled && connections.some(({ hidden }) => !hidden));

// The smallest raise of an empty window's maximum that finds a connection, within half an hour.
// The minimum stays, since it is the time the walk takes.
function widenWindow(first: FirstLeg[], second: SecondLeg[], pairing: PairingOptions) {
  for (let step = 1; step <= 30; step++) {
    const max = pairing.max + step;
    if (connects(pairConnections(first, second, { ...pairing, max, showHidden: false }))) return { min: pairing.min, max };
  }
  return null;
}

// Departures the rider can walk to in time, for a route that already stops at or near From.
function walkDepartures(second: SecondLeg[], now: number, walkMinutes: number): Departure[] {
  const sorted = [...second].filter(({ at }) => at >= now + walkMinutes * 60).sort((a, b) => a.at - b.at);
  const running = sorted.filter(({ canceled }) => !canceled).slice(0, DEPARTURES_PER_GROUP);
  const last = running.at(-1)?.at ?? -Infinity;
  return sorted
    .filter((leg) => !leg.canceled || leg.at <= last)
    .filter((leg) => running.includes(leg) || leg.canceled)
    .map(({ trip, route, at, delay, live, canceled, destination, toward }) => ({
      trip,
      route,
      at,
      delay,
      live,
      connections: [],
      ...(canceled ? { canceled: true } : {}),
      ...(destination !== undefined && destination > at ? { destination } : {}),
      ...(toward ? { toward } : {}),
    }));
}

// Why a trip has no groups: the routes are not running for a while (and when they next start),
// nothing reaches the destination, or nothing comes within a walk at all.
function emptyNotice(schedule: Schedule, from: StopRow, to: { stop: StopRow } | { route: RouteRow }, request: TripRequest, destinationOnly: boolean, now: number): Notice {
  if (destinationOnly) return { kind: 'destination' };
  if (cachedLinks(schedule, from, to, request, null).length === 0) return { kind: 'unreachable' };
  const patterns =
    'route' in to
      ? [...schedule.patterns.values()].filter(({ route }) => route === to.route.id || schedule.route(route).shortName.replace(/-[NS]$/, '') === to.route.shortName.replace(/-[NS]$/, '') && to.route.agency === 'BA').map(({ id }) => id)
      : schedule.boardingStops(to.stop).flatMap(({ id }) => (schedule.patternsByStop.get(id) ?? []).map(({ pattern }) => pattern.id));
  return { kind: 'idle', next: schedule.nextStart(patterns, now) };
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
      if (coversRoute) results.push({ ...alertView(alert, 'route', routes, new Set()), lineWide: true });
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
