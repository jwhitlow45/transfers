import type { TripResponse } from '../../../shared/api.ts';
import type { Pin } from '../storage.ts';

// Small surprises, kept apart from the screens so Home can ring the same bell.

// Whether a pinned trip rides a cable car. A pin names its vehicles by trip, so the routes come
// from the departures and connections the results show, and from the pinned trip's own legs when
// the answer has them.
export function ringsBell(pin: Pin, data: TripResponse | null): boolean {
  if (!data) return false;
  const trips = new Set([pin.second.trip, ...(pin.first ? [pin.first.trip] : [])]);
  const routes = new Set<string>();
  for (const group of data.groups) {
    for (const departure of group.departures) {
      if (trips.has(departure.trip)) routes.add(departure.route);
      for (const connection of departure.connections) if (trips.has(connection.trip)) routes.add(connection.route);
    }
  }
  for (const leg of [data.pinned?.first, data.pinned?.second]) if (leg && trips.has(leg.trip)) routes.add(leg.route);
  return [...routes].some((key) => data.routes[key]?.mode === 'cable-car');
}
