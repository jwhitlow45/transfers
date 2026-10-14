import type { Connection, Departure, Group, TripResponse } from '../../../shared/api.ts';
import { minutesUntil } from '../format.ts';
import { chipLabel } from '../view.ts';
import { resolveRouteColor, routeColor } from './color.ts';
import type { Pin } from '../storage.ts';
import type { StationOutages } from './outages.ts';

// A transfer point's identity, for the rider's on and off filter. On a stop's trips tab, the
// server's, which holds as the routes running there change.
export const pointId = (group: Group) => group.key ?? `${group.alight}>${group.board}>${group.direction ?? ''}>${group.routes.join('+')}`;

// Shared by every card on the results screen.
export type CardContext = {
  data: TripResponse;
  now: number;
  scaleMinutes: number;
  // Unix seconds to a position on the shared time scale, 0 to 100.
  pct: (unixSeconds: number) => number;
  // The search's destination stop key and name, when it has one: the stop in To on its trips tab,
  // or else the one the rider set.
  destination: string | undefined;
  destinationName: string | null;
  // The To stop's name, for walk groups that ride straight to it.
  toName: string | null;
  // Each one's short name, for when the card's arrival line would wrap (see Stop.shortName).
  destinationShort: string | null;
  toShort: string | null;
  // The trips tab of a stop in To, which takes it as where the rider is going.
  going: boolean;
  showHidden: boolean;
  colorOf: (routeKey: string) => string;
  // The trip pinned to these results, and pinning one, or unpinning with null.
  pin: Pin | null;
  onPin: (pin: Pin | null) => void;
  // The card that says how to pin, on a rider's first visits, by hintKey.
  pinHint: string | null;
  // Opens what BART says about a station's elevator or escalator outages.
  showOutages: (outages: StationOutages) => void;
};

// A departure's card: one trip can appear in two groups, such as BART's and Muni Metro's at a
// shared station.
export const hintKey = (group: Group, trip: string | undefined) => (trip === undefined ? null : `${pointId(group)}|${trip}`);

// Unix seconds to a place on the shared time scale, 0 to 100, from now to `scaleMinutes` ahead.
export const timeScale = (now: number, scaleMinutes: number) => (unixSeconds: number) => Math.max(0, Math.min(100, ((unixSeconds * 1000 - now) / 60_000 / scaleMinutes) * 100));

const MAX_DEPARTURES = 3;

// When a row's ride ends, after which no one is on it: the second vehicle reaching the
// destination, or with none, leaving where the rider boards it.
const rideEnd = (departure: Departure) => Math.max(departure.at, departure.destination ?? 0);

// Whether a departure's card has left entirely: its vehicle has left where the rider boards it,
// or every vehicle that makes it has left From.
export const cardLeft = (group: Group, departure: Departure, now: number) =>
  departure.at * 1000 < now || (group.kind !== 'walk' && departure.connections.length > 0 && departure.connections.every(({ departs }) => departs * 1000 < now));

// The server's answer, trimmed as the clock runs between refreshes: up to three departures the
// rider can still catch, each with the vehicles that still make it, and canceled departures in
// their place between them. With `underWay`, rows the rider may be on come too: those whose
// first vehicle, or for a walk group the departure itself, has left, until their ride ends.
export function visibleDepartures(group: Group, now: number, showHidden: boolean, underWay = false): Departure[] {
  const shown: Departure[] = [];
  let catchable = 0;
  // A walk group has no first vehicles: each departure stands on its own.
  const walk = group.kind === 'walk';
  for (const departure of group.departures) {
    const left = departure.at * 1000 < now;
    if (left && !(underWay && rideEnd(departure) * 1000 >= now)) continue;
    if (departure.canceled) {
      if (!left && catchable < MAX_DEPARTURES) shown.push(departure);
      continue;
    }
    const counted = (connection: Connection) => showHidden || !connection.hidden;
    const ahead = departure.connections.filter((connection) => connection.departs * 1000 >= now && counted(connection));
    const canCatch = !left && (walk || ahead.length > 0) && catchable < MAX_DEPARTURES;
    if (walk) {
      if (canCatch || left) shown.push(departure);
      if (canCatch) catchable++;
      continue;
    }
    const gone = underWay ? departure.connections.filter((connection) => connection.departs * 1000 < now && counted(connection)) : [];
    const connections = [...gone, ...(canCatch ? ahead : [])];
    if (connections.length === 0) continue;
    if (canCatch) catchable++;
    shown.push({ ...departure, connections });
  }
  while (shown.at(-1)?.canceled) shown.pop();
  while (shown[0]?.canceled) shown.shift();
  return shown;
}

// Groups with nothing the rider can catch, and no wider window that would find something, which
// route filters may be why.
export const nothingCatchable = (groups: Group[], now: number, showHidden: boolean) =>
  groups.length > 0 && groups.every((group) => !group.widen && visibleDepartures(group, now, showHidden).every(({ canceled }) => canceled));

// On a stop's trips tab, ways with nothing running on them that the rider could catch, whatever
// their window or hiding (see Group): no way there now, as at 2 AM.
export const nothingRuns = (groups: Group[]) => groups.length > 0 && groups.every(({ idle }) => idle);

// Within a minute of the minimum is tight, as the design specifies.
// A ride straight to the named To stop: a walk group whose departures say when they get there.
// With a destination set, those times are the destination's instead.
export const ridesStraightTo = (group: Group, destination: string | undefined) =>
  group.kind === 'walk' && !destination && group.departures.some((departure) => departure.destination !== undefined);

// Groups by their soonest departure, with rides straight to To after the transfers there, which a
// rider may have named To to catch (J, 2026-10-08). Going to a stop, by the soonest there of the
// trips the rider can still make (J, 2026-10-12). A group with nothing that gets there goes last.
export function orderGroups(groups: Group[], now: number, showHidden: boolean, destination: string | undefined, going: boolean) {
  const catchable = (group: Group) => visibleDepartures(group, now, showHidden).filter(({ canceled }) => !canceled);
  const firstAt = (group: Group) => catchable(group)[0]?.at ?? Infinity;
  if (!going) return [...groups].sort((a, b) => Number(ridesStraightTo(a, destination)) - Number(ridesStraightTo(b, destination)) || firstAt(a) - firstAt(b));
  const soonest = (group: Group) => Math.min(Infinity, ...catchable(group).map(({ destination: there }) => there ?? Infinity));
  return [...groups].sort((a, b) => soonest(a) - soonest(b) || firstAt(a) - firstAt(b));
}

// The shortest trip a departure allows to the destination, in seconds, from setting off: from the
// last vehicle from From that still makes it, or with none, from walking `walkSeconds` to where
// the rider boards it. Null without a time there.
export function tripSeconds(departure: Departure, walk: boolean, walkSeconds: number, now: number) {
  if (departure.destination === undefined) return null;
  if (walk) return departure.destination - departure.at + walkSeconds;
  const start = tripStart(departure, now);
  return start ? departure.destination - start.departs : null;
}

// The vehicle from From that a trip's length counts from (see tripSeconds).
export function tripStart(departure: Departure, now: number) {
  const ahead = departure.connections.filter(({ departs }) => departs * 1000 >= now);
  return (ahead.length > 0 ? ahead : departure.connections).reduce<Connection | null>((latest, connection) => (!latest || connection.departs > latest.departs ? connection : latest), null);
}

// The vehicles that make a departure, in the order its card lists them: by when they leave, or
// going to a stop, by least travel time, which for one vehicle getting there is the latest to
// leave (J, 2026-10-12).
export const listedConnections = (departure: Departure, going: boolean) => (going ? [...departure.connections].sort((a, b) => b.departs - a.departs || a.arrives - b.arrives) : departure.connections);

export const isTight = (connection: Connection, min: number) => !connection.hidden && connection.transfer <= min + 1;

// One time scale for every card on the screen, so bars compare: at least an hour, in steps of 15 minutes.
export function scaleFor(groups: Group[], now: number) {
  let span = 60;
  for (const group of groups) {
    if (group.kind === 'walk') continue;
    for (const departure of group.departures) {
      if (departure.canceled) continue;
      const end = departure.destination ?? departure.at + 8 * 60;
      span = Math.max(span, minutesUntil(end, now) + 1);
    }
  }
  return Math.ceil(span / 15) * 15;
}

// Colors for the whole page, so a route keeps one color in every group and the header. First-leg
// routes keep theirs, and a second-leg route yields if it clashes with any of them. BART never yields.
export function pageColors(groups: Group[], data: TripResponse) {
  const firstKeys = new Set(groups.flatMap(({ firstRoutes }) => firstRoutes));
  const firstColors = [...firstKeys].map((key) => data.routes[key]).filter((route) => route !== undefined).map(routeColor);
  const cache = new Map<string, string>();
  return (routeKey: string) => {
    let color = cache.get(routeKey);
    if (color) return color;
    const route = data.routes[routeKey];
    if (!route) return '#55575a';
    color = route.agency === 'BA' || firstKeys.has(routeKey) ? routeColor(route) : resolveRouteColor(routeColor(route), firstColors);
    cache.set(routeKey, color);
    return color;
  };
}

// "train" when every first vehicle is BART, the route when there is one, else "vehicle".
export function firstWord(group: Group, data: TripResponse) {
  const routes = group.firstRoutes.map((key) => data.routes[key]).filter((route) => route !== undefined);
  if (routes.length === 1 && routes[0]!.agency !== 'BA') return chipLabel(routes[0]!);
  return firstNoun(group, data)[0];
}

// When one route shows up in two or more directions (both ways on the 48), the rider picks one.
// Each option lists the transfer points it keeps. The choice is stored as the other options'
// points in the search's off list, the same list trip settings edits.
export type DirectionOption = { key: string; headsign: string; ids: string[] };
export type DirectionChoice = { routes: string[]; options: DirectionOption[]; selected: string | null };

// BART runs each line as two routes, one per direction, so groups are compared by the line
// names riders know: both of BART's platforms are the same family, and so are Muni Metro's.
export function directionChoices(groups: Group[], off: string[], data: TripResponse): DirectionChoice[] {
  const byRoutes = new Map<string, Map<string, DirectionOption>>();
  const routesOf = new Map<string, string[]>();
  for (const group of groups) {
    const routesKey = [...new Set(group.routes.map((key) => data.routes[key]?.name ?? key))].sort().join(',');
    routesOf.set(routesKey, [...new Set([...(routesOf.get(routesKey) ?? []), ...group.routes])]);
    // One option per direction, however many places the route can be caught going that way.
    const directionKey = group.direction === null ? group.headsign : String(group.direction);
    let options = byRoutes.get(routesKey);
    if (!options) byRoutes.set(routesKey, (options = new Map()));
    const option = options.get(directionKey) ?? { key: directionKey, headsign: group.headsign, ids: [] };
    option.ids.push(pointId(group));
    options.set(directionKey, option);
  }
  const choices: DirectionChoice[] = [];
  for (const [routesKey, options] of byRoutes) {
    if (options.size < 2) continue;
    const list = [...options.values()];
    const shown = list.filter(({ ids }) => ids.some((id) => !off.includes(id)));
    choices.push({ routes: routesOf.get(routesKey) ?? [], options: list, selected: shown.length === 1 ? shown[0]!.key : null });
  }
  return choices;
}

// The off list after picking an option, or every direction when `key` is null.
export function chooseDirection(choice: DirectionChoice, key: string | null, off: string[]) {
  const ids = new Set(choice.options.flatMap(({ ids }) => ids));
  const kept = off.filter((id) => !ids.has(id));
  if (key === null) return kept;
  return [...kept, ...choice.options.filter((option) => option.key !== key).flatMap(({ ids }) => ids)];
}

// What to call the first vehicles in a summary line.
export function firstNoun(group: Group, data: TripResponse) {
  const modes = [...new Set(group.firstRoutes.map((key) => data.routes[key]?.mode))];
  const all = (...kinds: (string | undefined)[]) => modes.length > 0 && modes.every((mode) => kinds.includes(mode));
  if (all('cable-car')) return ['cable car', 'cable cars'] as const;
  if (all('streetcar')) return ['streetcar', 'streetcars'] as const;
  if (all('bart', 'light-rail', 'streetcar')) return ['train', 'trains'] as const;
  if (all('bus', 'trolleybus')) return ['bus', 'buses'] as const;
  return ['vehicle', 'vehicles'] as const;
}

// A set of routes as a phrase: "BART", "Muni Metro", "BART or Muni Metro", or "the 48".
export function familyName(routeKeys: string[], data: TripResponse) {
  const routes = routeKeys.map((key) => data.routes[key]).filter((route) => route !== undefined);
  const bart = routes.some(({ agency }) => agency === 'BA');
  const metro = routes.length > 1 && routes.filter(({ agency }) => agency !== 'BA').every(({ mode }) => mode === 'light-rail');
  if (bart && routes.every(({ agency }) => agency === 'BA')) return 'BART';
  if (bart && metro) return 'BART or Muni Metro';
  if (metro) return 'Muni Metro';
  return `the ${[...new Set(routes.map(chipLabel))].join(' or ')}`;
}

// How a group says where to get off: "Get off BART at", "Get off Muni Metro at", or plain
// "Get off at" when either system gets there.
export function alightVerb(group: Group, data: TripResponse) {
  const routes = group.firstRoutes.map((key) => data.routes[key]).filter((route) => route !== undefined);
  if (routes.length > 0 && routes.every(({ agency }) => agency === 'BA')) return 'Get off BART at';
  if (routes.length > 0 && routes.every(({ mode }) => mode === 'light-rail')) return 'Get off Muni Metro at';
  return 'Get off at';
}
