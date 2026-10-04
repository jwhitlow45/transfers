import type { Route, TripResponse } from '../../../shared/api.ts';
import { clock } from '../format.ts';
import type { Search } from '../storage.ts';
import { type Status, chipLabel, shortStopName, statusOf, windowText } from '../view.ts';
import { pageColors, pointId, visibleDepartures } from './results.ts';

// One vehicle of the next connection, for a saved card to draw as the results page does.
export type Leg = { route: Route | undefined; at: number; status: Status };
// The soonest connection: minutes until it leaves, its vehicles, whether the route already stops
// at From so there is no transfer, and the same in one line for screen readers.
export type NextConnection = { minutes: number; legs: Leg[]; walk: boolean; line: string };

// The parts of a trip that headers, saved cards, and recent searches all describe.
export function summarize(search: Search, data: TripResponse | null, now: number) {
  const groups = (data?.groups ?? []).filter((group) => !search.off?.includes(pointId(group)));
  const from = data ? shortStopName(data.stops[data.from], search.fromLabel) : search.fromLabel;
  const alights = [...new Set(groups.filter(({ kind }) => kind !== 'walk').map(({ alight }) => alight))];
  // With several places to get off, each group says its own, and the header names none.
  const via = alights.length === 1 ? shortStopName(data?.stops[alights[0]!], '') : null;
  const toRoute = data && 'route' in data.to ? data.routes[data.to.route] : undefined;
  const routeSets = [...new Set(groups.map(({ routes }) => routes.join(',')))];
  const onlyRoute = routeSets.length === 1 && groups[0]?.routes.length === 1 ? data?.routes[groups[0].routes[0]!] : undefined;
  const toRouteShown = toRoute ?? onlyRoute;
  const to = toRouteShown ? chipLabel(toRouteShown) : search.toLabel;
  // The window the page talks about: the rider's own, or the first transfer point's that has
  // something to catch. The header, the bottom bar, and the sheet all show this one.
  const rides = groups.filter(({ kind }) => kind !== 'walk');
  const lead = rides.find((group) => visibleDepartures(group, now, false).some(({ canceled }) => !canceled)) ?? rides[0];
  const window = lead ? { min: search.min ?? lead.window.min, max: search.max ?? lead.window.max } : null;

  // The soonest first vehicle that makes a connection, with both legs and their lateness.
  let next: NextConnection | null = null;
  let soonest = Infinity;
  for (const group of groups) {
    for (const departure of visibleDepartures(group, now, false)) {
      if (departure.canceled) continue;
      for (const connection of departure.connections) {
        if (connection.departs >= soonest) continue;
        soonest = connection.departs;
        const first = data!.routes[connection.route];
        const second = data!.routes[departure.route];
        const firstStatus = statusOf(connection.departDelay, connection.live);
        const secondStatus = statusOf(departure.delay, departure.live);
        next = {
          minutes: Math.floor((connection.departs * 1000 - now) / 60_000),
          legs: [
            { route: first, at: connection.departs, status: firstStatus },
            { route: second, at: departure.at, status: secondStatus },
          ],
          walk: false,
          line: `${first ? chipLabel(first) : ''} ${clock(connection.departs)} (${firstStatus.label.toLowerCase()}) → ${second ? chipLabel(second) : ''} ${clock(departure.at)} (${secondStatus.label.toLowerCase()})`,
        };
      }
    }
  }

  // With nothing to connect, a route that already stops here leads with its own next departure.
  if (!next) {
    for (const group of groups.filter(({ kind }) => kind === 'walk')) {
      const departure = visibleDepartures(group, now, false).find(({ canceled }) => !canceled);
      if (!departure || departure.at >= soonest) continue;
      soonest = departure.at;
      const route = data!.routes[departure.route];
      const status = statusOf(departure.delay, departure.live);
      next = {
        minutes: Math.floor((departure.at * 1000 - now) / 60_000),
        legs: [{ route, at: departure.at, status }],
        walk: true,
        line: `${route ? chipLabel(route) : ''} ${clock(departure.at)} (${status.label.toLowerCase()}) · no transfer needed`,
      };
    }
  }

  const boarding = new Set([data?.from, ...groups.map(({ board }) => board)].filter((key) => key !== undefined));
  const severeAlerts = (data?.alerts ?? []).filter(({ relevance, stops }) => relevance === 'stop' && stops.some((stop) => boarding.has(stop))).length;

  // The route a saved search is about: the one transferred to, in the color the results give it.
  const lineColor = data && (toRouteShown ?? (groups[0] ? data.routes[groups[0].routes[0]!] : undefined)) ? pageColors(groups, data)((toRouteShown ?? data.routes[groups[0]!.routes[0]!])!.key) : null;

  return { groups, from, via, to, toRoute: toRouteShown, lineColor, window, windowText: window ? windowText(window) : null, next, boarding, severeAlerts, chain: [from, via, to].filter(Boolean).join(' → ') };
}
