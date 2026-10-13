import type { AccessOutage, AgencyId, Alert, AlertRelevance, FeedStatus } from '../../shared/api.ts';
import { bartStationCode } from '../bart-stations.ts';
import type { Agency } from '../config.ts';
import type { Outage } from '../realtime/access.ts';
import type { RtAlert, TripSnapshot } from '../realtime/snapshot.ts';
import type { Schedule } from '../schedule.ts';
import type { Tables } from './views.ts';

// The live data one request reads, as it stood when the request came in.
export type RealtimeView = {
  trips: TripSnapshot | null;
  alerts: RtAlert[];
  status: (agency: Agency) => FeedStatus['state'];
  updatedAt: number | null;
  // BART's elevator and escalator outages, when the rider asked for them.
  access?: Outage[] | null;
};

// Predictions are for a trip's run today. Trip ids repeat every day, so a run scheduled further
// from now than this is another day's, which keeps to its schedule.
export const SAME_RUN_SECONDS = 6 * 3600;

// What an answer says about live service where the rider is going: the alerts on its stops,
// routes and agencies, and how fresh each agency's feed is. Alerts name platforms, so their stops
// join the tables for the page to name them.
export function serviceStatus(schedule: Schedule, realtime: RealtimeView, tables: Tables, on: { stops: Set<string>; routes: Set<string>; agencies: Set<AgencyId> }) {
  const alerts = relevantAlerts(realtime.alerts, on.stops, on.routes, on.agencies);
  for (const key of alerts.flatMap(({ stops }) => stops)) {
    const stop = schedule.stopsByKey.get(key);
    if (stop) tables.stop(stop);
  }
  return { alerts, feeds: [...on.agencies].map((agency) => ({ agency, state: realtime.status(agency), updatedAt: realtime.updatedAt })) };
}

// Alerts that name a stop on the trip (for a route on the trip, or for every route there),
// that cover a trip route as a whole, or that cover a whole agency the trip uses. An alert
// about the same route at a stop the rider never uses is left out.
const LINE_WIDE_STOPS = 20;

function alertView(alert: RtAlert, relevance: AlertRelevance, routes: Set<string>, stops: Set<string>): Alert {
  return {
    id: alert.id,
    relevance,
    agency: alert.agencies[0]!,
    header: alert.header,
    description: alert.description,
    url: alert.url,
    effect: alert.effect,
    activeUntil: alert.activeUntil,
    routes: alert.routes.filter((route) => routes.has(route)),
    stops: alert.stops.filter((stop) => stops.has(stop)),
  };
}

function relevantAlerts(alerts: RtAlert[], stops: Set<string>, routes: Set<string>, agencies: Set<AgencyId>): Alert[] {
  const order: Record<AlertRelevance, number> = { stop: 0, route: 1, agency: 2 };
  const results: Alert[] = [];
  for (const alert of alerts) {
    // Some alerts name every stop on a line, as Muni does for one elevator outage. Naming that
    // many stops says nothing about any one of them, so such an alert counts for its routes.
    const lineWide = alert.stops.length > LINE_WIDE_STOPS;
    if (lineWide) {
      const coversRoute = alert.routes.some((route) => routes.has(route));
      if (coversRoute) results.push({ ...alertView(alert, 'route', routes, new Set()), lineWide: true });
      continue;
    }
    const pairedStops = new Set(alert.routeStops.map((pair) => pair.split('|')[1]));
    const routesWithStops = new Set(alert.routeStops.map((pair) => pair.split('|')[0]));
    const namesTripStop =
      alert.routeStops.some((pair) => {
        const [route, stop] = pair.split('|');
        return stops.has(stop!) && routes.has(route!);
      }) || alert.stops.some((stop) => stops.has(stop) && !pairedStops.has(stop));
    const coversTripRoute = alert.routes.some((route) => routes.has(route) && !routesWithStops.has(route));
    const coversAgency = alert.agencyWide && alert.agencies.some((agency) => agencies.has(agency));
    const relevance: AlertRelevance | null = namesTripStop ? 'stop' : coversTripRoute ? 'route' : coversAgency ? 'agency' : null;
    if (!relevance) continue;
    results.push(alertView(alert, relevance, routes, stops));
  }
  return results.sort((a, b) => order[a.relevance] - order[b.relevance]);
}

// What a rider asked of BART's elevators and escalators: a rider who needs elevators hears of
// theirs being out, and takes longer to change at a station, and one who relies on escalators
// hears of theirs.
export type AccessNeeds = { stepFree?: boolean; escalators?: boolean };

// The outages the rider asked about at the BART stations behind the given stop keys, each with
// every key that leads to its station, so the page can mark where they touch the trip. `bartAt`
// holds the keys where the rider rides BART, which a shared station's key alone does not say.
export function stationOutages(schedule: Schedule, tables: Tables, outages: Outage[], needs: AccessNeeds, bartAt: Set<string>, keys: string[]): AccessOutage[] {
  const kinds = new Set<Outage['kind']>([...(needs.stepFree ? ['elevator' as const] : []), ...(needs.escalators ? ['escalator' as const] : [])]);
  const found = new Map<Outage, AccessOutage>();
  for (const key of new Set(keys)) {
    const stop = schedule.stopsByKey.get(key);
    const station = stop ? schedule.stationOf(stop) : null;
    const code = station?.agency === 'BA' ? bartStationCode(station) : null;
    if (!station || !code) continue;
    // At a shared station, BART's platform elevators and escalators are no part of a Muni Metro
    // rider's way, while its street and concourse ones are shared.
    const metroOnly = !bartAt.has(key);
    for (const outage of outages) {
      if (outage.station !== code || !kinds.has(outage.kind)) continue;
      if (metroOnly && /^platform/i.test(outage.location)) continue;
      const entry = found.get(outage) ?? { station: tables.stop(station), stops: [], kind: outage.kind, location: outage.location, reason: outage.reason, returns: outage.returns };
      entry.stops.push(key);
      found.set(outage, entry);
    }
  }
  return [...found.values()];
}
