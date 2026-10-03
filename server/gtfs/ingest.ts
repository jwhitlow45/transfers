import { unzipSync } from 'fflate';
import { rmSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { Agency } from '../config.ts';
import { SCHEMA, all } from '../db.ts';
import { bearingDegrees, encodePolyline, meanBearing } from '../geo.ts';
import { parseGtfsTime } from '../time.ts';
import { csvRecords } from './csv.ts';
import { searchText } from './search-text.ts';

const FILES = [
  'routes.txt',
  'directions.txt',
  'stops.txt',
  'calendar.txt',
  'calendar_dates.txt',
  'trips.txt',
  'stop_times.txt',
  'shapes.txt',
  'transfers.txt',
];

// Lines run with electric trolley coaches. This only picks the icon, so a line moving between
// coach types costs nothing worse than the wrong picture.
const MUNI_TROLLEY_LINES = new Set(['1', '5', '5R', '6', '14', '14R', '21', '22', '24', '30', '31', '33', '41', '45', '49']);

// Historic streetcar lines, which share route_type 0 with Muni Metro light rail.
const MUNI_STREETCAR_LINES = new Set(['F', 'E']);

export function unzipFeed(zip: Uint8Array) {
  const files = unzipSync(zip, { filter: ({ name }) => FILES.includes(name) });
  const decoder = new TextDecoder();
  return new Map(Object.entries(files).map(([name, bytes]) => [name, decoder.decode(bytes)]));
}

// Builds a fresh schedule database at `path` from each agency's unzipped GTFS files.
export function buildScheduleDatabase(feeds: Map<Agency, Map<string, string>>, path: string) {
  for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
  const db = new DatabaseSync(path);
  // The file is thrown away if the build fails, so durability during the build buys nothing.
  db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;');
  db.exec(SCHEMA);
  db.exec('BEGIN');
  try {
    for (const [agency, files] of feeds) loadAgency(db, agency, files);
    deriveStopRoutes(db);
    deriveBearings(db);
    deriveAccess(db);
    buildSearchIndex(db);
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('built_at', String(Math.floor(Date.now() / 1000)));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  db.exec('ANALYZE');
  db.close();
}

function loadAgency(db: DatabaseSync, agency: Agency, files: Map<string, string>) {
  const text = (name: string) => files.get(name) ?? '';
  const insertId = (statement: StatementSync, ...values: (string | number | null)[]) =>
    Number(statement.run(...values).lastInsertRowid);

  const routeIds = new Map<string, number>();
  const insertRoute = db.prepare(
    'INSERT INTO routes (agency, route_id, short_name, long_name, mode, color, text_color) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const route of csvRecords(text('routes.txt'), [
    'route_id',
    'route_short_name',
    'route_long_name',
    'route_type',
    'route_color',
    'route_text_color',
  ])) {
    const shortName = route.route_short_name || route.route_id;
    const mode = routeMode(agency, Number(route.route_type), shortName);
    const id = insertId(
      insertRoute,
      agency,
      route.route_id,
      shortName,
      route.route_long_name,
      mode,
      route.route_color || null,
      route.route_text_color || null,
    );
    routeIds.set(route.route_id, id);
  }

  const insertDirection = db.prepare('INSERT OR IGNORE INTO directions (route, direction, name) VALUES (?, ?, ?)');
  for (const row of csvRecords(text('directions.txt'), ['route_id', 'direction_id', 'direction'])) {
    const route = routeIds.get(row.route_id);
    if (route !== undefined && row.direction) insertDirection.run(route, Number(row.direction_id), row.direction);
  }

  const stopIds = new Map<string, number>();
  const parents: [number, string][] = [];
  const insertStop = db.prepare(
    'INSERT INTO stops (agency, stop_id, code, name, lat, lon, kind, wheelchair) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (const stop of csvRecords(text('stops.txt'), [
    'stop_id',
    'stop_code',
    'stop_name',
    'stop_lat',
    'stop_lon',
    'location_type',
    'parent_station',
    'wheelchair_boarding',
  ])) {
    const lat = Number(stop.stop_lat);
    const lon = Number(stop.stop_lon);
    if (!stop.stop_id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const kind = stopKind(stop.location_type, stop.parent_station);
    const id = insertId(
      insertStop,
      agency,
      stop.stop_id,
      stop.stop_code || null,
      stop.stop_name,
      lat,
      lon,
      kind,
      stop.wheelchair_boarding ? Number(stop.wheelchair_boarding) : null,
    );
    stopIds.set(stop.stop_id, id);
    if (stop.parent_station) parents.push([id, stop.parent_station]);
  }
  const setParent = db.prepare('UPDATE stops SET parent = ? WHERE id = ?');
  for (const [id, parentId] of parents) {
    const parent = stopIds.get(parentId);
    if (parent !== undefined) setParent.run(parent, id);
  }

  const serviceIds = new Map<string, number>();
  const serviceId = (id: string) => {
    let row = serviceIds.get(id);
    if (row === undefined) {
      row = insertId(db.prepare('INSERT INTO services (agency, service_id) VALUES (?, ?)'), agency, id);
      serviceIds.set(id, row);
    }
    return row;
  };
  const setCalendar = db.prepare('UPDATE services SET days = ?, start_date = ?, end_date = ? WHERE id = ?');
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
  for (const row of csvRecords(text('calendar.txt'), ['service_id', ...days, 'start_date', 'end_date'])) {
    const mask = days.reduce((bits, day, bit) => (row[day] === '1' ? bits | (1 << bit) : bits), 0);
    setCalendar.run(mask, Number(row.start_date), Number(row.end_date), serviceId(row.service_id));
  }
  const insertDate = db.prepare('INSERT OR REPLACE INTO service_dates (service, date, added) VALUES (?, ?, ?)');
  for (const row of csvRecords(text('calendar_dates.txt'), ['service_id', 'date', 'exception_type'])) {
    insertDate.run(serviceId(row.service_id), Number(row.date), row.exception_type === '1' ? 1 : 0);
  }

  const shapeIds = new Map<string, number>();
  const shapePoints = new Map<string, { sequence: number; lat: number; lon: number }[]>();
  for (const row of csvRecords(text('shapes.txt'), ['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence'])) {
    let points = shapePoints.get(row.shape_id);
    if (!points) shapePoints.set(row.shape_id, (points = []));
    points.push({ sequence: Number(row.shape_pt_sequence), lat: Number(row.shape_pt_lat), lon: Number(row.shape_pt_lon) });
  }
  const insertShape = db.prepare('INSERT INTO shapes (agency, shape_id, polyline) VALUES (?, ?, ?)');
  for (const [id, points] of shapePoints) {
    points.sort((a, b) => a.sequence - b.sequence);
    shapeIds.set(id, insertId(insertShape, agency, id, encodePolyline(points)));
  }

  type TripInfo = { route: number; service: number; direction: number | null; headsign: string; shape: number | null };
  const trips = new Map<string, TripInfo>();
  for (const row of csvRecords(text('trips.txt'), ['trip_id', 'route_id', 'service_id', 'direction_id', 'trip_headsign', 'shape_id'])) {
    const route = routeIds.get(row.route_id);
    if (route === undefined) continue;
    trips.set(row.trip_id, {
      route,
      service: serviceId(row.service_id),
      direction: row.direction_id === '' ? null : Number(row.direction_id),
      headsign: row.trip_headsign,
      shape: shapeIds.get(row.shape_id) ?? null,
    });
  }

  // Stop times are usually grouped by trip but GTFS does not promise it, so they are gathered
  // per trip as flat number arrays (sequence, stop, arrival, departure) and sorted afterward.
  const tripStopTimes = new Map<string, number[]>();
  for (const row of csvRecords(text('stop_times.txt'), ['trip_id', 'stop_sequence', 'stop_id', 'arrival_time', 'departure_time'])) {
    const stop = stopIds.get(row.stop_id);
    const arrival = parseGtfsTime(row.arrival_time);
    const departure = parseGtfsTime(row.departure_time);
    if (stop === undefined || (arrival === null && departure === null)) continue;
    let times = tripStopTimes.get(row.trip_id);
    if (!times) tripStopTimes.set(row.trip_id, (times = []));
    times.push(Number(row.stop_sequence), stop, arrival ?? departure ?? 0, departure ?? arrival ?? 0);
  }

  const patternIds = new Map<string, { id: number; trips: number }>();
  const insertPattern = db.prepare(
    'INSERT INTO patterns (route, direction, headsign, shape, length, trips) VALUES (?, ?, ?, ?, ?, 0)',
  );
  const insertPatternStop = db.prepare('INSERT INTO pattern_stops (pattern, position, stop) VALUES (?, ?, ?)');
  const insertTrip = db.prepare('INSERT INTO trips (agency, trip_id, pattern, service, headsign) VALUES (?, ?, ?, ?, ?)');
  const insertStopTime = db.prepare(
    'INSERT INTO stop_times (trip, position, stop, arrival, departure) VALUES (?, ?, ?, ?, ?)',
  );
  for (const [tripId, flat] of tripStopTimes) {
    const trip = trips.get(tripId);
    if (!trip) continue;
    const rows: { sequence: number; stop: number; arrival: number; departure: number }[] = [];
    for (let i = 0; i < flat.length; i += 4) {
      rows.push({ sequence: flat[i]!, stop: flat[i + 1]!, arrival: flat[i + 2]!, departure: flat[i + 3]! });
    }
    rows.sort((a, b) => a.sequence - b.sequence);
    const key = `${trip.route}|${trip.direction}|${rows.map(({ stop }) => stop).join(',')}`;
    let pattern = patternIds.get(key);
    if (!pattern) {
      const id = insertId(insertPattern, trip.route, trip.direction, trip.headsign, trip.shape, rows.length);
      for (const [position, { stop }] of rows.entries()) insertPatternStop.run(id, position, stop);
      patternIds.set(key, (pattern = { id, trips: 0 }));
    }
    pattern.trips++;
    const tripRow = insertId(insertTrip, agency, tripId, pattern.id, trip.service, trip.headsign);
    for (const [position, { stop, arrival, departure }] of rows.entries()) {
      insertStopTime.run(tripRow, position, stop, arrival, departure);
    }
  }
  const setPatternTrips = db.prepare('UPDATE patterns SET trips = ? WHERE id = ?');
  for (const { id, trips } of patternIds.values()) setPatternTrips.run(trips, id);

  const insertTransfer = db.prepare(
    'INSERT INTO transfers (from_stop, to_stop, from_route, to_route, type, min_seconds) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const row of csvRecords(text('transfers.txt'), [
    'from_stop_id',
    'to_stop_id',
    'from_route_id',
    'to_route_id',
    'transfer_type',
    'min_transfer_time',
  ])) {
    const from = stopIds.get(row.from_stop_id);
    const to = stopIds.get(row.to_stop_id);
    if (from === undefined || to === undefined) continue;
    insertTransfer.run(
      from,
      to,
      routeIds.get(row.from_route_id) ?? null,
      routeIds.get(row.to_route_id) ?? null,
      Number(row.transfer_type || 0),
      row.min_transfer_time ? Number(row.min_transfer_time) : null,
    );
  }
}

function routeMode(agency: Agency, type: number, shortName: string) {
  if (agency === 'BA') return 'bart';
  if (type === 4) return 'ferry';
  if (type === 5) return 'cable-car';
  if (type === 0) return agency === 'SF' && MUNI_STREETCAR_LINES.has(shortName) ? 'streetcar' : 'light-rail';
  if (type === 11 || (agency === 'SF' && MUNI_TROLLEY_LINES.has(shortName))) return 'trolleybus';
  return 'bus';
}

function stopKind(locationType: string, parent: string) {
  switch (locationType) {
    case '1':
      return 'station';
    case '2':
      return 'entrance';
    case '3':
    case '4':
      return 'other';
    default:
      return parent ? 'platform' : 'stop';
  }
}

function deriveStopRoutes(db: DatabaseSync) {
  // A pattern's last stop only lets riders off, so it does not count as served there.
  db.exec(`
    INSERT INTO stop_routes (stop, route, direction, headsign, trips)
    SELECT ps.stop, p.route, COALESCE(p.direction, -1), p.headsign, SUM(p.trips)
    FROM pattern_stops ps JOIN patterns p ON p.id = ps.pattern
    WHERE ps.position < p.length - 1
    GROUP BY ps.stop, p.route, COALESCE(p.direction, -1), p.headsign;

    INSERT INTO stop_routes (stop, route, direction, headsign, trips)
    SELECT s.parent, sr.route, sr.direction, sr.headsign, SUM(sr.trips)
    FROM stop_routes sr JOIN stops s ON s.id = sr.stop
    WHERE s.parent IS NOT NULL
    GROUP BY s.parent, sr.route, sr.direction, sr.headsign;
  `);
}

function deriveBearings(db: DatabaseSync) {
  const rows = all<{ pattern: number; position: number; trips: number; lat: number; lon: number; stop: number }>(
    db,
    `SELECT ps.pattern, ps.position, p.trips, s.lat, s.lon, s.id AS stop
     FROM pattern_stops ps JOIN patterns p ON p.id = ps.pattern JOIN stops s ON s.id = ps.stop
     ORDER BY ps.pattern, ps.position`,
  );
  const bearings = new Map<number, { degrees: number; weight: number }[]>();
  for (const [i, row] of rows.entries()) {
    const next = rows[i + 1]?.pattern === row.pattern ? rows[i + 1] : undefined;
    const previous = rows[i - 1]?.pattern === row.pattern ? rows[i - 1] : undefined;
    const [from, to] = next ? [row, next] : previous ? [previous, row] : [undefined, undefined];
    if (!from || !to || (from.lat === to.lat && from.lon === to.lon)) continue;
    let list = bearings.get(row.stop);
    if (!list) bearings.set(row.stop, (list = []));
    list.push({ degrees: bearingDegrees(from, to), weight: row.trips });
  }
  const setBearing = db.prepare('UPDATE stops SET bearing = ? WHERE id = ?');
  for (const [stop, list] of bearings) setBearing.run(meanBearing(list), stop);
}

function deriveAccess(db: DatabaseSync) {
  db.exec(`
    UPDATE stops SET access = 'bart' WHERE agency = 'BA' AND kind IN ('station', 'platform');

    -- Muni Metro's underground platforms have no parent station in the feed, only names such
    -- as "Forest Hill Station Outbound". Caltrain stations served by the T are on the street.
    UPDATE stops SET access = 'subway'
    WHERE agency = 'SF' AND name LIKE '%Station%' AND name NOT LIKE '%Caltrain%'
      AND EXISTS (
        SELECT 1 FROM stop_routes sr JOIN routes r ON r.id = sr.route
        WHERE sr.stop = stops.id AND r.mode = 'light-rail'
      );

    UPDATE stops SET access = 'ferry'
    WHERE EXISTS (SELECT 1 FROM stop_routes sr JOIN routes r ON r.id = sr.route WHERE sr.stop = stops.id AND r.mode = 'ferry')
      AND NOT EXISTS (SELECT 1 FROM stop_routes sr JOIN routes r ON r.id = sr.route WHERE sr.stop = stops.id AND r.mode <> 'ferry');
  `);
}

// Riders search BART by station, since platforms only differ by direction and the transfer
// lookup works out which one. Golden Gate also wraps most bus stops in a station, but riders know
// the bus stop's code from the sign, so everywhere else the boarding stop itself is searchable.
function buildSearchIndex(db: DatabaseSync) {
  const rows = all<{ id: number; name: string; code: string | null; routes: string }>(
    db,
    `SELECT s.id, s.name, s.code, group_concat(DISTINCT r.short_name) AS routes
     FROM stops s JOIN stop_routes sr ON sr.stop = s.id JOIN routes r ON r.id = sr.route
     WHERE (s.kind = 'station' AND s.access = 'bart') OR s.kind = 'stop' OR (s.kind = 'platform' AND s.access <> 'bart')
     GROUP BY s.id`,
  );
  const insert = db.prepare('INSERT INTO stop_search (rowid, name, code, routes) VALUES (?, ?, ?, ?)');
  for (const row of rows) {
    insert.run(row.id, searchText(row.name), row.code ?? '', searchText(row.routes.replaceAll(',', ' ')));
  }
}
