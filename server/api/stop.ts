import type { AgencyId, StopResponse } from '../../shared/api.ts';
import { type RealtimeView, RequestError, relevantAlerts } from '../engine/trip.ts';
import { Tables } from '../engine/views.ts';
import { routeKeyOf, type Schedule, stopKeyOf } from '../schedule.ts';
import { arrivalsFor, boardingRows } from './nearby.ts';

// Enough for the three a row shows and the three more it opens to, and for a pinned arrival a few
// vehicles back to stay in the list until it comes.
export const STOP_ARRIVALS = 6;

// What comes to one stop, for riders who want a stop's arrivals rather than a transfer (J,
// 2026-10-09). A BART platform stands for its station, so both directions show, and a shared
// downtown station shows Muni Metro's platforms too.
export function stopArrivals(schedule: Schedule, realtime: RealtimeView, key: string, now: number): StopResponse {
  const asked = schedule.stopsByKey.get(key);
  if (!asked) throw new RequestError(404, `No stop ${key}`);
  const stop = schedule.stationOf(asked);
  const tables = new Tables(schedule);
  const { rows } = boardingRows(schedule, schedule.boardingStops(stop), () => 0);
  const context = { schedule, snapshot: realtime.trips, now };
  // One row per route and direction, whichever of its stops it boards at.
  const seen = new Set<string>();
  const shown = rows
    .filter(({ key: rowKey }) => !seen.has(rowKey) && seen.add(rowKey))
    .map((row) => ({ row, arrivals: arrivalsFor(context, tables, row, STOP_ARRIVALS) }))
    .sort((a, b) => (a.arrivals[0]?.at ?? Infinity) - (b.arrivals[0]?.at ?? Infinity) || b.row.trips - a.row.trips);
  const routeIds = new Set(shown.flatMap(({ row }) => row.routes));
  const agencies = new Set<AgencyId>([...routeIds].map((id) => schedule.route(id).agency));
  const stopKeys = new Set([stop, ...schedule.boardingStops(stop)].map(stopKeyOf));
  const alerts = relevantAlerts(realtime.alerts, stopKeys, new Set([...routeIds].map((id) => routeKeyOf(schedule.route(id)))), agencies);
  // Alerts name platforms, so their stops join the tables for the page to name them.
  for (const alertStop of alerts.flatMap(({ stops }) => stops)) {
    const known = schedule.stopsByKey.get(alertStop);
    if (known) tables.stop(known);
  }
  return {
    generatedAt: now,
    dataAt: realtime.updatedAt,
    stop: tables.stop(stop),
    rows: shown.map(({ row, arrivals }) => ({
      stop: tables.stop(schedule.stationOf(row.stop)),
      routes: row.routes.map((id) => tables.route(schedule.route(id))),
      direction: row.direction,
      headsign: row.headsign,
      meters: 0,
      arrivals,
    })),
    routes: tables.routes,
    stops: tables.stops,
    alerts,
    feeds: [...agencies].map((agency) => ({ agency, state: realtime.status(agency), updatedAt: realtime.updatedAt })),
  };
}
