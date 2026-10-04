import type { Connection, Departure, Group, TripResponse } from '../../../shared/api.ts';
import { minutesUntil } from '../format.ts';
import { chipLabel } from '../view.ts';
import { resolveRouteColor, routeColor } from './color.ts';

// A transfer point's identity, for the rider's on and off filter.
export const pointId = (group: Group) => `${group.alight}>${group.board}>${group.direction ?? ''}>${group.routes.join('+')}`;

// Shared by every card on the results screen.
export type CardContext = {
  data: TripResponse;
  now: number;
  scaleMinutes: number;
  // Unix seconds to a position on the shared time scale, 0 to 100.
  pct: (unixSeconds: number) => number;
  destinationName: string | null;
  // The To stop's name, for walk groups that ride straight to it.
  toName: string | null;
  showHidden: boolean;
  colorOf: (routeKey: string) => string;
};

const MAX_DEPARTURES = 3;

// The server's answer, trimmed as the clock runs between refreshes: vehicles that have left
// drop off, a departure with no one left to connect drops off, and canceled departures keep
// their place only between departures still shown.
export function visibleDepartures(group: Group, now: number, showHidden: boolean): Departure[] {
  const shown: Departure[] = [];
  for (const departure of group.departures) {
    if (departure.at * 1000 < now) continue;
    if (departure.canceled) {
      shown.push(departure);
      continue;
    }
    const connections = departure.connections.filter((connection) => connection.departs * 1000 >= now && (showHidden || !connection.hidden));
    // A walk group has no first vehicles: each departure stands on its own.
    if (connections.length === 0 && group.kind !== 'walk') continue;
    shown.push({ ...departure, connections });
    if (shown.filter(({ canceled }) => !canceled).length === MAX_DEPARTURES) break;
  }
  while (shown.at(-1)?.canceled) shown.pop();
  while (shown[0]?.canceled) shown.shift();
  return shown;
}

// Within a minute of the minimum is tight, as the design specifies.
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
