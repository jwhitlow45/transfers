import { type AccessOutage, type Alert, type AlertRelevance, type AgencyId, type Departure, type DestinationsResponse, type FeedStatus, type Group, MAX_MINUTES, type Notice, type TripResponse } from '../../shared/api.ts';
import type { Agency } from '../config.ts';
import { bartStationCode } from '../bart-stations.ts';
import type { Outage } from '../realtime/access.ts';
import type { RtAlert, TripSnapshot } from '../realtime/snapshot.ts';
import { type Schedule, type StopRow, routeKeyOf, stopKeyOf } from '../schedule.ts';
import { type FirstLeg, type PairingOptions, type SecondLeg, pairConnections } from './connections.ts';
import { type Link, findLinks } from './links.ts';
import type { RouteRow } from '../schedule.ts';
import { firstLegs, secondLegs } from './vehicles.ts';
import { Tables } from './views.ts';
import { DEFAULT_MAX_WALK_METERS, defaultMaximum } from './walk.ts';
import { distanceMeters } from '../geo.ts';

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
  // A rider who needs elevators: their outages along the trip, and more time to change at stations.
  stepFree?: boolean;
  // A rider who relies on escalators: their outages along the trip.
  escalators?: boolean;
  // At a shared station: ride from or catch BART, Muni Metro, or both when absent.
  fromAgencies?: Agency[];
  toAgencies?: Agency[];
};

export type RealtimeView = {
  trips: TripSnapshot | null;
  alerts: RtAlert[];
  status: (agency: Agency) => FeedStatus['state'];
  updatedAt: number | null;
  // BART's elevator and escalator outages, when the rider asked for them.
  access?: Outage[] | null;
};

// Changing at a station step-free means waiting for and riding elevators, so the default transfer
// minimum gets this much more. A minimum the rider set is theirs as it is: the page sends the
// window back as shown, so adding to it would add again on every edit.
const STEP_FREE_MINUTES = 3;

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
  // The destination shapes the choice: a transfer point is picked among routes that get there.
  const destination = request.dest ? schedule.stopsByKey.get(request.dest) : undefined;
  const key = `${from.id}|${'stop' in to ? `s${to.stop.id}` : `r${to.route.id}`}|${walk ?? ''}|${speed ?? ''}|${fromAgencies?.join() ?? ''}|${toAgencies?.join() ?? ''}|${destination?.id ?? ''}|${when}`;
  let links = cache.get(key);
  if (!links) {
    links = findLinks(schedule, from, to, {
      ...(walk ? { maxWalkMeters: walk } : {}),
      ...(speed ? { walkSpeed: speed } : {}),
      ...(fromAgencies?.length ? { fromAgencies: new Set(fromAgencies) } : {}),
      ...(toAgencies?.length ? { toAgencies: new Set(toAgencies) } : {}),
      ...(now === null ? {} : { running: schedule.runningPatterns(now) }),
      ...(destination ? { reaches: new Set(schedule.boardingStops(destination).map(({ id }) => id)) } : {}),
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
  const { dest: _dest, ...withoutDestination } = request;
  for (const link of cachedLinks(schedule, from, to, withoutDestination, null)) {
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
  const notice = links.length > 0 ? undefined : emptyNotice(schedule, from, to, request, destination, toStop ?? null, now);
  if (notice?.kind === 'walkable') tables.stop(schedule.stopsByKey.get(notice.stop)!);
  const firstFilter = request.firstRoutes?.length ? new Set(request.firstRoutes) : null;
  const secondFilter = request.secondRoutes?.length ? new Set(request.secondRoutes) : null;
  const context = { schedule, snapshot: realtime.trips, now };

  const groups: Group[] = [];
  // The stop keys where the rider rides BART: a BART From, To, or destination, unless they chose
  // Muni Metro there, and the stops of BART legs. A shared station's key outside it is Muni Metro's.
  const ridesBart = (stop: StopRow, agencies?: Agency[]) => stop.agency === 'BA' && (!agencies || agencies.includes('BA'));
  const bartAt = new Set<string>();
  if (ridesBart(from, request.fromAgencies)) bartAt.add(stopKeyOf(from));
  if (toStop && ridesBart(toStop, request.toAgencies)) bartAt.add(stopKeyOf(toStop));
  if (destination && ridesBart(destination)) bartAt.add(stopKeyOf(destination));
  const tripStops = new Set<string>([...schedule.boardingStops(from), from].map(stopKeyOf));
  const tripRoutes = new Set<string>();
  // A shared station belongs to both systems, so its own agency says nothing about the trip.
  const agencies = new Set<AgencyId>(schedule.sharedMembers.has(from.id) ? [] : [from.agency]);
  for (const link of links) {
    const routes = link.routes.filter((route) => !secondFilter || secondFilter.has(routeKeyOf(route)));
    if (routes.length === 0) continue;
    const linkForRoutes = routes.length === link.routes.length ? link : { ...link, routes };
    const atStation = [link.alight, link.board].some(({ access }) => access === 'bart' || access === 'subway');
    const min = Math.min(MAX_MINUTES, request.min ?? link.defaultMinutes + (request.stepFree && link.kind === 'ride' && atStation ? STEP_FREE_MINUTES : 0));
    const feeders = link.firstLegs
      .filter(({ pattern }) => !firstFilter || firstFilter.has(routeKeyOf(schedule.route(pattern.route))))
      .map(({ pattern, origin }) => ({ pattern, position: origin }));
    const headway = request.max === undefined ? schedule.headwayMinutes(feeders, now) : null;
    const max = Math.min(MAX_MINUTES, Math.max(min, request.max ?? defaultMaximum(min, headway)));
    // Riding straight to a named stop, the time each departure reaches it is the point.
    const reaching = link.kind === 'walk' && toStop && !schedule.boardingStops(toStop).includes(link.board) ? toStop : null;
    const second = secondLegs(context, linkForRoutes, destination ?? reaching);
    let departures: Departure[];
    let widen: { min: number; max: number } | null = null;
    if (link.kind === 'walk') {
      // The rider's "hide departures under N" counts here too, alongside the walk itself.
      departures = walkDepartures(second, now, Math.max(link.defaultMinutes, request.hide ?? 0));
    } else {
      const first = firstLegs(context, linkForRoutes, firstFilter);
      const pairing = { now, min, max, hide: request.hide ?? 0, count: DEPARTURES_PER_GROUP, showHidden: request.hidden ?? false };
      departures = pairConnections(first, second, pairing);
      widen = connects(departures) ? null : widenWindow(first, second, pairing);
    }
    // A trip going somewhere other than the group's usual destination says where. A vehicle
    // letting the rider off somewhere other than the group's stop (or its station) says where.
    const groupStation = schedule.stationOf(link.alight).id;
    for (const departure of departures) {
      if (departure.toward === link.headsign) delete departure.toward;
      for (const connection of departure.connections) {
        const stop = connection.alight ? schedule.stopsByKey.get(connection.alight) : undefined;
        if (!stop || schedule.stationOf(stop).id === groupStation) delete connection.alight;
        else connection.alight = tables.stop(schedule.stationOf(stop));
      }
    }
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
      ...(link.longestWalkMeters > link.walkMeters ? { longestWalkMeters: link.longestWalkMeters } : {}),
      firstRoutes: [...new Set(link.firstLegs.map(({ pattern }) => pattern.route))].map((id) => tables.route(schedule.route(id))),
      window: { min, max },
      ...(widen ? { widen } : {}),
      departures,
    });
    for (const stop of [link.alight, link.board, ...link.alights, ...link.boards]) tripStops.add(stopKeyOf(stop));
    // Where the rider rides BART, which a shared station's key alone does not say.
    if (link.alights.some(({ agency }) => agency === 'BA')) bartAt.add(stopKeyOf(link.alight));
    if (link.boards.some(({ agency }) => agency === 'BA')) bartAt.add(stopKeyOf(link.board));
    for (const departure of departures) for (const { alight } of departure.connections) if (alight?.startsWith('BA:')) bartAt.add(alight);
    for (const route of routes) tripRoutes.add(routeKeyOf(route));
    for (const { pattern } of link.firstLegs) {
      tripRoutes.add(routeKeyOf(schedule.route(pattern.route)));
      agencies.add(schedule.route(pattern.route).agency);
    }
    agencies.add(link.board.agency);
  }
  const filtered = groups.length === 0 && links.length > 0 && !notice ? ({ kind: 'filtered' } as const) : undefined;
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
    ...(notice ? { notice } : filtered ? { notice: filtered } : {}),
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
    ...(request.stepFree || request.escalators
      ? {
          access: stationOutages(
            schedule,
            tables,
            realtime.access ?? [],
            request,
            bartAt,
            [stopKeyOf(from), ...groups.flatMap(({ alight, board, departures }) => [alight, board, ...departures.flatMap(({ connections }) => connections.flatMap(({ alight }) => (alight ? [alight] : [])))]), ...(destination ? [stopKeyOf(destination)] : []), ...(toStop ? [stopKeyOf(toStop)] : [])],
          ),
        }
      : {}),
    feeds: [...agencies].map((agency) => ({ agency, state: realtime.status(agency), updatedAt: realtime.updatedAt })),
  };
}

// The outages the rider asked about at the BART stations behind the given stop keys, each with
// every key that leads to its station, so the page can mark the groups it touches.
function stationOutages(schedule: Schedule, tables: Tables, outages: Outage[], request: TripRequest, bartAt: Set<string>, keys: string[]): AccessOutage[] {
  const kinds = new Set<Outage['kind']>([...(request.stepFree ? ['elevator' as const] : []), ...(request.escalators ? ['escalator' as const] : [])]);
  const found = new Map<Outage, AccessOutage>();
  for (const key of new Set(keys)) {
    const stop = schedule.stopsByKey.get(key);
    const station = stop ? schedule.stationOf(stop) : null;
    const code = station?.agency === 'BA' ? bartStationCode(station) : null;
    if (!station || !code) continue;
    // At a shared station, BART's platform elevators and escalators are no part of a Muni Metro
    // rider's way, while its street and concourse ones are shared.
    const metroOnly = !bartAt.has(key);
    for (const outage of outages) {
      if (outage.station !== code || !kinds.has(outage.kind)) continue;
      if (metroOnly && /^platform/i.test(outage.location)) continue;
      const entry = found.get(outage) ?? { station: tables.stop(station), stops: [], kind: outage.kind, location: outage.location, reason: outage.reason, returns: outage.returns };
      entry.stops.push(key);
      found.set(outage, entry);
    }
  }
  return [...found.values()];
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
  // A walk group boards where the route already is, so it keeps its own stop.
  const pooled = new Map<string, Link>();
  const walks = reaching.filter(({ kind }) => kind === 'walk');
  for (const link of reaching.filter(({ kind }) => kind === 'ride')) {
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
      longestWalkMeters: Math.max(current.longestWalkMeters, link.longestWalkMeters),
      defaultMinutes: Math.max(current.defaultMinutes, link.defaultMinutes),
      stopsRidden: Math.min(current.stopsRidden, link.stopsRidden),
    });
  }
  return [...walks, ...pooled.values()];
}

// At a shared station, which systems give a transfer within the usual walk, tried one at a
// time. The page offers the BART or Muni Metro choice only when both do: Muni Metro from
// Montgomery reaches the 48 only by a long walk from Church St, so it is no real option there.
function feasibleSystems(schedule: Schedule, from: StopRow, to: { stop: StopRow } | { route: RouteRow }, request: TripRequest, destination: StopRow | null, now: number) {
  const systems: { from?: AgencyId[]; to?: AgencyId[] } = {};
  const works = (change: Partial<TripRequest>) => {
    const links = cachedLinks(schedule, from, to, { ...request, ...change }, now);
    const toStop = 'stop' in to ? to.stop : null;
    // A walk group needs no transfer, so it does not make a system a real choice.
    return (destination ? towardDestination(schedule, links, destination, toStop) : links).some(({ kind, long }) => kind === 'ride' && !long);
  };
  if (schedule.sharedMembers.has(from.id)) systems.from = (['BA', 'SF'] as const).filter((agency) => works({ fromAgencies: [agency] }));
  if ('stop' in to && schedule.sharedMembers.has(to.stop.id)) systems.to = (['BA', 'SF'] as const).filter((agency) => works({ toAgencies: [agency] }));
  return systems;
}

const connects = (departures: Departure[]) => departures.some(({ canceled, connections }) => !canceled && connections.some(({ hidden }) => !hidden));

// The smallest raise of an empty window's maximum that finds a connection, within half an hour.
// The minimum stays, since it is the time the walk takes.
function widenWindow(first: FirstLeg[], second: SecondLeg[], pairing: PairingOptions) {
  for (let max = pairing.max + 1; max <= MAX_MINUTES; max++) {
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

// Why a trip has no groups. The links over every pattern, running or not, say what would work
// at another hour. When the routes to transfer to are not running, the notice is about them.
// When they are, it is the routes from From that are not, and the notice says so.
function emptyNotice(schedule: Schedule, from: StopRow, to: { stop: StopRow } | { route: RouteRow }, request: TripRequest, destination: StopRow | null, toStop: StopRow | null, now: number): Notice {
  // The same links as the results would have at any hour, so the reason matches what they show.
  const all = cachedLinks(schedule, from, to, request, null);
  const always = destination ? towardDestination(schedule, all, destination, toStop) : all;
  if (always.length === 0) {
    // No hour has a way there. When the named stop is a short walk, that is why: routes that
    // only reach it on their last stops are dropped as rides to somewhere walkable, and J wants
    // the page to say it is a walk rather than show those buses. When something does go there
    // but is not running now, the idle notice below says so instead.
    const named = destination ?? toStop;
    const meters = named ? Math.round(distanceMeters(from, named)) : Infinity;
    if (named && meters <= (request.walk ?? DEFAULT_MAX_WALK_METERS)) return { kind: 'walkable', stop: stopKeyOf(named), meters };
    const { dest: _dest, ...withoutDestination } = request;
    return request.dest && cachedLinks(schedule, from, to, withoutDestination, null).length > 0 ? { kind: 'destination' } : { kind: 'unreachable' };
  }
  const running = schedule.runningPatterns(now);
  const targets = [...new Set(always.flatMap(({ boardPatterns }) => boardPatterns.map(({ pattern }) => pattern.id)))];
  if (!targets.some((id) => running.has(id))) return { kind: 'idle', side: 'to', next: schedule.nextStart(targets, now) };
  const feeders = [...new Set(always.flatMap(({ firstLegs }) => firstLegs.map(({ pattern }) => pattern.id)))];
  // Walks board nothing at From, so From's own service is never the reason.
  if (feeders.length === 0) return { kind: 'idle', side: 'to', next: schedule.nextStart(targets, now) };
  return { kind: 'idle', side: 'from', next: schedule.nextStart(feeders, now) };
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
