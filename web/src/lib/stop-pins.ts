import type { NearbyArrival, NearbyStop, StopResponse } from '../../../shared/api.ts';
import type { Pin, Search } from '../storage.ts';

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

// The pinned arrival in a stop's latest times, with its row, or null once it has gone by or is not
// among them.
export function pinnedArrival(pin: Pin, data: StopResponse | null) {
  for (const row of data?.rows ?? []) {
    if (row.stop !== pin.second.board) continue;
    const arrival = row.arrivals.find(({ trip }) => trip === pin.second.trip);
    if (arrival) return { row, arrival };
  }
  return null;
}
