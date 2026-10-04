import { distanceMeters } from '../geo.ts';
import type { Agency } from '../config.ts';
import { type PatternRow, type RouteRow, type Schedule, type StopRow, stopKeyOf } from '../schedule.ts';
import {
  DEFAULT_MAX_WALK_METERS,
  NAMED_STOP_MAX_WALK_METERS,
  STATION_WALK_FACTOR,
  minimumMinutes,
  transferSeconds,
} from './walk.ts';

// Transfers J has timed, keyed "<alight stop>><board stop>", in minutes. They win over the estimate.
const CALIBRATED_MINUTES: Record<string, number> = {
  'BA:901601>SF:13477': 3, // 24th St Mission southbound to the 48 at 24th St & Mission St
  'BA:901401>SF:13209': 3, // Civic Center southbound to the 19 at 8th St & Market St
};

// Where a rider can transfer: get off the first vehicle at one of `alights`, walk, and board
// one of `routes` at one of `boards`. Usually there is one of each. At a shared station, BART
// and Muni Metro platforms pool into one transfer point, and `alight` or `board` is the station.
export type Link = {
  key: string;
  alight: StopRow;
  alights: StopRow[];
  board: StopRow;
  boards: StopRow[];
  routes: RouteRow[];
  direction: number | null;
  headsign: string;
  // Second-leg patterns that board at one of `boards`, with the stop and its position in each.
  boardPatterns: BoardPattern[];
  // First-leg patterns that reach `alight` from the From stop, with both positions.
  firstLegs: { pattern: PatternRow; origin: number; alight: number }[];
  walkMeters: number;
  defaultMinutes: number;
  // Fewest stops ridden on the first leg, for ordering transfer points along the way.
  stopsRidden: number;
  // A walk longer than the usual range, kept only because nothing closer reaches the named stop.
  long?: boolean;
};

export type BoardPattern = { pattern: PatternRow; position: number; stop: StopRow };

export type LinkSettings = {
  maxWalkMeters?: number;
  walkSpeed?: number;
  // At a shared station: ride from or catch BART's platforms, Muni Metro's, or both when empty.
  fromAgencies?: ReadonlySet<Agency>;
  toAgencies?: ReadonlySet<Agency>;
};

type BoardStop = { stop: StopRow; patterns: { pattern: PatternRow; position: number }[] };

// What the rider wants to board: a route in one direction, or every line leaving one BART
// platform, since riders transferring to BART care which way the train goes, not its color.
type Target = { routes: RouteRow[]; direction: number | null; headsign: string; stops: BoardStop[] };

export function findLinks(schedule: Schedule, from: StopRow, to: { stop: StopRow } | { route: RouteRow }, settings: LinkSettings = {}) {
  const maxWalk = settings.maxWalkMeters ?? DEFAULT_MAX_WALK_METERS;
  const namedStop = 'stop' in to;
  const targets = namedStop ? stopTargets(schedule, to.stop, settings.toAgencies ?? null) : routeTargets(schedule, to.route);
  const firstPatterns = schedule
    .boardingStops(from, settings.fromAgencies ?? null)
    .flatMap((origin) =>
      (schedule.patternsByStop.get(origin.id) ?? [])
        .filter(({ pattern, position }) => position < pattern.stops.length - 1)
        .map((entry) => ({ ...entry, originStop: origin })),
    );

  const links = new Map<string, Link>();
  for (const { pattern, position: origin, originStop } of firstPatterns) {
    for (const target of targets) {
      // Riding the route you want to transfer to is not a transfer.
      const routes = target.routes.filter(({ id }) => id !== pattern.route);
      if (routes.length === 0) continue;
      const context = { schedule, pattern, origin, originStop, target, namedStop, maxWalk, speed: settings.walkSpeed };
      for (const pick of contactPoints(context)) {
        // Getting off BART or Muni Metro in the same shared station is one transfer point.
        const alightAt = schedule.sharedStation.get(pick.alight.id) ?? pick.alight.id;
        const key = `${target.routes.map(({ id }) => id).join(',')}|${target.direction}|${alightAt}|${pick.board.stop.id}`;
        let link = links.get(key);
        if (!link) {
          link = {
            key,
            alight: pick.alight,
            alights: [pick.alight],
            board: pick.board.stop,
            boards: [pick.board.stop],
            routes,
            direction: target.direction,
            headsign: target.headsign,
            boardPatterns: pick.board.patterns
              .filter(({ pattern: boardPattern }) => boardPattern.route !== pattern.route)
              .map((entry) => ({ ...entry, stop: pick.board.stop })),
            firstLegs: [],
            walkMeters: Math.round(pick.meters),
            defaultMinutes: pick.minutes,
            stopsRidden: pick.position - origin,
          };
          links.set(key, link);
        } else if (!link.alights.includes(pick.alight)) {
          link.alights.push(pick.alight);
          link.alight = schedule.stationOf(pick.alight);
          link.walkMeters = Math.min(link.walkMeters, Math.round(pick.meters));
          // One window has to fit both systems' platforms, so it takes the longer of their minimums.
          link.defaultMinutes = Math.max(link.defaultMinutes, pick.minutes);
        }
        link.firstLegs.push({ pattern, origin, alight: pick.position });
        link.stopsRidden = Math.min(link.stopsRidden, pick.position - origin);
      }
    }
  }
  let found = [...links.values()];
  // A named stop allows a long walk so that a stop with no close transfer still finds one. When
  // some transfer point is within the usual range, the long walks (the J to Church St when BART
  // stops beside the bus) only crowd it out.
  if (namedStop) {
    const usual = (link: Link) => link.walkMeters <= (isStation(link.alight) || isStation(link.board) ? maxWalk * STATION_WALK_FACTOR : maxWalk);
    if (found.some(usual)) found = found.filter(usual);
    else for (const link of found) link.long = true;
  }
  return found.sort(
    (a, b) =>
      a.stopsRidden - b.stopsRidden ||
      (a.routes[0]?.shortName ?? '').localeCompare(b.routes[0]?.shortName ?? '', 'en', { numeric: true }) ||
      (a.direction ?? 0) - (b.direction ?? 0),
  );
}

const isStation = (stop: StopRow) => stop.access === 'bart' || stop.access === 'subway' || stop.kind === 'station';

type Context = {
  schedule: Schedule;
  pattern: PatternRow;
  origin: number;
  originStop: StopRow;
  target: Target;
  namedStop: boolean;
  maxWalk: number;
  speed: number | undefined;
};

// Along one first-leg pattern after the From stop, the stops within walking range of the target
// form stretches. Each stretch gives one transfer point, the quickest in it. Two routes sharing
// a street for a mile meet once, not at every stop, while BART stations a mile apart that each
// sit near the same bus line stay separate options.
function contactPoints({ schedule, pattern, origin, originStop, target, namedStop, maxWalk, speed }: Context) {
  type Pick = { position: number; alight: StopRow; board: BoardStop; meters: number; minutes: number; seconds: number };
  // Riding only makes sense if it brings the rider closer than they started.
  const startingDistance = new Map(target.stops.map((board) => [board.stop.id, walkBetween(schedule, originStop, board.stop).meters]));
  const picks: Pick[] = [];
  let stretch: Pick | null = null;
  let previous: StopRow | null = null;
  for (let position = origin + 1; position < pattern.stops.length; position++) {
    const alight = schedule.stop(pattern.stops[position]!);
    let best: Pick | null = null;
    for (const board of target.stops) {
      const walk = walkBetween(schedule, alight, board.stop);
      const limit = namedStop ? NAMED_STOP_MAX_WALK_METERS : walk.involvesStation ? maxWalk * STATION_WALK_FACTOR : maxWalk;
      if (walk.meters > limit || walk.meters >= (startingDistance.get(board.stop.id) ?? Infinity)) continue;
      const seconds = walk.fixedSeconds ?? transferSeconds({ exit: alight.access, entry: board.stop.access, meters: walk.meters, ...(speed ? { speed } : {}) });
      const calibrated = CALIBRATED_MINUTES[`${stopKeyOf(alight)}>${stopKeyOf(board.stop)}`];
      const minutes = calibrated ?? minimumMinutes(seconds);
      if (!best || seconds < best.seconds) best = { position, alight, board, meters: walk.meters, minutes, seconds };
    }
    // A gap in range, or a long hop between stops, ends the stretch.
    const continues = best && stretch && previous && distanceMeters(previous, alight) <= maxWalk;
    if (best && continues) {
      if (best.seconds < stretch!.seconds) stretch = best;
    } else {
      if (stretch) picks.push(stretch);
      stretch = best;
    }
    previous = alight;
  }
  if (stretch) picks.push(stretch);
  // A rider naming the exact stop wants the one quickest way there.
  if (namedStop && picks.length > 1) return [picks.reduce((a, b) => (b.seconds < a.seconds ? b : a))];
  return picks;
}

// Between BART and Muni Metro platforms inside a shared station: up or down a level, through
// both sets of fare gates.
const SHARED_STATION_SECONDS = 150;

// Distance runs from the nearest station entrance when either end is a BART platform or a
// shared station's Muni Metro platform, since that is where the walk starts. Two BART platforms
// in one station use BART's own transfer time.
function walkBetween(schedule: Schedule, alight: StopRow, board: StopRow) {
  const involvesStation = alight.access === 'bart' || alight.access === 'subway' || board.access === 'bart' || board.access === 'subway';
  if (alight.parent !== null && alight.parent === board.parent && alight.access === 'bart') {
    const listed = schedule.transfers.get(`${alight.id}>${board.id}`);
    return { meters: distanceMeters(alight, board), involvesStation, fixedSeconds: listed ?? 60 };
  }
  const sharedAlight = schedule.sharedStation.get(alight.id);
  if (sharedAlight !== undefined && sharedAlight === schedule.sharedStation.get(board.id)) {
    return { meters: distanceMeters(alight, board), involvesStation, fixedSeconds: SHARED_STATION_SECONDS };
  }
  const points = (stop: StopRow) => {
    const station = schedule.sharedStation.get(stop.id) ?? (stop.access === 'bart' ? stop.parent : null);
    if (station === null) return [stop];
    const entrances = schedule.entrances.get(station) ?? [];
    return entrances.length > 0 ? entrances : [stop];
  };
  let meters = Infinity;
  for (const a of points(alight)) for (const b of points(board)) meters = Math.min(meters, distanceMeters(a, b));
  return { meters, involvesStation, fixedSeconds: undefined };
}

// Every route and direction that boards at a stop. At a rail platform (BART or Muni Metro
// underground), one target per platform: the next train that way, whatever its line.
function stopTargets(schedule: Schedule, stop: StopRow, agencies: ReadonlySet<Agency> | null): Target[] {
  const targets = new Map<string, Target>();
  for (const board of schedule.boardingStops(stop, agencies)) {
    for (const { pattern, position } of schedule.patternsByStop.get(board.id) ?? []) {
      if (position >= pattern.stops.length - 1) continue;
      const route = schedule.route(pattern.route);
      const byPlatform = route.agency === 'BA' || board.access === 'subway';
      const key = byPlatform ? `platform|${board.id}` : `${route.id}|${pattern.direction}|${board.id}`;
      let target = targets.get(key);
      if (!target) {
        target = { routes: [], direction: pattern.direction, headsign: '', stops: [{ stop: board, patterns: [] }] };
        targets.set(key, target);
      }
      if (!target.routes.includes(route)) target.routes.push(route);
      target.stops[0]!.patterns.push({ pattern, position });
    }
  }
  for (const target of targets.values()) target.headsign = headsignFor(target);
  return [...targets.values()];
}

// Each direction of a route, with every stop it boards at.
function routeTargets(schedule: Schedule, route: RouteRow): Target[] {
  const byDirection = new Map<number | null, Map<number, BoardStop>>();
  for (const pattern of schedule.patternsByRoute.get(route.id) ?? []) {
    let stops = byDirection.get(pattern.direction);
    if (!stops) byDirection.set(pattern.direction, (stops = new Map()));
    for (const [position, stopId] of pattern.stops.entries()) {
      if (position >= pattern.stops.length - 1) continue;
      let entry = stops.get(stopId);
      if (!entry) stops.set(stopId, (entry = { stop: schedule.stop(stopId), patterns: [] }));
      entry.patterns.push({ pattern, position });
    }
  }
  return [...byDirection].map(([direction, stops]) => {
    const target: Target = { routes: [route], direction, headsign: '', stops: [...stops.values()] };
    target.headsign = headsignFor(target);
    return target;
  });
}

// The most common headsign, or for several BART lines, each line's most common one.
function headsignFor(target: Target) {
  const patterns = target.stops.flatMap(({ patterns }) => patterns);
  const top = (list: typeof patterns) => {
    const counts = new Map<string, number>();
    for (const { pattern } of list) counts.set(pattern.headsign, (counts.get(pattern.headsign) ?? 0) + pattern.trips);
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  };
  if (target.routes.length === 1) return top(patterns);
  const perRoute = target.routes.map((route) => top(patterns.filter(({ pattern }) => pattern.route === route.id)));
  return [...new Set(perRoute.filter(Boolean))].join(' / ');
}
