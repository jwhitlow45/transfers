import type { PinnedLeg, PinnedTrip, TripResponse } from '../../../shared/api.ts';
import type { Pin } from '../storage.ts';

// When a pinned trip ends: arriving at the destination, or with none set, boarding the second
// vehicle. Null when neither time is known.
export function pinnedEnd(pinned: PinnedTrip): number | null {
  return pinned.second?.off?.at ?? pinned.second?.on?.at ?? null;
}

// Where the rider is along a pinned trip, by when its vehicles are due: waiting for the first
// vehicle, riding it, changing to the second, riding that, or done. Without a first vehicle the
// trip starts at changing, which is waiting for the second.
export type PinnedPhase = 'wait' | 'ride' | 'change' | 'ride-second' | 'done';

export function pinnedPhase(pinned: PinnedTrip, now: number): PinnedPhase {
  const before = (leg: PinnedLeg | null | undefined, stop: 'on' | 'off') => {
    const at = leg?.[stop]?.at;
    return at !== undefined && now < at;
  };
  if (pinned.first) {
    if (before(pinned.first, 'on')) return 'wait';
    if (before(pinned.first, 'off')) return 'ride';
  }
  if (before(pinned.second, 'on')) return 'change';
  if (before(pinned.second, 'off')) return 'ride-second';
  return 'done';
}

// Whether two pins are the same trip.
export const samePin = (a: Pin, b: Pin) => a.second.trip === b.second.trip && a.second.board === b.second.board && a.first?.trip === b.first?.trip;

// Whole minutes from the first vehicle reaching the stop the rider leaves it at to the second
// reaching where they board it, as the results count a transfer. Negative when the second leaves
// first. Null without both times.
export function pinnedTransfer(pinned: PinnedTrip): number | null {
  const off = pinned.first?.off?.at;
  const on = pinned.second?.on?.at;
  return off === undefined || on === undefined ? null : Math.floor((on - off) / 60);
}

// The response's pinned trip when it is the one pinned now. Until an answer for a new pin
// arrives, the results it was pinned from have the same vehicles' times, so the card shows at once.
export function pinnedFor(pin: Pin, data: TripResponse, dest: string | undefined): PinnedTrip | null {
  const answered = data.pinned;
  if (answered && answered.second?.trip === pin.second.trip && (answered.first?.trip ?? null) === (pin.first?.trip ?? null)) return answered;
  for (const group of data.groups) {
    if (group.board !== pin.second.board) continue;
    const departure = group.departures.find(({ trip }) => trip === pin.second.trip);
    if (!departure) continue;
    const second: PinnedLeg = {
      trip: departure.trip,
      route: departure.route,
      on: { stop: group.board, at: departure.at, delay: departure.delay },
      off: dest && departure.destination !== undefined ? { stop: dest, at: departure.destination, delay: null } : null,
      live: departure.live,
      ...(departure.canceled ? { canceled: true } : {}),
    };
    if (!pin.first) return { second };
    const connection = departure.connections.find(({ trip }) => trip === pin.first!.trip);
    if (!connection) continue;
    const first: PinnedLeg = {
      trip: connection.trip,
      route: connection.route,
      on: { stop: data.from, at: connection.departs, delay: connection.departDelay },
      off: { stop: pin.first.alight, at: connection.arrives, delay: connection.arriveDelay },
      live: connection.live,
    };
    return { first, second };
  }
  return null;
}
