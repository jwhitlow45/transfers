import type { AccessOutage, Group } from '../../../shared/api.ts';
import { shortDate } from '../format.ts';

// BART's elevator and escalator outages at one station on the trip.
export type StationOutages = { station: string; kinds: AccessOutage['kind'][]; outages: AccessOutage[] };

// Outages by station, in the order the trip lists them, for one tag each. With `within`, only
// stations at one of those stop keys, such as a transfer point's.
export function outagesByStation(access: AccessOutage[], within?: ReadonlySet<string>): StationOutages[] {
  const stations = new Map<string, StationOutages>();
  for (const outage of access) {
    if (within && !outage.stops.some((stop) => within.has(stop))) continue;
    const entry = stations.get(outage.station) ?? { station: outage.station, kinds: [], outages: [] };
    if (!entry.kinds.includes(outage.kind)) entry.kinds = [...entry.kinds, outage.kind].sort();
    entry.outages.push(outage);
    stations.set(outage.station, entry);
  }
  return [...stations.values()];
}

// Where a transfer point's riders get off and board, and any stop its rows get off at instead.
export const groupStops = (group: Group) =>
  new Set([group.alight, group.board, ...group.departures.flatMap(({ connections }) => connections.flatMap(({ alight }) => (alight ? [alight] : [])))]);

// "Elevator and escalator out at 24th St Mission".
export function outageLabel(kinds: AccessOutage['kind'][], station: string) {
  const what = kinds.join(' and ');
  return `${what[0]!.toUpperCase()}${what.slice(1)} out at ${station}`;
}

// BART's expected return, "10/23/2026", as "Oct 23". A date, so read at noon UTC to land on the
// same day in California. Null when BART gives none, or not as a date.
export function returnDate(returns: string | null) {
  const [month, day, year] = (returns ?? '').split('/').map(Number);
  return month && day && year ? shortDate(Date.UTC(year, month - 1, day, 12)) : null;
}
