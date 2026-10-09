import type { NearbyArrival, NearbyStop, StopResponse } from '../../../shared/api.ts';
import type { Pin, Search } from '../storage.ts';
import { answers, sameRun } from './pinned.ts';

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

// The pinned arrival as its vehicle runs now, and whether it is canceled: from the server's answer
// for the pin, or until one comes, from the stop's latest times, by the same run, as trip ids repeat
// every day. `lost` says the answer for the pin could not place the vehicle at all.
export function pinnedArrival(pin: Pin, data: StopResponse | null): { arrival: NearbyArrival | null; canceled: boolean; lost: boolean } {
  if (data?.pinned && answers(data.pin, pin)) {
    const leg = data.pinned.second;
    if (!leg?.on) return { arrival: null, canceled: false, lost: true };
    return { arrival: { trip: leg.trip, route: leg.route, at: leg.on.at, delay: leg.on.delay, live: leg.live }, canceled: leg.canceled === true, lost: false };
  }
  for (const row of data?.rows ?? []) {
    if (row.stop !== pin.second.board) continue;
    const arrival = row.arrivals.find(({ trip, at, delay }) => trip === pin.second.trip && sameRun(at - (delay ?? 0), pin.at));
    if (arrival) return { arrival, canceled: false, lost: false };
  }
  return { arrival: null, canceled: false, lost: false };
}
