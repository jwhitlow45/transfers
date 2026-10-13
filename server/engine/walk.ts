import { walkSeconds } from '../../shared/walk.ts';

// How long a transfer physically takes, before any rider settings. See docs/transfer-rules.md
// for where these numbers come from and the transfers they were checked against.
export type Access = 'bart' | 'subway' | 'ferry' | 'street';

// From the vehicle to the street: along the platform, up to the street, out the fare gates.
const EXIT_SECONDS: Record<Access, number> = { bart: 105, subway: 90, ferry: 120, street: 10 };
// From the street to the vehicle: through the fare gates, down to the platform, to the right side.
const ENTRY_SECONDS: Record<Access, number> = { bart: 120, subway: 105, ferry: 120, street: 0 };

// An allowance for waiting at a signal. Without street data, distance stands in for "different corner".
const CROSSING_SECONDS = 30;
const CROSSING_METERS = 30;

// The longest walk between stops a rider can ask for, well past the app's own choices, so no
// request has the server look further.
export const LONGEST_WALK_METERS = 1500;
// The longest straight-line walk that counts as a transfer between two street stops. Checked
// against how SF riders transfer: 300 m catches every Muni crossing where both routes stop
// (the longest is 208 m) and 97.8% of route pairs that meet, without pulling in parallel streets.
export const DEFAULT_MAX_WALK_METERS = 300;
// When either end is a rail station, distance runs from the station entrance or, for Muni
// Metro, the platform point, so the limit stretches by half: 450 m catches 98.7% of the
// connections BART lists on its station maps.
export const STATION_WALK_FACTOR = 1.5;
// The default maximum is the minimum plus this, matching the 3 to 12 window J uses.
export const DEFAULT_WINDOW_MINUTES = 9;
// Changing at a station step-free means waiting for and riding elevators, which takes this much
// more than the stairs.
export const STEP_FREE_MINUTES = 3;

// A stop at a rail station, BART or Muni Metro, which a rider reaches by stairs, escalators or
// elevators.
export const atRailStation = (stop: { access: Access }) => stop.access === 'bart' || stop.access === 'subway';

// The rider's own settings, from their device: the longest walk they will take to change
// vehicles, in meters, and how fast they walk, in meters a second.
export type WalkSettings = { walk?: number; speed?: number };

export function transferSeconds(options: { exit: Access; entry: Access; meters: number; speed?: number }) {
  return paceFreeSeconds(options) + walkSeconds(options.meters, options.speed);
}

// The part of a transfer's time that is the same at any walking pace: getting off, crossing, and
// getting on.
export function paceFreeSeconds(options: { exit: Access; entry: Access; meters: number }) {
  const crossing = options.meters > CROSSING_METERS ? CROSSING_SECONDS : 0;
  return EXIT_SECONDS[options.exit] + crossing + ENTRY_SECONDS[options.entry];
}

// Rounded up to whole minutes, with no buffer added. Minute comparisons round down, so a transfer
// shown as 3 minutes is already at least 3:00 in the feed.
export function minimumMinutes(seconds: number) {
  return Math.max(1, Math.ceil(seconds / 60));
}

// Infrequent routes would leave most first vehicles without a connection in the usual window, so
// the window widens to the route's headway and every first vehicle shows the departure it catches.
// The window is at least as wide as the gap between first-leg vehicles, so every departure of
// the second leg shows its best connection: the last vehicle that still makes it. Wider than
// MAX_WIDENING_MINUTES, waits get long enough that the rider should choose them, which the
// empty state's widen button offers.
const MAX_WIDENING_MINUTES = 20;

export function defaultMaximum(minimum: number, firstLegHeadwayMinutes: number | null) {
  const headway = firstLegHeadwayMinutes === null ? 0 : Math.ceil(firstLegHeadwayMinutes);
  return minimum + Math.min(MAX_WIDENING_MINUTES, Math.max(DEFAULT_WINDOW_MINUTES, headway));
}
