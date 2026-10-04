import type { Alert, TripResponse } from '../../../shared/api.ts';
import { agencyOnly, chipLabel, shortStopName } from '../view.ts';

export type Severity = 'severe' | 'warning' | 'info';
export type ViewAlert = { id: string; severity: Severity; kicker: string; title: string; body: string | null; meta: string; url: string | null };

const date = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' });

// Severe: names a stop the rider boards at. Warning: another stop on the trip, a reroute, or
// station access. Info: everything else, such as agency-wide notices.
export function viewAlerts(data: TripResponse, boardingStops: Set<string>): ViewAlert[] {
  const order: Record<Severity, number> = { severe: 0, warning: 1, info: 2 };
  return data.alerts
    .map((alert) => toView(alert, data, boardingStops))
    .sort((a, b) => order[a.severity] - order[b.severity]);
}

function toView(alert: Alert, data: TripResponse, boardingStops: Set<string>): ViewAlert {
  const stopName = (key: string | undefined) => shortStopName(key ? data.stops[key] : undefined, key ?? '');
  const routeNames = alert.routes.map((key) => (data.routes[key] ? chipLabel(data.routes[key]!) : key)).join(', ');
  const access = /elevator|escalator/i.test(alert.header);
  let severity: Severity = 'info';
  let kicker = `Notice · ${agencyOnly(alert.agency)}`;
  if (alert.relevance === 'stop') {
    const boarding = alert.stops.find((stop) => boardingStops.has(stop));
    if (access) {
      severity = 'warning';
      kicker = `Station access · ${stopName(alert.stops[0])}`;
    } else if (boarding) {
      severity = 'severe';
      kicker = 'Your boarding stop';
    } else {
      severity = 'warning';
      kicker = `At ${stopName(alert.stops[0])}`;
    }
  } else if (alert.relevance === 'route') {
    severity = 'warning';
    kicker = `${alert.effect === 'DETOUR' ? 'Reroute' : 'Service change'}${routeNames ? ` · ${routeNames}` : ''}`;
  }
  const until = alert.activeUntil ? ` · Until ${date.format(alert.activeUntil * 1000)}` : '';
  return { id: alert.id, severity, kicker, title: alert.header, body: alert.description, meta: `${agencyOnly(alert.agency)}${until}`, url: alert.url };
}
