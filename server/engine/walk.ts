// How long a transfer physically takes, before any rider settings. See docs/transfer-rules.md
// for where these numbers come from and the transfers they were checked against.
export type Access = 'bart' | 'subway' | 'ferry' | 'street';

// From the vehicle to the street: along the platform, up to the street, out the fare gates.
const EXIT_SECONDS: Record<Access, number> = { bart: 105, subway: 90, ferry: 120, street: 10 };
// From the street to the vehicle: through the fare gates, down to the platform, to the right side.
const ENTRY_SECONDS: Record<Access, number> = { bart: 120, subway: 105, ferry: 120, street: 0 };

// Straight-line distance times this approximates walking the street grid.
export const DETOUR_FACTOR = 1.3;
export const DEFAULT_WALK_SPEED = 1.4;
// An allowance for waiting at a signal. Without street data, distance stands in for "different corner".
const CROSSING_SECONDS = 30;
const CROSSING_METERS = 30;

// The longest straight-line walk that counts as a transfer between two street stops. Checked
// against how SF riders transfer: 300 m catches every Muni crossing where both routes stop
// (the longest is 208 m) and 97.8% of route pairs that meet, without pulling in parallel streets.
export const DEFAULT_MAX_WALK_METERS = 300;
// When either end is a rail station, distance runs from the station entrance or, for Muni
// Metro, the platform point, so the limit stretches by half: 450 m catches 98.7% of the
// connections BART lists on its station maps.
export const STATION_WALK_FACTOR = 1.5;
// A rider who names the exact stop to transfer to has chosen the walk, so the limit only
// stops absurd pairings.
export const NAMED_STOP_MAX_WALK_METERS = 800;
// The default maximum is the minimum plus this, matching the 3 to 12 window J uses.
export const DEFAULT_WINDOW_MINUTES = 9;

export function transferSeconds(options: { exit: Access; entry: Access; meters: number; speed?: number }) {
  const speed = options.speed ?? DEFAULT_WALK_SPEED;
  const walk = (options.meters * DETOUR_FACTOR) / speed;
  const crossing = options.meters > CROSSING_METERS ? CROSSING_SECONDS : 0;
  return EXIT_SECONDS[options.exit] + walk + crossing + ENTRY_SECONDS[options.entry];
}

// Rounded up to whole minutes, with no buffer added. Minute comparisons round down, so a transfer
// shown as 3 minutes is already at least 3:00 in the feed.
export function minimumMinutes(seconds: number) {
  return Math.max(1, Math.ceil(seconds / 60));
}

// Infrequent routes would leave most first vehicles without a connection in the usual window, so
// the window widens to the route's headway and every first vehicle shows the departure it catches.
export function defaultMaximum(minimum: number, headwayMinutes: number | null) {
  const width = headwayMinutes !== null && headwayMinutes > DEFAULT_WINDOW_MINUTES ? Math.ceil(headwayMinutes) : DEFAULT_WINDOW_MINUTES;
  return minimum + width;
}
