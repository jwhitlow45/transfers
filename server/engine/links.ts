import { walkSeconds } from '../../shared/walk.ts';
import type { Agency } from '../config.ts';
import { distanceMeters } from '../geo.ts';
import { type PatternRow, type RouteRow, type Schedule, type StopRow, stopKeyOf } from '../schedule.ts';
import {
  DEFAULT_MAX_WALK_METERS,
  NAMED_STOP_MAX_WALK_METERS,
  STATION_WALK_FACTOR,
  minimumMinutes,
  paceFreeSeconds,
  transferSeconds,
} from './walk.ts';

// Transfers J has timed, keyed "<alight stop>><board stop>", in minutes. They win over the estimate.
const CALIBRATED_MINUTES: Record<string, number> = {
  'BA:901601>SF:13477': 3, // 24th St Mission southbound to the 48 at 24th St & Mission St
  'BA:901401>SF:13209': 3, // Civic Center southbound to the 19 at 8th St & Market St
};

// Between BART and Muni Metro platforms inside a shared station: up or down a level, through
// both sets of fare gates.
const SHARED_STATION_SECONDS = 150;
// A walk board nearer From wins over a busier one if it has at least this share of its trips.
const BUSY_SHARE = 0.75;
// A street stop this close to the named stop is the same place, such as the stop across the
// street for the other direction. Half of SF's same-named stop pairs are 26 m apart, 80% within 50.
const SAME_CORNER_METERS = 50;

export type BoardPattern = { pattern: PatternRow; position: number; stop: StopRow };
export type FirstLegPattern = { pattern: PatternRow; origin: number; alight: number };

// How to reach one direction of a route the rider wants.
//   ride: take a first vehicle from the From stop, get off at one of `alights`, walk, and board
//     at `board`. Every first-leg pattern that reaches `board` pools in, wherever it lets the
//     rider off, and `alight` is the busiest one's stop (or its station). Connections name their
//     own stop when it differs.
//   walk: the route already stops at or near From, so the rider walks to `board` with no first
//     vehicle at all.
export type Link = {
  key: string;
  kind: 'ride' | 'walk';
  alight: StopRow;
  alights: StopRow[];
  board: StopRow;
  boards: StopRow[];
  routes: RouteRow[];
  direction: number | null;
  headsign: string;
  boardPatterns: BoardPattern[];
  firstLegs: FirstLegPattern[];
  walkMeters: number;
  // The longest walk, when riders getting off at different stops walk different distances.
  longestWalkMeters: number;
  defaultMinutes: number;
  // Fewest stops ridden on the first leg, for ordering.
  stopsRidden: number;
  // A walk longer than the usual range, kept only because nothing closer reaches the named stop.
  long?: boolean;
};

export type LinkSettings = {
  maxWalkMeters?: number;
  walkSpeed?: number;
  // At a shared station: ride from or catch BART's platforms, Muni Metro's, or both when empty.
  fromAgencies?: ReadonlySet<Agency>;
  toAgencies?: ReadonlySet<Agency>;
  // Patterns running around now (Schedule.runningPatterns). Without it, every pattern counts.
  running?: ReadonlySet<number>;
  // Stop ids the rider wants to reach after boarding. Only target patterns that go on to one
  // of them count, so the transfer point is chosen among routes that get there.
  reaches?: ReadonlySet<number>;
};

type BoardStop = { stop: StopRow; patterns: { pattern: PatternRow; position: number }[] };

// What the rider wants to board: a route in one direction, or every line leaving one rail
// platform, since riders transferring to BART care which way the train goes, not its color.
type Target = { routes: RouteRow[]; direction: number | null; headsign: string; stops: BoardStop[] };

type Feeder = { pattern: PatternRow; position: number; originStop: StopRow };

type Pick = {
  feeder: Feeder;
  position: number;
  alight: StopRow;
  board: BoardStop;
  meters: number;
  seconds: number;
  minutes: number;
};

type Context = {
  schedule: Schedule;
  maxWalk: number;
  speed: number | undefined;
  namedStop: boolean;
  splitSystems: boolean;
  // Where a vehicle boarded at `position` reaches the rider's destination: the position, or -1
  // when it never does. With no destination, where the pattern ends.
  ridesTo: (pattern: PatternRow, position: number) => number;
  hasDestination: boolean;
};

export function findLinks(schedule: Schedule, from: StopRow, to: { stop: StopRow } | { route: RouteRow }, settings: LinkSettings = {}): Link[] {
  const running = settings.running ?? null;
  const runs = (pattern: PatternRow) => !running || running.has(pattern.id);
  const reaches = settings.reaches ?? null;
  const ridesTo = (pattern: PatternRow, position: number) => {
    if (!reaches) return pattern.stops.length - 1;
    for (let at = position + 1; at < pattern.stops.length; at++) if (reaches.has(pattern.stops[at]!)) return at;
    return -1;
  };
  const getsThere = (pattern: PatternRow, position: number) => ridesTo(pattern, position) !== -1;
  const context: Context = {
    schedule,
    maxWalk: settings.maxWalkMeters ?? DEFAULT_MAX_WALK_METERS,
    speed: settings.walkSpeed,
    namedStop: 'stop' in to,
    // Riders choose BART or Muni Metro only where both leave from one station.
    splitSystems: schedule.sharedMembers.has(from.id),
    ridesTo,
    hasDestination: reaches !== null,
  };
  const origins = schedule.boardingStops(from, settings.fromAgencies ?? null);
  const runningTargets = (targets: Target[]) =>
    targets
      .map((target) => ({
        ...target,
        stops: target.stops
          .map((board) => ({ ...board, patterns: board.patterns.filter(({ pattern, position }) => runs(pattern) && getsThere(pattern, position)) }))
          .filter(({ patterns }) => patterns.length > 0),
      }))
      .filter(({ stops }) => stops.length > 0);
  const targets = runningTargets('stop' in to ? stopTargets(schedule, to.stop, settings.toAgencies ?? null) : routeTargets(schedule, to.route));
  const feeders: Feeder[] = origins.flatMap((originStop) =>
    schedule
      .boardingPatterns(originStop.id)
      .filter(({ pattern }) => runs(pattern))
      .map(({ pattern, position }) => ({ pattern, position, originStop })),
  );

  let links: Link[] = [];
  const walks = new Map<number, Link>();
  // Riding straight to a named stop, every route boarding at the same stop is one choice.
  const addWalk = (walk: Link) => {
    const same = context.namedStop ? walks.get(walk.board.id) : undefined;
    if (same) {
      same.routes = [...new Set([...same.routes, ...walk.routes])];
      same.boardPatterns = [...same.boardPatterns, ...walk.boardPatterns];
      same.direction = same.direction === walk.direction ? same.direction : null;
      same.headsign = 'stop' in to ? to.stop.name : same.headsign;
    } else {
      walks.set(walk.board.id, walk);
      links.push(walk);
    }
  };
  for (const target of targets) {
    const walk = walkLink(context, origins, target);
    if (walk === 'pointless') continue;
    if (!walk) {
      links.push(...rideLinks(context, feeders, target));
      continue;
    }
    addWalk(walk);
  }

  // A named stop allows a long walk so that a stop with no close transfer still finds one. When
  // some transfer point is within the usual range, the long walks only crowd it out.
  if (context.namedStop) {
    const usual = (link: Link) => link.kind === 'walk' || link.walkMeters <= (isStation(link.alight) || isStation(link.board) ? context.maxWalk * STATION_WALK_FACTOR : context.maxWalk);
    if (links.some(usual)) links = links.filter(usual);
    else for (const link of links) link.long = true;
  }
  // A named stop's routes can also take the rider there where the targets above leave them out:
  // to its corner, or to where they end. These are rides only, never transfers, and boarding
  // where the ride ends would be walking there. They come after the long walks are weighed, as a
  // rider catching something at the stop still needs a way to it. With the stop itself a walk
  // from From, such a ride is a stop or two of noise.
  const arrivals = 'stop' in to ? arrivalStops(schedule, to.stop, settings.toAgencies ?? null) : [];
  const walkable = arrivals.some((stop) =>
    origins.some((origin) => {
      const walk = walkBetween(schedule, origin, stop);
      return walk.meters <= (walk.involvesStation ? context.maxWalk * STATION_WALK_FACTOR : context.maxWalk);
    }),
  );
  if ('stop' in to && !walkable) {
    const exclude = new Set(arrivals.map(({ id }) => id));
    for (const target of runningTargets(cornerTargets(schedule, to.stop, settings.toAgencies ?? null))) {
      const walk = walkLink(context, origins, target, exclude);
      if (walk && walk !== 'pointless') addWalk(walk);
    }
  }
  return links.sort(
    (a, b) =>
      Number(a.kind === 'ride') - Number(b.kind === 'ride') ||
      a.stopsRidden - b.stopsRidden ||
      (a.routes[0]?.shortName ?? '').localeCompare(b.routes[0]?.shortName ?? '', 'en', { numeric: true }) ||
      (a.direction ?? 0) - (b.direction ?? 0),
  );
}

const isStation = (stop: StopRow) => stop.access === 'bart' || stop.access === 'subway' || stop.kind === 'station';

// The route already stops at or near From. For a named stop, that means any stop the route
// makes on the way to it, since the rider can board there and ride straight through. Of the
// stops in range, the nearest wins unless it carries under BUSY_SHARE of the busiest one's
// trips, so a quiet branch at the nearest pole does not hide the main service one pole over,
// and a busier stop a block away does not pull the rider off a stop nearly every vehicle
// makes. J chose this over always the busiest or always the nearest. Two boardings are ones nobody
// takes: where the vehicle then passes closer to From, which the rider could have boarded
// there, and where it ends within a walk of From. When every stop in range is one of those,
// the route goes nowhere useful from From in this direction, and riding to it elsewhere would
// make no more sense, so the answer is 'pointless' rather than no walk.
function walkLink(context: Context, origins: StopRow[], target: Target, exclude: ReadonlySet<number> | null = null): Link | 'pointless' | null {
  const { schedule, maxWalk } = context;
  // Each boarding with where the rider gets off: the destination, or else the named stop or the
  // end of the line. A destination past a named stop is where the ride really ends.
  const candidates = new Map<number, Map<string, { board: BoardPattern; getsOff: number }>>();
  for (const board of target.stops) {
    for (const { pattern, position } of board.patterns) {
      const last = context.namedStop ? position : pattern.stops.length - 2;
      for (let at = 0; at <= last; at++) {
        const ridesTo = context.ridesTo(pattern, at);
        // A stop past the destination is no place to board for it.
        if (ridesTo === -1) continue;
        if (exclude?.has(pattern.stops[at]!)) continue;
        const stop = schedule.stop(pattern.stops[at]!);
        const list = candidates.get(stop.id) ?? new Map<string, { board: BoardPattern; getsOff: number }>();
        list.set(`${pattern.id}|${at}`, { board: { pattern, position: at, stop }, getsOff: context.namedStop && !context.hasDestination ? position : ridesTo });
        candidates.set(stop.id, list);
      }
    }
  }
  const usable: { stop: StopRow; meters: number; trips: number; patterns: BoardPattern[] }[] = [];
  let inRange = false;
  for (const [id, byPattern] of candidates) {
    const stop = schedule.stop(id);
    let meters = Infinity;
    for (const origin of origins) {
      const walk = walkBetween(schedule, origin, stop);
      const limit = walk.involvesStation ? maxWalk * STATION_WALK_FACTOR : maxWalk;
      if (walk.meters <= limit) meters = Math.min(meters, walk.meters);
    }
    if (meters === Infinity) continue;
    inRange = true;
    const patterns = [...byPattern.values()]
      .filter(({ board: { pattern, position }, getsOff }) => !origins.some((origin) => endsNear(schedule, pattern, position, origin, maxWalk)) && !passesCloser(schedule, pattern, position, getsOff, origins, maxWalk))
      .map(({ board }) => board);
    if (patterns.length === 0) continue;
    usable.push({ stop, meters, trips: patterns.reduce((sum, { pattern }) => sum + pattern.trips, 0), patterns });
  }
  const busiest = Math.max(0, ...usable.map(({ trips }) => trips));
  const best = usable.filter(({ trips }) => trips >= busiest * BUSY_SHARE).sort((a, b) => a.meters - b.meters || b.trips - a.trips)[0];
  if (!best) return inRange ? 'pointless' : null;
  const seconds = transferSeconds({ exit: 'street', entry: best.stop.access, meters: best.meters, ...(context.speed ? { speed: context.speed } : {}) });
  return {
    key: `walk|${target.routes.map(({ id }) => id).join(',')}|${target.direction}|${best.stop.id}`,
    kind: 'walk',
    alight: schedule.stationOf(origins[0]!),
    alights: [],
    board: best.stop,
    boards: [best.stop],
    routes: target.routes,
    direction: target.direction,
    headsign: target.headsign,
    boardPatterns: best.patterns,
    firstLegs: [],
    walkMeters: Math.round(best.meters),
    longestWalkMeters: Math.round(best.meters),
    defaultMinutes: best.meters < 15 ? 0 : minimumMinutes(seconds),
    stopsRidden: 0,
  };
}

// One transfer point per target, and at a shared station one per system the rider can start
// on, since the page lets them pick BART or Muni Metro there. Each first-leg pattern offers its first good meeting
// place with the target. The board stop most first-leg trips can use wins, and every pattern
// that can reach that stop pools into it.
function rideLinks(context: Context, feeders: Feeder[], target: Target): Link[] {
  const { schedule } = context;
  const picks = feeders.flatMap((feeder) => {
    if (target.routes.some(({ id }) => id === feeder.pattern.route)) return [];
    const pick = firstContact(context, feeder, target, null);
    return pick ? [pick] : [];
  });
  const bySystem = new Map<string, Pick[]>();
  for (const pick of picks) {
    const system = context.splitSystems ? systemOf(schedule.route(pick.feeder.pattern.route)) : 'all';
    bySystem.set(system, [...(bySystem.get(system) ?? []), pick]);
  }

  const byBoard = new Map<number, Pick[]>();
  for (const list of bySystem.values()) {
    const weight = new Map<number, { trips: number; ridden: number }>();
    for (const pick of list) {
      const current = weight.get(pick.board.stop.id) ?? { trips: 0, ridden: Infinity };
      weight.set(pick.board.stop.id, { trips: current.trips + pick.feeder.pattern.trips, ridden: Math.min(current.ridden, pick.position - pick.feeder.position) });
    }
    const [primary] = [...weight].sort((a, b) => b[1].trips - a[1].trips || a[1].ridden - b[1].ridden)[0]!;
    for (const pick of list) {
      const onPrimary = pick.board.stop.id === primary ? pick : firstContact(context, pick.feeder, target, primary);
      if (onPrimary) byBoard.set(primary, [...(byBoard.get(primary) ?? []), onPrimary]);
    }
  }

  const links: Link[] = [];
  for (const pooled of byBoard.values()) {
    // A named stop's long walks count only when nothing reaches it within the usual range.
    const usual = pooled.filter(({ meters, alight, board }) => meters <= usualRange(context, alight, board.stop));
    const candidates = context.namedStop && usual.length > 0 ? usual : pooled;
    // One window has to fit everyone, so a pick needing much longer than the quickest is left
    // out rather than widening the window for the rest.
    const quickest = Math.min(...candidates.map(({ minutes }) => minutes));
    const kept = candidates.filter(({ minutes }) => minutes <= quickest + 2);
    if (kept.length > 0) links.push(addPicks(schedule, kept, target));
  }
  return links;
}

const usualRange = (context: Context, alight: StopRow, board: StopRow) => (isStation(alight) || isStation(board) ? context.maxWalk * STATION_WALK_FACTOR : context.maxWalk);

// The systems a rider might start on at a shared station: BART, an agency's rail, or its buses.
function systemOf(route: RouteRow) {
  if (route.agency === 'BA') return 'bart';
  if (route.mode === 'light-rail' || route.mode === 'streetcar') return `${route.agency}:rail`;
  return `${route.agency}:road`;
}

function addPicks(schedule: Schedule, picks: Pick[], target: Target): Link {
  const board = picks[0]!.board.stop;
  const boardPatterns = new Map<string, BoardPattern>();
  for (const pick of picks) {
    for (const { pattern, position } of pick.board.patterns) boardPatterns.set(`${pattern.id}|${position}`, { pattern, position, stop: pick.board.stop });
  }
  const firstLegs = new Map<string, FirstLegPattern>();
  for (const pick of picks) firstLegs.set(`${pick.feeder.pattern.id}|${pick.feeder.position}`, { pattern: pick.feeder.pattern, origin: pick.feeder.position, alight: pick.position });
  const alights = [...new Set(picks.map(({ alight }) => alight))];
  // Getting off in one station, on any of its platforms, is getting off at the station.
  const stations = new Set(alights.map((stop) => schedule.stationOf(stop).id));
  const busiest = [...picks].sort((a, b) => b.feeder.pattern.trips - a.feeder.pattern.trips)[0]!;
  return {
    key: `ride|${target.routes.map(({ id }) => id).join(',')}|${target.direction}|${board.id}`,
    kind: 'ride',
    alight: stations.size === 1 ? schedule.stationOf(alights[0]!) : busiest.alight,
    alights,
    board,
    boards: [board],
    routes: target.routes,
    direction: target.direction,
    headsign: target.headsign,
    boardPatterns: [...boardPatterns.values()],
    firstLegs: [...firstLegs.values()],
    walkMeters: Math.min(...picks.map(({ meters }) => Math.round(meters))),
    longestWalkMeters: Math.max(...picks.map(({ meters }) => Math.round(meters))),
    defaultMinutes: Math.max(...picks.map(({ minutes }) => minutes)),
    stopsRidden: Math.min(...picks.map(({ position, feeder }) => position - feeder.position)),
  };
}

// Along one first-leg pattern after the From stop, the first run of stops within walking range
// of the target gives the transfer point. Within that run, the earliest stop whose transfer is
// within a minute of the quickest: riding further for a slightly shorter walk is not worth it.
// A board stop only counts where the target still has somewhere to go, and does not double
// back over stops the rider just rode past, where they could have caught it instead.
function firstContact(context: Context, feeder: Feeder, target: Target, onlyBoard: number | null): Pick | null {
  const { schedule, maxWalk, namedStop, speed } = context;
  const pattern = feeder.pattern;
  const boards = onlyBoard === null ? target.stops : target.stops.filter(({ stop }) => stop.id === onlyBoard);
  // Riding only makes sense if it brings the rider closer than they started.
  const startingDistance = new Map(boards.map((board) => [board.stop.id, walkBetween(schedule, feeder.originStop, board.stop).meters]));
  const run: Pick[] = [];
  for (let position = feeder.position + 1; position < pattern.stops.length; position++) {
    const alight = schedule.stop(pattern.stops[position]!);
    const ridden = pattern.stops.slice(feeder.position, position).map((id) => schedule.stop(id));
    let best: Pick | null = null;
    for (const board of boards) {
      const walk = walkBetween(schedule, alight, board.stop);
      const limit = namedStop ? NAMED_STOP_MAX_WALK_METERS : walk.involvesStation ? maxWalk * STATION_WALK_FACTOR : maxWalk;
      if (walk.meters > limit || walk.meters >= (startingDistance.get(board.stop.id) ?? Infinity)) continue;
      const seconds = changeSeconds(walk, alight, board.stop, speed);
      if (best && seconds >= best.seconds) continue;
      const patterns = board.patterns.filter(
        ({ pattern: onward, position: at }) =>
          !endsNear(schedule, onward, at, alight, maxWalk) && !doublesBack(schedule, onward, at, ridden, maxWalk) && !returnsToAlight(schedule, onward, at, alight, walk.meters),
      );
      if (patterns.length === 0) continue;
      const calibrated = calibratedMinutes(alight, board.stop);
      best = { feeder, position, alight, board: { stop: board.stop, patterns }, meters: walk.meters, seconds, minutes: calibrated ?? minimumMinutes(seconds) };
    }
    if (best) run.push(best);
    else if (run.length > 0) break;
  }
  if (run.length === 0) return null;
  const quickest = Math.min(...run.map(({ seconds }) => seconds));
  return run.find(({ seconds }) => seconds <= quickest + 60)!;
}

// The target pattern ends within walking range of where the rider got off, so boarding it
// would be a ride to somewhere they could walk.
function endsNear(schedule: Schedule, pattern: PatternRow, position: number, alight: StopRow, maxWalk: number) {
  for (let at = position + 1; at < pattern.stops.length; at++) {
    if (distanceMeters(schedule.stop(pattern.stops[at]!), alight) > maxWalk) return false;
  }
  return true;
}

// Whether a vehicle boarded at `position` stops within half a walk of From, and closer to it than
// where it was boarded, before the rider gets off at `last`. A loop that passes From only after
// the rider's destination does not count.
function passesCloser(schedule: Schedule, pattern: PatternRow, position: number, last: number, origins: StopRow[], maxWalk: number) {
  const away = (at: number) => Math.min(...origins.map((origin) => distanceMeters(schedule.stop(pattern.stops[at]!), origin)));
  const boarded = away(position);
  for (let at = position + 1; at <= last; at++) {
    const later = away(at);
    if (later <= maxWalk / 2 && later < boarded) return true;
  }
  return false;
}

// The target pattern, after boarding, comes back near From or a stop the rider already rode
// through, where they could have boarded it instead.
function doublesBack(schedule: Schedule, pattern: PatternRow, position: number, ridden: StopRow[], maxWalk: number) {
  if (ridden.length === 0) return false;
  for (let at = position + 1; at < pattern.stops.length; at++) {
    const stop = schedule.stop(pattern.stops[at]!);
    if (ridden.some((passed) => distanceMeters(stop, passed) <= maxWalk / 2)) return true;
  }
  return false;
}

// The target, after boarding, comes back much closer to where the rider got off than the walk
// to board it: they walked away from a place it was about to pass.
function returnsToAlight(schedule: Schedule, pattern: PatternRow, position: number, alight: StopRow, walkMeters: number) {
  if (walkMeters < 100) return false;
  for (let at = position + 1; at < pattern.stops.length; at++) {
    if (distanceMeters(schedule.stop(pattern.stops[at]!), alight) < walkMeters / 2) return true;
  }
  return false;
}

// Distance runs from the nearest station entrance when either end is a BART stop or a shared
// station's Muni Metro platform, since that is where the walk starts. Two BART platforms in one
// station use BART's own transfer time.
export function walkBetween(schedule: Schedule, alight: StopRow, board: StopRow) {
  const involvesStation = isStation(alight) || isStation(board);
  if (alight.id === board.id) return { meters: 0, involvesStation, fixedSeconds: undefined };
  if (alight.parent !== null && alight.parent === board.parent && alight.access === 'bart') {
    const listed = schedule.transfers.get(`${alight.id}>${board.id}`);
    return { meters: distanceMeters(alight, board), involvesStation, fixedSeconds: listed ?? 60 };
  }
  const sharedAlight = schedule.sharedStation.get(alight.id);
  if (sharedAlight !== undefined && sharedAlight === schedule.sharedStation.get(board.id)) {
    return { meters: distanceMeters(alight, board), involvesStation, fixedSeconds: SHARED_STATION_SECONDS };
  }
  let meters = Infinity;
  for (const a of walkPoints(schedule, alight)) for (const b of walkPoints(schedule, board)) meters = Math.min(meters, distanceMeters(a, b));
  return { meters, involvesStation, fixedSeconds: undefined };
}

// Where a walk to or from a stop starts: the station's entrances for a BART stop or a shared
// station's Muni Metro platform, or else the stop itself.
export function walkPoints(schedule: Schedule, stop: StopRow) {
  const station = schedule.sharedStation.get(stop.id) ?? (stop.access === 'bart' ? (stop.kind === 'station' ? stop.id : stop.parent) : null);
  if (station === null) return [stop];
  const entrances = schedule.entrances.get(station) ?? [];
  return entrances.length > 0 ? entrances : [stop];
}

// How long changing vehicles takes on a walk from walkBetween: a station's own time between its
// platforms, or else getting off one, walking, and getting on the other.
export function changeSeconds(walk: ReturnType<typeof walkBetween>, alight: StopRow, board: StopRow, speed?: number) {
  const { seconds, meters } = changeParts(walk, alight, board);
  return seconds + walkSeconds(meters, speed);
}

// changeSeconds as the seconds it takes at any pace and the meters walked at the rider's own.
export function changeParts(walk: ReturnType<typeof walkBetween>, alight: StopRow, board: StopRow) {
  if (walk.fixedSeconds !== undefined) return { seconds: walk.fixedSeconds, meters: 0 };
  return { seconds: paceFreeSeconds({ exit: alight.access, entry: board.access, meters: walk.meters }), meters: walk.meters };
}

// The minutes J timed for this change, when he has.
export const calibratedMinutes = (alight: StopRow, board: StopRow): number | undefined => CALIBRATED_MINUTES[`${stopKeyOf(alight)}>${stopKeyOf(board)}`];

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
  for (const target of targets.values()) target.headsign = headsignFor(schedule, target);
  return [...targets.values()];
}

// Where a ride to a named stop can end: at the stop (any of a station's platforms), or at a
// street stop on its corner.
export function arrivalStops(schedule: Schedule, stop: StopRow, agencies: ReadonlySet<Agency> | null = null) {
  const own = schedule.boardingStops(stop, agencies);
  if (stop.access !== 'street' || stop.kind === 'station') return own;
  const corner = [...schedule.stops.values()].filter(
    (other) => other.id !== stop.id && other.access === 'street' && other.kind !== 'station' && schedule.patternsByStop.has(other.id) && distanceMeters(stop, other) <= SAME_CORNER_METERS,
  );
  return [...own, ...corner];
}

// Each direction of a named stop's routes, as far as a stop on its corner, or as far as the stop
// itself where the route ends there, which stopTargets leaves out as no place to board. Such as
// the 48 at 26th St & De Haro St, which stops there westbound, and eastbound across the street.
// Only the stop's own routes count, so another route passing its corner does not stand in for the
// one the rider named the stop for. At a rail platform, every line arriving there is one target,
// as in stopTargets.
function cornerTargets(schedule: Schedule, stop: StopRow, agencies: ReadonlySet<Agency> | null): Target[] {
  const own = new Set(schedule.boardingStops(stop, agencies).map(({ id }) => id));
  const arrivals = new Set(arrivalStops(schedule, stop, agencies).map(({ id }) => id));
  const routes = new Set([...own].flatMap((id) => (schedule.patternsByStop.get(id) ?? []).map(({ pattern }) => pattern.route)));
  const targets = new Map<string, Target>();
  for (const routeId of routes) {
    for (const pattern of schedule.patternsByRoute.get(routeId) ?? []) {
      for (const [position, id] of pattern.stops.entries()) {
        if (!arrivals.has(id) || (own.has(id) && position < pattern.stops.length - 1)) continue;
        const route = schedule.route(routeId);
        const byPlatform = route.agency === 'BA' || schedule.stop(id).access === 'subway';
        const key = byPlatform ? `platform|${id}` : `${routeId}|${pattern.direction}`;
        let target = targets.get(key);
        if (!target) targets.set(key, (target = { routes: [], direction: pattern.direction, headsign: '', stops: [] }));
        if (!target.routes.includes(route)) target.routes.push(route);
        let board = target.stops.find((entry) => entry.stop.id === id);
        if (!board) target.stops.push((board = { stop: schedule.stop(id), patterns: [] }));
        board.patterns.push({ pattern, position });
      }
    }
  }
  for (const target of targets.values()) target.headsign = headsignFor(schedule, target);
  return [...targets.values()];
}

// Each direction of a route, with every stop it boards at. BART runs each line as two routes,
// one per direction, so asking for one asks for both.
function routeTargets(schedule: Schedule, route: RouteRow): Target[] {
  const members = route.agency === 'BA' ? bartSiblings(schedule, route) : [route];
  const byDirection = new Map<string, { member: RouteRow; direction: number | null; stops: Map<number, BoardStop> }>();
  for (const member of members) {
    for (const pattern of schedule.patternsByRoute.get(member.id) ?? []) {
      const key = `${member.id}|${pattern.direction}`;
      let entry = byDirection.get(key);
      if (!entry) byDirection.set(key, (entry = { member, direction: pattern.direction, stops: new Map() }));
      for (const [position, stopId] of pattern.stops.entries()) {
        if (position >= pattern.stops.length - 1) continue;
        let board = entry.stops.get(stopId);
        if (!board) entry.stops.set(stopId, (board = { stop: schedule.stop(stopId), patterns: [] }));
        board.patterns.push({ pattern, position });
      }
    }
  }
  return [...byDirection.values()].map(({ member, direction, stops }) => {
    const target: Target = { routes: [member], direction, headsign: '', stops: [...stops.values()] };
    target.headsign = headsignFor(schedule, target);
    return target;
  });
}

export function bartSiblings(schedule: Schedule, route: RouteRow) {
  const line = route.shortName.replace(/-[NS]$/, '');
  return [...schedule.routes.values()].filter((other) => other.agency === 'BA' && other.shortName.replace(/-[NS]$/, '') === line);
}

const headsignFor = (schedule: Schedule, target: Target) => rankedHeading(schedule, target.stops.flatMap(({ patterns }) => patterns.map(({ pattern }) => pattern)), target.routes);

// Where a group's vehicles are going, as every page names a direction: the busiest place for one
// route, and up to four for BART or a platform's lines together, which head several ways. A
// pattern listed once for each stop it boards at counts once for each.
export function rankedHeading(schedule: Schedule, patterns: PatternRow[], routes: RouteRow[]) {
  const ranked = rankedHeadings(schedule, patterns);
  if (routes.length === 1 && routes[0]!.agency !== 'BA') return ranked[0] ?? '';
  return ranked.slice(0, 4).join(', ');
}

// Each place the patterns go, busiest first by trips.
export function rankedHeadings(schedule: Schedule, patterns: PatternRow[]) {
  const counts = new Map<string, number>();
  for (const pattern of patterns) {
    const name = headingOf(schedule, pattern);
    counts.set(name, (counts.get(name) ?? 0) + pattern.trips);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

// Where one pattern, or one trip with its own headsign, is going, as riders read it. BART's own
// headsigns name stations behind the rider ("SFO / SF / Antioch" on every northbound Yellow
// train), so BART uses the line's last stop. Ferries publish no headsign, so they use the last
// stop too. "Balboa Park via S.F. State" is still Balboa Park.
export function headingOf(schedule: Schedule, pattern: PatternRow, headsign = pattern.headsign) {
  const route = schedule.route(pattern.route);
  const last = schedule.stop(pattern.stops.at(-1)!);
  const name = route.agency === 'BA' ? bartPlace(schedule.stationOf(last).name) : headsign.trim() ? headsign : last.name;
  return name.replace(/`/g, '’').replace(/ via .*$/, '');
}

// BART station names as a destination: "SFO", "Oakland Airport", "Millbrae", "Berryessa".
function bartPlace(name: string) {
  if (/^San Francisco International Airport/.test(name)) return 'SFO';
  const place = name.replace(/ International Airport$/, ' Airport').replace(/\s*\(.*\)$/, '').replace(/\s*\/\s*/g, '/');
  return place === 'Berryessa/North San Jose' ? 'Berryessa' : place;
}
