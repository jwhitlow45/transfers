import type { TripResponse } from '../../../shared/api.ts';
import { clock } from '../format.ts';
import type { Search } from '../storage.ts';
import { chipLabel, shortStopName, statusOf, windowText } from '../view.ts';
import { pageColors, pointId, visibleDepartures } from './results.ts';

// The parts of a trip that headers, saved cards, and recent searches all describe.
export function summarize(search: Search, data: TripResponse | null, now: number) {
  const groups = (data?.groups ?? []).filter((group) => !search.off?.includes(pointId(group)));
  const from = data ? shortStopName(data.stops[data.from], search.fromLabel) : search.fromLabel;
  const alights = [...new Set(groups.map(({ alight }) => alight))];
  // With several places to get off, each group says its own, and the header names none.
  const via = alights.length === 1 ? shortStopName(data?.stops[alights[0]!], '') : null;
  const toRoute = data && 'route' in data.to ? data.routes[data.to.route] : undefined;
  const routeSets = [...new Set(groups.map(({ routes }) => routes.join(',')))];
  const onlyRoute = routeSets.length === 1 && groups[0]?.routes.length === 1 ? data?.routes[groups[0].routes[0]!] : undefined;
  const toRouteShown = toRoute ?? onlyRoute;
  const to = toRouteShown ? chipLabel(toRouteShown) : search.toLabel;
  const windows = groups.map(({ window }) => window);
  const window = windows.length === 0 ? { min: search.min ?? 3, max: search.max ?? 12 } : { min: Math.min(...windows.map(({ min }) => min)), max: Math.max(...windows.map(({ max }) => max)) };

  // The soonest first vehicle that makes a connection, with both legs and their lateness.
  let next: { minutes: number; line: string } | null = null;
  let soonest = Infinity;
  for (const group of groups) {
    for (const departure of visibleDepartures(group, now, false)) {
      if (departure.canceled) continue;
      for (const connection of departure.connections) {
        if (connection.departs >= soonest) continue;
        soonest = connection.departs;
        const first = data!.routes[connection.route];
        const second = data!.routes[departure.route];
        const firstStatus = statusOf(connection.departDelay, connection.live).label.toLowerCase();
        const secondStatus = statusOf(departure.delay, departure.live).label.toLowerCase();
        next = {
          minutes: Math.floor((connection.departs * 1000 - now) / 60_000),
          line: `${first ? chipLabel(first) : ''} ${clock(connection.departs)} (${firstStatus}) → ${second ? chipLabel(second) : ''} ${clock(departure.at)} (${secondStatus})`,
        };
      }
    }
  }

  const boarding = new Set([data?.from, ...groups.map(({ board }) => board)].filter((key) => key !== undefined));
  const severeAlerts = (data?.alerts ?? []).filter(({ relevance, stops }) => relevance === 'stop' && stops.some((stop) => boarding.has(stop))).length;

  // The route a saved search is about: the one transferred to, in the color the results give it.
  const lineColor = data && (toRouteShown ?? (groups[0] ? data.routes[groups[0].routes[0]!] : undefined)) ? pageColors(groups, data)((toRouteShown ?? data.routes[groups[0]!.routes[0]!])!.key) : null;

  return { groups, from, via, to, toRoute: toRouteShown, lineColor, window, windowText: windowText(window), next, boarding, severeAlerts, chain: [from, via, to].filter(Boolean).join(' → ') };
}
