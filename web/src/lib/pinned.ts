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

// Trip ids repeat every day, so the same trip is also the same run: due within half a day.
export const sameRun = (a: number, b: number) => Math.abs(a - b) < 12 * 3600;

// Whether two pins are the same trip: the same vehicles, stops, and run.
export const samePin = (a: Pin, b: Pin) =>
  a.second.trip === b.second.trip && a.second.board === b.second.board && a.first?.trip === b.first?.trip && a.first?.alight === b.first?.alight && sameRun(a.at, b.at);

// Where a pinned trip ends, as the results count a departure's arrival: the destination, or for a
// route already at From ridden straight to a named To stop, that stop.
export const pinnedDestination = (pin: Pin, data: TripResponse, dest: string | undefined) => dest ?? (!pin.first && 'stop' in data.to ? data.to.stop : undefined);

// Whole minutes from the first vehicle reaching the stop the rider leaves it at to the second
// reaching where they board it, as the results count a transfer. Negative when the second leaves
// first. Null without both times.
export function pinnedTransfer(pinned: PinnedTrip): number | null {
  const off = pinned.first?.off?.at;
  const on = pinned.second?.on?.at;
  return off === undefined || on === undefined ? null : Math.floor((on - off) / 60);
}

// Whether the server's answer is for this pin: its vehicles, where it boards the second and leaves
// the first, and its run. A refresh for a new pin shows the old answer until the new one comes.
function answers(answered: PinnedTrip, pin: Pin) {
  const { first, second } = answered;
  if (second?.trip !== pin.second.trip || (first?.trip ?? null) !== (pin.first?.trip ?? null)) return false;
  if (second.on && (second.on.stop !== pin.second.board || !sameRun(second.on.at, pin.at))) return false;
  return !pin.first || !first?.off || first.off.stop === pin.first.alight;
}

// The response's pinned trip when it is the one pinned now. Until an answer for a new pin
// arrives, the results it was pinned from have the same vehicles' times, so the card shows at once.
export function pinnedFor(pin: Pin, data: TripResponse, dest: string | undefined): PinnedTrip | null {
  if (data.pinned && answers(data.pinned, pin)) return data.pinned;
  const end = pinnedDestination(pin, data, dest);
  for (const group of data.groups) {
    if (group.board !== pin.second.board) continue;
    const departure = group.departures.find(({ trip, at }) => trip === pin.second.trip && sameRun(at, pin.at));
    if (!departure) continue;
    const second: PinnedLeg = {
      trip: departure.trip,
      route: departure.route,
      on: { stop: group.board, at: departure.at, delay: departure.delay },
      off: end && departure.destination !== undefined ? { stop: end, at: departure.destination, delay: null } : null,
      live: departure.live,
      ...(departure.canceled ? { canceled: true } : {}),
    };
    if (!pin.first) return { second };
    const connection = departure.connections.find(({ trip, alight }) => trip === pin.first!.trip && (alight ?? group.alight) === pin.first!.alight);
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

// A trip the schedule lacks is known only by the feed, which drops each stop once the vehicle has
// passed it, and the trip once it has ended. Such a stop, or leg, keeps the time last seen, so
// boarding does not wipe the trip. `end` is where the second leg ends now, and a kept arrival
// counts only if it is still there.
export function steadyPinned(fresh: PinnedTrip, last: PinnedTrip | undefined, pin: Pin, end: string | undefined): PinnedTrip {
  if (!last) return fresh;
  const keep = (now: PinnedLeg | null | undefined, before: PinnedLeg | null | undefined, offAt: string | undefined): PinnedLeg | null => {
    if (!before?.added || (now && now.trip !== before.trip)) return now ?? null;
    if (!now) return { ...before, off: before.off?.stop === offAt ? before.off : null };
    return { ...now, on: now.on ?? before.on, off: now.off ?? (before.off?.stop === offAt ? before.off : null) };
  };
  const second = keep(fresh.second, last.second, end);
  return pin.first ? { first: keep(fresh.first, last.first, pin.first.alight), second } : { second };
}
