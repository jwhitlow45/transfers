import type { Alert, Route, TripResponse } from '../../../shared/api.ts';
import { clock, clockOrDay, minutesUntil } from '../format.ts';
import type { Pin, Search } from '../storage.ts';
import { type Status, chipLabel, shortStopName, statusOf, windowText } from '../view.ts';
import { pinOf } from './pinned.ts';
import { pageColors, pointId, ridesStraightTo, visibleDepartures } from './results.ts';

// One vehicle of the next connection, for a saved card to draw as the results page does.
export type Leg = { route: Route | undefined; at: number; status: Status };
// The soonest connection: minutes until it leaves, its vehicles, the minutes to make the
// transfer (null when the route already stops at From, so there is none), whether those come from
// the schedule alone, and the same in one line for screen readers. `pin` is the trip pinned from
// the card, built as results build it.
export type NextConnection = { minutes: number; legs: Leg[]; transfer: number | null; transferScheduled: boolean; line: string; later: Later[]; pin: Pin };
// Minutes until a later departure, and whether its time is the schedule's alone.
export type Later = { minutes: number; scheduled: boolean };

// Alerts about a stop the rider stands at, not yet dismissed.
export const countStopAlerts = (alerts: Alert[], stops: ReadonlySet<string>, dismissed: ReadonlySet<string>) =>
  alerts.filter(({ id, relevance, stops: affected }) => relevance === 'stop' && affected.some((stop) => stops.has(stop)) && !dismissed.has(id)).length;

// Minutes until the next two departures after the soonest, from every time the card could have
// drawn. One first vehicle often connects to several second vehicles, so repeats are dropped. A
// minute is scheduled only when every departure in it is, as one live prediction there is enough.
export function laterMinutes(departs: { at: number; live: boolean }[], soonest: number, now: number): Later[] {
  const later = new Map<number, boolean>();
  for (const { at, live } of departs.filter(({ at }) => at > soonest).sort((a, b) => a.at - b.at)) {
    const minutes = minutesUntil(at, now);
    later.set(minutes, (later.get(minutes) ?? true) && !live);
  }
  return [...later].slice(0, 2).map(([minutes, scheduled]) => ({ minutes, scheduled }));
}

// The parts of a trip that headers, saved cards, and recent searches all describe.
// `dismissed` are the ids of notices the rider dismissed, which alert counts leave out.
export function summarize(search: Search, data: TripResponse | null, now: number, dismissed: ReadonlySet<string> = new Set()) {
  const groups = (data?.groups ?? []).filter((group) => !search.off?.includes(pointId(group)));
  const from = data ? shortStopName(data.stops[data.from], search.fromLabel) : search.fromLabel;
  const alights = [...new Set(groups.filter(({ kind }) => kind !== 'walk').map(({ alight }) => alight))];
  // On the trips tab, the stop in To is where the rider is going (see ResultsScreen).
  const going = data?.view === 'trips';
  // With several places to get off, each group says its own, and the header names none. Going to a
  // stop, a ride straight there is a way that changes nowhere.
  const via = alights.length === 1 && !(going && groups.some(({ kind }) => kind === 'walk')) ? shortStopName(data?.stops[alights[0]!], '') : null;
  const toRoute = data && 'route' in data.to ? data.routes[data.to.route] : undefined;
  const routeSets = [...new Set(groups.map(({ routes }) => routes.join(',')))];
  const onlyRoute = routeSets.length === 1 && groups[0]?.routes.length === 1 ? data?.routes[groups[0].routes[0]!] : undefined;
  // A route straight to the named stop is the way there, not what the rider is going to catch, and
  // a stop the rider is going to is named, not a route that gets there.
  const straight = groups.length > 0 && groups.every((group) => ridesStraightTo(group, search.dest));
  const toRouteShown = toRoute ?? (straight || going ? undefined : onlyRoute);
  const to = toRouteShown ? chipLabel(toRouteShown) : search.toLabel;
  // The window the page talks about: the rider's own, or the first transfer point's that has
  // something to catch. The header, the bottom bar, and the sheet all show this one.
  const rides = groups.filter(({ kind }) => kind !== 'walk');
  const lead = rides.find((group) => visibleDepartures(group, now, false).some(({ canceled }) => !canceled)) ?? rides[0];
  const window = lead ? { min: search.min ?? lead.window.min, max: search.max ?? lead.window.max } : null;

  // The soonest first vehicle that makes a connection, with both legs and their lateness.
  let next: NextConnection | null = null;
  let soonest = Infinity;
  const leaves: { at: number; live: boolean }[] = [];
  for (const group of groups) {
    for (const departure of visibleDepartures(group, now, false)) {
      if (departure.canceled) continue;
      for (const connection of departure.connections) {
        leaves.push({ at: connection.departs, live: connection.live });
        if (connection.departs >= soonest) continue;
        soonest = connection.departs;
        const first = data!.routes[connection.route];
        const second = data!.routes[departure.route];
        const firstStatus = statusOf(connection.departDelay, connection.live);
        const secondStatus = statusOf(departure.delay, departure.live);
        // From where the first vehicle lets the rider off to the second reaching them.
        const transferScheduled = !connection.live || Boolean(connection.arrivesScheduled) || !departure.live;
        next = {
          minutes: minutesUntil(connection.departs, now),
          legs: [
            { route: first, at: connection.departs, status: firstStatus },
            { route: second, at: departure.at, status: secondStatus },
          ],
          transfer: connection.transfer,
          transferScheduled,
          later: [],
          pin: pinOf(departure, group.board, { connection, alight: connection.alight ?? group.alight }),
          line: `${first ? chipLabel(first) : ''} ${clock(connection.departs)} (${firstStatus.label.toLowerCase()}), ${transferScheduled ? 'scheduled ' : ''}${connection.transfer} minute transfer, ${second ? chipLabel(second) : ''} ${clock(departure.at)} (${secondStatus.label.toLowerCase()})`,
        };
      }
    }
  }

  // With nothing to connect, a route that already stops here leads with its own next departure.
  if (!next) {
    for (const group of groups.filter(({ kind }) => kind === 'walk')) {
      const open = visibleDepartures(group, now, false).filter(({ canceled }) => !canceled);
      leaves.push(...open.map(({ at, live }) => ({ at, live })));
      const departure = open[0];
      if (!departure || departure.at >= soonest) continue;
      soonest = departure.at;
      const route = data!.routes[departure.route];
      const status = statusOf(departure.delay, departure.live);
      next = {
        minutes: minutesUntil(departure.at, now),
        legs: [{ route, at: departure.at, status }],
        transfer: null,
        transferScheduled: false,
        later: [],
        pin: pinOf(departure, group.board),
        line: `${route ? chipLabel(route) : ''} ${clock(departure.at)} (${status.label.toLowerCase()}) · no transfer needed`,
      };
    }
  }

  if (next) next.later = laterMinutes(leaves, soonest, now);

  // What an empty card says instead of a bare "No connection", when the routes are asleep.
  const idle = data?.notice?.kind === 'idle' ? data.notice.next : null;
  const nextService = !next && idle ? clockOrDay(idle, now) : null;

  const boarding = new Set([data?.from, ...groups.map(({ board }) => board)].filter((key) => key !== undefined));
  // Where the rider gets off the first vehicle counts too: a closed transfer stop breaks the trip
  // as much as a closed boarding stop does.
  const standing = new Set(boarding);
  for (const group of groups) {
    standing.add(group.alight);
    for (const departure of group.departures) for (const connection of departure.connections) if (connection.alight) standing.add(connection.alight);
  }
  const severeAlerts = countStopAlerts(data?.alerts ?? [], standing, dismissed);

  // The route a saved search is about: the one transferred to, in the color the results give it.
  const lineColor = data && (toRouteShown ?? (groups[0] ? data.routes[groups[0].routes[0]!] : undefined)) ? pageColors(groups, data)((toRouteShown ?? data.routes[groups[0]!.routes[0]!])!.key) : null;

  // Where to get off is left out of the chain when it is To's own stop, said once.
  return { groups, from, via, to, toRoute: toRouteShown, lineColor, window, windowText: window ? windowText(window) : null, next, nextService, boarding, severeAlerts, chain: [from, via === to ? null : via, to].filter(Boolean).join(' → ') };
}
