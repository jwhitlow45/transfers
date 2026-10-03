import type { DatabaseSync } from 'node:sqlite';
import type { Mode } from '../shared/api.ts';
import type { Agency } from './config.ts';
import { all, get, openDatabase } from './db.ts';
import type { Access } from './engine/walk.ts';
import { addDays, serviceDate, serviceDayStart, weekday } from './time.ts';

export type StopRow = {
  id: number;
  agency: Agency;
  stopId: string;
  code: string | null;
  name: string;
  lat: number;
  lon: number;
  kind: 'stop' | 'station' | 'platform' | 'entrance' | 'other';
  parent: number | null;
  access: Access;
  bearing: number | null;
};

export type RouteRow = {
  id: number;
  agency: Agency;
  routeId: string;
  shortName: string;
  longName: string;
  mode: Mode;
  color: string | null;
  textColor: string | null;
};

export type PatternRow = {
  id: number;
  route: number;
  direction: number | null;
  headsign: string;
  shape: number | null;
  stops: number[];
  trips: number;
};

export type ScheduledTrip = {
  tripRow: number;
  key: string;
  // Unix seconds at each requested position.
  times: Map<number, { arrival: number; departure: number }>;
};

export const stopKeyOf = (stop: { agency: string; stopId: string }) => `${stop.agency}:${stop.stopId}`;
export const routeKeyOf = (route: { agency: string; routeId: string }) => `${route.agency}:${route.routeId}`;

// The schedule database, with everything except stop times held in memory: a few thousand
// stops and a few hundred patterns, which every request walks through.
export class Schedule {
  readonly db: DatabaseSync;
  readonly builtAt: number;
  readonly stops = new Map<number, StopRow>();
  readonly stopsByKey = new Map<string, StopRow>();
  readonly children = new Map<number, StopRow[]>();
  readonly entrances = new Map<number, StopRow[]>();
  readonly routes = new Map<number, RouteRow>();
  readonly routesByKey = new Map<string, RouteRow>();
  readonly directionNames = new Map<string, string>();
  readonly patterns = new Map<number, PatternRow>();
  readonly patternsByStop = new Map<number, { pattern: PatternRow; position: number }[]>();
  readonly patternsByRoute = new Map<number, PatternRow[]>();
  readonly trips = new Map<string, { row: number; pattern: number; headsign: string }>();
  readonly stopRoutes = new Map<number, { route: number; direction: number; headsign: string; trips: number }[]>();
  readonly transfers = new Map<string, number | null>();
  private readonly services = new Map<number, { days: number; start: number | null; end: number | null }>();
  private readonly serviceDates = new Map<number, Map<number, boolean>>();
  private readonly activeByDate = new Map<number, number[]>();

  constructor(path: string) {
    this.db = openDatabase(path, { readOnly: true });
    this.builtAt = Number(get<{ value: string }>(this.db, "SELECT value FROM meta WHERE key = 'built_at'")?.value ?? 0);

    for (const row of all<StopRow & { stop_id: string }>(
      this.db,
      'SELECT id, agency, stop_id, code, name, lat, lon, kind, parent, access, bearing FROM stops',
    )) {
      const stop: StopRow = { ...row, stopId: row.stop_id };
      delete (stop as { stop_id?: string }).stop_id;
      this.stops.set(stop.id, stop);
      this.stopsByKey.set(stopKeyOf(stop), stop);
    }
    for (const stop of this.stops.values()) {
      if (stop.parent === null) continue;
      const map = stop.kind === 'entrance' ? this.entrances : this.children;
      let list = map.get(stop.parent);
      if (!list) map.set(stop.parent, (list = []));
      list.push(stop);
    }

    for (const row of all<{ id: number; agency: Agency; route_id: string; short_name: string; long_name: string; mode: Mode; color: string | null; text_color: string | null }>(
      this.db,
      'SELECT id, agency, route_id, short_name, long_name, mode, color, text_color FROM routes',
    )) {
      const route: RouteRow = {
        id: row.id,
        agency: row.agency,
        routeId: row.route_id,
        shortName: row.short_name,
        longName: row.long_name,
        mode: row.mode,
        color: row.color,
        textColor: row.text_color,
      };
      this.routes.set(route.id, route);
      this.routesByKey.set(routeKeyOf(route), route);
    }
    for (const row of all<{ route: number; direction: number; name: string }>(this.db, 'SELECT route, direction, name FROM directions')) {
      this.directionNames.set(`${row.route}|${row.direction}`, row.name);
    }

    for (const row of all<{ id: number; route: number; direction: number | null; headsign: string; shape: number | null; trips: number }>(
      this.db,
      'SELECT id, route, direction, headsign, shape, trips FROM patterns',
    )) {
      const pattern: PatternRow = { ...row, stops: [] };
      this.patterns.set(pattern.id, pattern);
      let list = this.patternsByRoute.get(pattern.route);
      if (!list) this.patternsByRoute.set(pattern.route, (list = []));
      list.push(pattern);
    }
    for (const row of all<{ pattern: number; position: number; stop: number }>(
      this.db,
      'SELECT pattern, position, stop FROM pattern_stops ORDER BY pattern, position',
    )) {
      const pattern = this.patterns.get(row.pattern);
      if (!pattern) continue;
      pattern.stops.push(row.stop);
      let list = this.patternsByStop.get(row.stop);
      if (!list) this.patternsByStop.set(row.stop, (list = []));
      list.push({ pattern, position: row.position });
    }

    for (const row of all<{ id: number; agency: string; trip_id: string; pattern: number; headsign: string }>(
      this.db,
      'SELECT id, agency, trip_id, pattern, headsign FROM trips',
    )) {
      this.trips.set(`${row.agency}:${row.trip_id}`, { row: row.id, pattern: row.pattern, headsign: row.headsign });
    }

    for (const row of all<{ stop: number; route: number; direction: number; headsign: string; trips: number }>(
      this.db,
      'SELECT stop, route, direction, headsign, trips FROM stop_routes ORDER BY trips DESC',
    )) {
      let list = this.stopRoutes.get(row.stop);
      if (!list) this.stopRoutes.set(row.stop, (list = []));
      list.push(row);
    }

    for (const row of all<{ from_stop: number; to_stop: number; min_seconds: number | null }>(
      this.db,
      'SELECT from_stop, to_stop, min_seconds FROM transfers',
    )) {
      this.transfers.set(`${row.from_stop}>${row.to_stop}`, row.min_seconds);
    }

    for (const row of all<{ id: number; days: number; start_date: number | null; end_date: number | null }>(
      this.db,
      'SELECT id, days, start_date, end_date FROM services',
    )) {
      this.services.set(row.id, { days: row.days, start: row.start_date, end: row.end_date });
    }
    for (const row of all<{ service: number; date: number; added: number }>(this.db, 'SELECT service, date, added FROM service_dates')) {
      let dates = this.serviceDates.get(row.service);
      if (!dates) this.serviceDates.set(row.service, (dates = new Map()));
      dates.set(row.date, row.added === 1);
    }
  }

  close() {
    this.db.close();
  }

  route(id: number) {
    const route = this.routes.get(id);
    if (!route) throw new Error(`No route ${id}`);
    return route;
  }

  stop(id: number) {
    const stop = this.stops.get(id);
    if (!stop) throw new Error(`No stop ${id}`);
    return stop;
  }

  // The stops a vehicle actually serves: a BART station's platforms, or the stop itself.
  boardingStops(stop: StopRow) {
    return stop.kind === 'station' ? (this.children.get(stop.id) ?? []).filter(({ kind }) => kind === 'platform') : [stop];
  }

  directionName(route: number, direction: number | null) {
    return direction === null ? null : (this.directionNames.get(`${route}|${direction}`) ?? null);
  }

  activeServices(date: number) {
    let active = this.activeByDate.get(date);
    if (active) return active;
    const day = weekday(date);
    active = [];
    for (const [id, service] of this.services) {
      const exception = this.serviceDates.get(id)?.get(date);
      const inCalendar = service.start !== null && service.end !== null && service.start <= date && date <= service.end && (service.days & (1 << day)) !== 0;
      if (exception ?? inCalendar) active.push(id);
    }
    this.activeByDate.set(date, active);
    return active;
  }

  // Scheduled trips of a pattern that leave `position` between two unix times, with their times
  // at `position` and each of `otherPositions`.
  scheduledTrips(pattern: PatternRow, position: number, from: number, to: number, otherPositions: number[] = []): ScheduledTrip[] {
    const results: ScheduledTrip[] = [];
    const route = this.route(pattern.route);
    // Trips after midnight belong to the previous service date, and a window near midnight
    // reaches into the next one.
    const today = serviceDate(from);
    for (const date of [addDays(today, -1), today, addDays(today, 1)]) {
      const dayStart = serviceDayStart(date);
      if (dayStart > to) continue;
      const services = this.activeServices(date);
      if (services.length === 0) continue;
      const rows = all<{ id: number; trip_id: string; arrival: number; departure: number }>(
        this.db,
        `SELECT t.id, t.trip_id, a.arrival, a.departure
         FROM trips t JOIN stop_times a ON a.trip = t.id AND a.position = ?
         WHERE t.pattern = ? AND a.departure BETWEEN ? AND ? AND t.service IN (SELECT value FROM json_each(?))`,
        position,
        pattern.id,
        from - dayStart,
        to - dayStart,
        JSON.stringify(services),
      );
      if (rows.length === 0) continue;
      const others = new Map<number, Map<number, { arrival: number; departure: number }>>();
      if (otherPositions.length > 0) {
        for (const row of all<{ trip: number; position: number; arrival: number; departure: number }>(
          this.db,
          `SELECT trip, position, arrival, departure FROM stop_times
           WHERE trip IN (SELECT value FROM json_each(?)) AND position IN (SELECT value FROM json_each(?))`,
          JSON.stringify(rows.map(({ id }) => id)),
          JSON.stringify(otherPositions),
        )) {
          let times = others.get(row.trip);
          if (!times) others.set(row.trip, (times = new Map()));
          times.set(row.position, { arrival: dayStart + row.arrival, departure: dayStart + row.departure });
        }
      }
      for (const row of rows) {
        const times = others.get(row.id) ?? new Map();
        times.set(position, { arrival: dayStart + row.arrival, departure: dayStart + row.departure });
        results.push({ tripRow: row.id, key: `${route.agency}:${row.trip_id}`, times });
      }
    }
    return results;
  }

  // A trip's scheduled time at one position, for filling a stop the realtime feed left out.
  scheduledTimeAt(tripRow: number, position: number, nearTime: number) {
    const row = get<{ arrival: number; departure: number }>(
      this.db,
      'SELECT arrival, departure FROM stop_times WHERE trip = ? AND position = ?',
      tripRow,
      position,
    );
    if (!row) return null;
    // The trip's service date is whichever puts the time closest to a time it is known to run near.
    const today = serviceDate(nearTime);
    let best: number | null = null;
    for (const date of [addDays(today, -1), today, addDays(today, 1)]) {
      const at = serviceDayStart(date) + row.arrival;
      if (best === null || Math.abs(at - nearTime) < Math.abs(best - nearTime)) best = at;
    }
    return best;
  }

  // The median minutes between scheduled departures at a stop for a set of patterns, around a
  // time, or null when fewer than two run.
  headwayMinutes(positions: { pattern: PatternRow; position: number }[], around: number) {
    const times = positions
      .flatMap(({ pattern, position }) => this.scheduledTrips(pattern, position, around - 1800, around + 5400))
      .map(({ times }) => [...times.values()][0]?.departure ?? 0)
      .sort((a, b) => a - b);
    const gaps = times.slice(1).map((time, i) => time - (times[i] ?? time)).filter((gap) => gap > 0);
    if (gaps.length === 0) return null;
    gaps.sort((a, b) => a - b);
    return (gaps[Math.floor(gaps.length / 2)] ?? 0) / 60;
  }
}
