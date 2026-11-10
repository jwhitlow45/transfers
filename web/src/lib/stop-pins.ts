import type { Alert, NearbyArrival, NearbyStop, StopResponse } from '../../../shared/api.ts';
import type { Pin, Search } from '../storage.ts';
import { answers, sameRun } from './pinned.ts';
import { countdownTo, stillWaiting } from '../format.ts';

// An arrival at a stop as a pin: the vehicle and where it is boarded, with no first vehicle, as a
// ride already at From is pinned on results. `at` is when it was due before any delay, which stays
// the same as its predictions change, and it ends as it arrives.
export function stopPinOf(arrival: NearbyArrival, row: NearbyStop, search: Search): Pin {
  return {
    second: { trip: arrival.trip, board: row.stop },
    at: arrival.at - (arrival.delay ?? 0),
    ends: arrival.at,
    search,
    arrival: { route: arrival.route, headsign: row.headsign },
  };
}

// The alerts a pinned arrival counts in the pin bar, as a pinned trip counts those where the rider
// boards: the ones about the stop it is boarded at, and the ones about its route, less any the
// rider dismissed. A stop's answer has alerts for every route there, most of them not this one's.
export const arrivalAlerts = (alerts: Alert[], route: string | undefined, stop: string, dismissed: ReadonlySet<string>) =>
  alerts.filter(({ id, relevance, routes, stops }) => !dismissed.has(id) && ((relevance === 'stop' && stops.includes(stop)) || (relevance === 'route' && route !== undefined && routes.includes(route))));

// A pinned arrival's countdown column: to its vehicle coming, then that it came, or for a canceled
// one, once it was due, that it is canceled, rather than that it is arriving. A vehicle yet to leave
// the first stop of its trip comes then at the soonest (see atLeast), and has not come, whatever its
// time (see stillWaiting).
export function arrivalCountdown(at: number, nowMs: number, { canceled, known, notStarted = false }: { canceled: boolean; known: boolean; notStarted?: boolean }) {
  if (stillWaiting(at, nowMs, notStarted) || nowMs / 1000 <= at) return countdownTo(at, nowMs, 'Arrives in', 'Arriving', notStarted ? 'notStarted' : null);
  if (canceled) return { lead: 'Canceled', num: '✕', unit: null };
  return known ? { lead: 'Arrived', num: '✓', unit: null } : countdownTo(at, nowMs, 'Arrives in', 'Arriving');
}

// The pinned arrival as its vehicle runs now, and whether it is canceled: from the server's answer
// for the pin, or until one comes, from the stop's latest times, by the same run, as trip ids repeat
// every day. `lost` says the answer for the pin could not place the vehicle at all.
export function pinnedArrival(pin: Pin, data: StopResponse | null): { arrival: NearbyArrival | null; canceled: boolean; lost: boolean } {
  if (data?.pinned && answers(data.pin, pin)) {
    const leg = data.pinned.second;
    if (!leg?.on) return { arrival: null, canceled: false, lost: true };
    return { arrival: { trip: leg.trip, route: leg.route, at: leg.on.at, delay: leg.on.delay, live: leg.live, ...(leg.notStarted ? { notStarted: true } : {}) }, canceled: leg.canceled === true, lost: false };
  }
  for (const row of data?.rows ?? []) {
    if (row.stop !== pin.second.board) continue;
    const arrival = row.arrivals.find(({ trip, at, delay }) => trip === pin.second.trip && sameRun(at - (delay ?? 0), pin.at));
    if (arrival) return { arrival, canceled: false, lost: false };
  }
  return { arrival: null, canceled: false, lost: false };
}
