import { type AgencyId, type Departure, type DestinationsResponse, type Group, MAX_MINUTES, type Notice, type PinRequest, type TripResponse } from '../../shared/api.ts';
import type { Agency } from '../config.ts';
import { RequestError } from '../http.ts';
import { type Schedule, type StopRow, routeKeyOf, stopKeyOf } from '../schedule.ts';
import { type FirstLeg, type PairingOptions, type SecondLeg, pairConnections } from './connections.ts';
import { type Link, arrivalStops, findLinks, walkBetween, walkTo } from './links.ts';
import { pinnedTrip } from './pinned.ts';
import { type RealtimeView, serviceStatus, stationOutages } from './realtime-view.ts';
import type { RouteRow } from '../schedule.ts';
import { firstLegs, secondLegs } from './vehicles.ts';
import { Tables } from './views.ts';
import { DEFAULT_MAX_WALK_METERS, STEP_FREE_MINUTES, atRailStation, defaultMaximum } from './walk.ts';

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
  // At a shared station: ride from BART, Muni Metro, or both when absent.
  fromAgencies?: Agency[];
  // A trip the rider pinned, followed in the response as its vehicles run.
  pin?: PinRequest;
};

const DEPARTURES_PER_GROUP = 3;

// Transfer points depend on the schedule, walking settings, and which patterns are running, so
// they are worked out once per quarter hour and reused by every refresh in it. With `now` null,
// every pattern counts, which tells an idle route from one that never comes near.
const linkCache = new WeakMap<Schedule, Map<string, Link[]>>();

function cachedLinks(schedule: Schedule, from: StopRow, to: { stop: StopRow } | { route: RouteRow }, request: TripRequest, now: number | null) {
  let cache = linkCache.get(schedule);
  if (!cache) linkCache.set(schedule, (cache = new Map()));
  const { walk, speed, fromAgencies } = request;
  const when = now === null ? 'all' : Math.floor(now / 900);
  // The destination shapes the choice: a transfer point is picked among routes that get there.
  const destination = request.dest ? schedule.stopsByKey.get(request.dest) : undefined;
  const key = `${from.id}|${'stop' in to ? `s${to.stop.id}` : `r${to.route.id}`}|${walk ?? ''}|${speed ?? ''}|${fromAgencies?.join() ?? ''}|${destination?.id ?? ''}|${when}`;
  let links = cache.get(key);
  if (!links) {
    links = findLinks(schedule, from, to, {
      ...(walk ? { maxWalkMeters: walk } : {}),
      ...(speed ? { walkSpeed: speed } : {}),
      ...(fromAgencies?.length ? { fromAgencies: new Set(fromAgencies) } : {}),
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
        // BART riders get off at a station, not a platform.
        stops.push(tables.stop(schedule.bartStationOf(schedule.stop(id))));
      }
    }
    groups.push({ board: tables.stop(link.board), routes: link.routes.map((route) => tables.route(route)), headsign: link.headsign, stops: [...new Set(stops)] });
  }
  return { groups, routes: tables.routes, stops: tables.stops };
}

// Where a pinned trip may end: the destination, or the To stop or one on its corner, as the
// results count a departure's arrival. The trip ends at the first of these it reaches after
// picking the rider up.
function pinnedDestination(schedule: Schedule, destination: StopRow | null, toStop: StopRow | undefined) {
  if (toStop) return [toStop, ...arrivalStops(schedule, toStop)].map(stopKeyOf);
  return destination ? [stopKeyOf(destination)] : [];
}

export function planTrip(schedule: Schedule, realtime: RealtimeView, request: TripRequest, now: number): TripResponse {
  const { from, to } = resolveEnds(schedule, request);
  const toStop = 'stop' in to ? to.stop : undefined;
  const toRoute = 'route' in to ? to.route : undefined;
  // A stop in To is where the rider is going. A route may have a destination of its own.
  const destination = toStop ?? (request.dest ? (schedule.stopsByKey.get(request.dest) ?? null) : null);
  // Where a vehicle counts as having got the rider there.
  const arrivals = toStop ? arrivalStops(schedule, toStop) : destination ? schedule.boardingStops(destination) : [];

  const tables = new Tables(schedule);
  const allLinks = cachedLinks(schedule, from, to, request, now);
  const links = toRoute && destination ? towardDestination(schedule, allLinks, destination) : allLinks;
  const notice = links.length > 0 ? undefined : emptyNotice(schedule, from, to, request, destination, now);
  if (notice?.kind === 'walkable') tables.stop(schedule.stopsByKey.get(notice.stop)!);
  const firstFilter = request.firstRoutes?.length ? new Set(request.firstRoutes) : null;
  const secondFilter = request.secondRoutes?.length ? new Set(request.secondRoutes) : null;
  const context = { schedule, snapshot: realtime.trips, now };

  const groups: Group[] = [];
  // The stop keys where the rider rides BART, which a shared station's key alone does not say: the
  // stops of BART legs, and From, To, or the destination where a BART leg starts or ends. A shared
  // station's key outside it is Muni Metro's.
  const bartAt = new Set<string>();
  const isBart = (route: RouteRow) => route.agency === 'BA';
  const choseBart = (agencies?: Agency[]) => !agencies || agencies.includes('BA');
  // A walk group boards its route at From. Otherwise the first legs leave From.
  if (from.agency === 'BA' && choseBart(request.fromAgencies) && links.some((link) => (link.kind === 'walk' ? link.routes.some(isBart) : link.firstLegs.some(({ pattern }) => isBart(schedule.route(pattern.route)))))) {
    bartAt.add(stopKeyOf(from));
  }
  if (destination?.agency === 'BA' && links.some(({ routes }) => routes.some(isBart))) bartAt.add(stopKeyOf(destination));
  const tripStops = new Set<string>([...schedule.boardingStops(from), from].map(stopKeyOf));
  const tripRoutes = new Set<string>();
  // A shared station belongs to both systems, so its own agency says nothing about the trip.
  const agencies = new Set<AgencyId>(schedule.sharedMembers.has(from.id) ? [] : [from.agency]);
  for (const link of links) {
    const routes = link.routes.filter((route) => !secondFilter || secondFilter.has(routeKeyOf(route)));
    if (routes.length === 0) continue;
    const linkForRoutes = routes.length === link.routes.length ? link : { ...link, routes };
    // Changing at a station step-free takes longer, so the default minimum gets more. A minimum the
    // rider set is theirs as it is: the page sends the window back as shown, so adding to it would
    // add again on every edit.
    const atStation = [link.alight, link.board].some(atRailStation);
    const min = Math.min(MAX_MINUTES, request.min ?? link.defaultMinutes + (request.stepFree && link.kind === 'ride' && atStation ? STEP_FREE_MINUTES : 0));
    const feeders = link.firstLegs
      .filter(({ pattern }) => !firstFilter || firstFilter.has(routeKeyOf(schedule.route(pattern.route))))
      .map(({ pattern, origin }) => ({ pattern, position: origin }));
    const headway = request.max === undefined ? schedule.headwayMinutes(feeders, now) : null;
    const max = Math.min(MAX_MINUTES, Math.max(min, request.max ?? defaultMaximum(min, headway)));
    // A BART station means whichever of its platforms the trip stops at.
    const second = secondLegs(context, linkForRoutes, arrivals, true);
    let departures: Departure[];
    let widen: { min: number; max: number } | null = null;
    if (link.kind === 'walk') {
      // The rider's "hide departures under N" counts here too, alongside the walk itself.
      departures = walkDepartures(second, now, Math.max(link.defaultMinutes, request.hide ?? 0));
    } else {
      const first = firstLegs(context, linkForRoutes, firstFilter);
      const pairing = { now, min, max, hide: request.hide ?? 0, count: DEPARTURES_PER_GROUP, showHidden: request.hidden ?? false };
      departures = pairConnections(first, second, pairing);
      widen = connects(departures, now) ? null : widenWindow(first, second, pairing);
    }
    // A trip going somewhere other than the group's usual destination says where. A vehicle
    // letting the rider off somewhere other than the group's stop (or its station) says where.
    const groupStation = schedule.stationOf(link.alight).id;
    for (const departure of departures) {
      if (departure.toward === link.headsign) delete departure.toward;
      for (const connection of departure.connections) {
        const stop = connection.alight ? schedule.stopsByKey.get(connection.alight) : undefined;
        if (!stop || schedule.stationOf(stop).id === groupStation) delete connection.alight;
        else {
          connection.alight = tables.stop(schedule.stationOf(stop));
          // Its own walk, as the group's is from the group's stop.
          connection.walkMeters = Math.round(walkBetween(schedule, stop, link.board).meters);
          // Whether the rider rides BART there is the stop's own, not its shared station's.
          if (stop.agency === 'BA') bartAt.add(connection.alight);
        }
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
  const { alerts, feeds } = serviceStatus(schedule, realtime, tables, { stops: tripStops, routes: tripRoutes, agencies });

  return {
    generatedAt: now,
    dataAt: realtime.updatedAt,
    systems: feasibleSystems(schedule, from, to, request, destination, now),
    ...(notice ? { notice } : filtered ? { notice: filtered } : {}),
    from: stopKeyOf(from),
    to: toStop ? { stop: stopKeyOf(toStop) } : { route: routeKeyOf(toRoute!) },
    groups,
    ...(request.pin
      ? { pinned: pinnedTrip(schedule, realtime.trips, request.pin, stopKeyOf(from), pinnedDestination(schedule, destination, toStop), tables, now), pin: request.pin }
      : {}),
    routes: tables.routes,
    stops: tables.stops,
    alerts,
    ...(request.stepFree || request.escalators
      ? {
          access: stationOutages(
            schedule,
            tables,
            realtime.access ?? [],
            request,
            bartAt,
            [stopKeyOf(from), ...groups.flatMap(({ alight, board, departures }) => [alight, board, ...departures.flatMap(({ connections }) => connections.flatMap(({ alight }) => (alight ? [alight] : [])))]), ...(destination ? [stopKeyOf(destination)] : [])],
          ),
        }
      : {}),
    feeds,
  };
}

// With a destination set on a route, only its patterns that get there count, and a transfer point
// none of whose patterns do drops out.
function towardDestination(schedule: Schedule, links: Link[], destination: StopRow): Link[] {
  const targets = new Set(schedule.boardingStops(destination).map(({ id }) => id));
  return links.flatMap((link) => {
    const boardPatterns = link.boardPatterns.filter(({ pattern, position }) => pattern.stops.slice(position + 1).some((id) => targets.has(id)));
    if (boardPatterns.length === 0) return [];
    const routeIds = new Set(boardPatterns.map(({ pattern }) => pattern.route));
    return [{ ...link, boardPatterns, routes: link.routes.filter(({ id }) => routeIds.has(id)) }];
  });
}

// At a shared station From, which systems give a way there, tried one at a time. The page offers
// the BART or Muni Metro choice only when both do: Muni Metro from Montgomery reaches the 48 only
// by a long ride out to Church St and back, so it is no real option there.
function feasibleSystems(schedule: Schedule, from: StopRow, to: { stop: StopRow } | { route: RouteRow }, request: TripRequest, destination: StopRow | null, now: number) {
  const systems: { from?: AgencyId[] } = {};
  const works = (change: Partial<TripRequest>) => {
    const links = cachedLinks(schedule, from, to, { ...request, ...change }, now);
    return ('route' in to && destination ? towardDestination(schedule, links, destination) : links).length > 0;
  };
  if (schedule.sharedMembers.has(from.id)) systems.from = (['BA', 'SF'] as const).filter((agency) => works({ fromAgencies: [agency] }));
  return systems;
}

// Whether any connection shown is one the rider can still catch, rather than one under way.
const connects = (departures: Departure[], now: number) => departures.some(({ canceled, connections }) => !canceled && connections.some(({ hidden, departs }) => !hidden && departs >= now));

// The smallest raise of an empty window's maximum that finds a connection, within half an hour.
// The minimum stays, since it is the time the walk takes.
function widenWindow(first: FirstLeg[], second: SecondLeg[], pairing: PairingOptions) {
  for (let max = pairing.max + 1; max <= MAX_MINUTES; max++) {
    if (connects(pairConnections(first, second, { ...pairing, max, showHidden: false }), pairing.now)) return { min: pairing.min, max };
  }
  return null;
}

// Departures the rider can walk to in time, for a route that already stops at or near From, and
// those that have left but have yet to reach the destination, as the rider may be on one.
function walkDepartures(second: SecondLeg[], now: number, walkMinutes: number): Departure[] {
  const sorted = [...second].filter(({ at }) => at >= now + walkMinutes * 60).sort((a, b) => a.at - b.at);
  const running = sorted.filter(({ canceled }) => !canceled).slice(0, DEPARTURES_PER_GROUP);
  const last = running.at(-1)?.at ?? -Infinity;
  const underWay = second.filter(({ at, canceled, destination }) => !canceled && at < now && destination !== undefined && destination >= now);
  return [...underWay, ...sorted.filter((leg) => (running.includes(leg) || leg.canceled) && (!leg.canceled || leg.at <= last))]
    .sort((a, b) => a.at - b.at)
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
function emptyNotice(schedule: Schedule, from: StopRow, to: { stop: StopRow } | { route: RouteRow }, request: TripRequest, destination: StopRow | null, now: number): Notice {
  // The same links as the results would have at any hour, so the reason matches what they show.
  const all = cachedLinks(schedule, from, to, request, null);
  const always = 'route' in to && destination ? towardDestination(schedule, all, destination) : all;
  if (always.length === 0) {
    // No hour has a way there. When the stop is a short walk, that is why: routes that only reach
    // it on their last stops are dropped as rides to somewhere walkable, and J wants the page to
    // say it is a walk rather than show those buses. When something does go there but is not
    // running now, the idle notice below says so instead.
    const meters = destination ? walkTo(schedule, from, destination, request.walk ?? DEFAULT_MAX_WALK_METERS) : null;
    if (destination && meters !== null) return { kind: 'walkable', stop: stopKeyOf(destination), meters: Math.round(meters) };
    const { dest: _dest, ...withoutDestination } = request;
    return 'route' in to && request.dest && cachedLinks(schedule, from, to, withoutDestination, null).length > 0 ? { kind: 'destination' } : { kind: 'unreachable' };
  }
  const running = schedule.runningPatterns(now);
  const targets = [...new Set(always.flatMap(({ boardPatterns }) => boardPatterns.map(({ pattern }) => pattern.id)))];
  if (!targets.some((id) => running.has(id))) return { kind: 'idle', side: 'to', next: schedule.nextStart(targets, now) };
  const feeders = [...new Set(always.flatMap(({ firstLegs }) => firstLegs.map(({ pattern }) => pattern.id)))];
  // Walks board nothing at From, so From's own service is never the reason.
  if (feeders.length === 0) return { kind: 'idle', side: 'to', next: schedule.nextStart(targets, now) };
  return { kind: 'idle', side: 'from', next: schedule.nextStart(feeders, now) };
}
