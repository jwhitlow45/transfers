import type { AccessOutage, Alert, TripResponse } from '../../../shared/api.ts';
import { agencyOnly, chipLabel, shortStopName } from '../view.ts';

export type Severity = 'severe' | 'warning' | 'info';
// `startOpen` opens the alert at first. `kickerOnly` folds it to its kicker alone, as an outage's
// kicker already says what and where.
export type ViewAlert = { id: string; severity: Severity; kicker: string; title: string; body: string | null; meta: string; url: string | null; startOpen: boolean; kickerOnly: boolean };

const date = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' });

// The rider's access needs: elevators, escalators, or both.
export type Needs = { elevators: boolean; escalators: boolean };

// Severe: names a stop the rider boards at. Warning: another stop on the trip, a reroute, or
// station access. Info: everything else, such as agency-wide notices. BART's elevator and
// escalator outages at the rider's stations, when they asked for them, come first, and an alert
// about an elevator or escalator the rider relies on counts as severe.
export function viewAlerts(data: TripResponse, boardingStops: Set<string>, needs: Needs = { elevators: false, escalators: false }): ViewAlert[] {
  const order: Record<Severity, number> = { severe: 0, warning: 1, info: 2 };
  const alerts = data.alerts.map((alert) => toView(alert, data, boardingStops, needs)).sort((a, b) => order[a.severity] - order[b.severity]);
  // By what the outage is, not its place in the list, so one the rider opened stays open when
  // another clears. Two the same in every way are told apart by count.
  const seen = new Map<string, number>();
  const outages = (data.access ?? []).map((outage) => {
    const id = `access-${outage.kind}-${outage.station}-${outage.location}-${outage.reason}-${outage.returns}`;
    const count = (seen.get(id) ?? 0) + 1;
    seen.set(id, count);
    return outageView(outage, data, count > 1 ? `${id}-${count}` : id);
  });
  return [...outages, ...alerts];
}

function outageView(outage: AccessOutage, data: TripResponse, id: string): ViewAlert {
  const station = data.stops[outage.station];
  // "10/23/2026", a date, so read at noon UTC to land on the same day in California.
  const [month, day, year] = (outage.returns ?? '').split('/').map(Number);
  const back = month && day && year ? ` · Back about ${date.format(Date.UTC(year, month - 1, day, 12))}` : '';
  return {
    id,
    severity: 'severe',
    kicker: `${outage.kind === 'elevator' ? 'Elevator' : 'Escalator'} out · ${shortStopName(station, 'BART')}`,
    title: outage.location,
    body: outage.reason ? `${outage.reason}.` : null,
    meta: `BART${back}`,
    url: station?.bart ? `https://www.bart.gov/stations/${station.bart}/accessible` : null,
    startOpen: false,
    kickerOnly: true,
  };
}

function toView(alert: Alert, data: TripResponse, boardingStops: Set<string>, needs: Needs): ViewAlert {
  // A platform the page does not know is named by its agency, never by its key.
  const stopName = (key: string | undefined) => shortStopName(key ? data.stops[key] : undefined, agencyOnly(alert.agency));
  const routeNames = alert.routes.map((key) => (data.routes[key] ? chipLabel(data.routes[key]!) : key)).join(', ');
  const access = /elevator|escalator/i.test(alert.header);
  let severity: Severity = 'info';
  let kicker = `Notice · ${agencyOnly(alert.agency)}`;
  if (alert.lineWide) {
    // An alert that names every stop on a line is a notice about the line, not the rider's stops.
    kicker = `Notice · ${routeNames || agencyOnly(alert.agency)}`;
  } else if (alert.relevance === 'stop') {
    const boarding = alert.stops.find((stop) => boardingStops.has(stop));
    if (access) {
      severity = 'warning';
      kicker = `Station access · ${stopName(alert.stops[0])}`;
    } else if (boarding) {
      severity = 'severe';
      kicker = `Where you board · ${stopName(boarding)}`;
    } else {
      severity = 'warning';
      kicker = `At ${stopName(alert.stops[0])}`;
    }
  } else if (alert.relevance === 'route') {
    severity = 'warning';
    const kind = access ? 'Station access' : alert.effect === 'DETOUR' ? 'Reroute' : 'Service change';
    kicker = `${kind}${routeNames ? ` · ${routeNames}` : ''}`;
  }
  // Raised for a rider who relies on what it is about, but folded at first like BART's outages.
  const relied = (needs.elevators && /elevator/i.test(alert.header)) || (needs.escalators && /escalator/i.test(alert.header));
  if (relied) {
    severity = 'severe';
    if (kicker.startsWith('Notice')) kicker = `Station access · ${routeNames || agencyOnly(alert.agency)}`;
  }
  const until = alert.activeUntil ? ` · Until ${date.format(alert.activeUntil * 1000)}` : '';
  return { id: alert.id, severity, kicker, title: alert.header, body: alert.description, meta: `${agencyOnly(alert.agency)}${until}`, url: alert.url, startOpen: severity === 'severe' && !relied, kickerOnly: false };
}
