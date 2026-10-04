import type { Connection, Departure, Group, TripResponse } from '../../../shared/api.ts';
import { minutesUntil } from '../format.ts';
import { chipLabel } from '../view.ts';
import { resolveRouteColor, routeColor } from './color.ts';

// A transfer point's identity, for the rider's on and off filter.
export const pointId = (group: Group) => `${group.alight}>${group.board}>${group.direction ?? ''}`;

// Shared by every card on the results screen.
export type CardContext = {
  data: TripResponse;
  now: number;
  scaleMinutes: number;
  // Unix seconds to a position on the shared time scale, 0 to 100.
  pct: (unixSeconds: number) => number;
  destinationName: string | null;
  showHidden: boolean;
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
    if (connections.length === 0) continue;
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
    for (const departure of group.departures) {
      if (departure.canceled) continue;
      const end = departure.destination ?? departure.at + 8 * 60;
      span = Math.max(span, minutesUntil(end, now) + 1);
    }
  }
  return Math.ceil(span / 15) * 15;
}

// Colors for a group: first-leg routes keep theirs, and a second-leg bus yields if it clashes.
export function groupColors(group: Group, data: TripResponse) {
  const firstColors = group.firstRoutes.map((key) => data.routes[key]).filter((route) => route !== undefined).map(routeColor);
  return (routeKey: string) => {
    const route = data.routes[routeKey];
    if (!route) return '#55575a';
    const color = routeColor(route);
    return route.agency === 'BA' || group.firstRoutes.includes(routeKey) ? color : resolveRouteColor(color, firstColors);
  };
}

// "train" when every first vehicle is BART, the route when there is one, else "vehicle".
export function firstWord(group: Group, data: TripResponse) {
  const routes = group.firstRoutes.map((key) => data.routes[key]).filter((route) => route !== undefined);
  if (routes.length > 0 && routes.every(({ agency }) => agency === 'BA')) return 'train';
  return routes.length === 1 ? chipLabel(routes[0]!) : 'vehicle';
}
