import { DatabaseSync } from 'node:sqlite';

// The schedule database is rebuilt from scratch each day and swapped in whole, so the schema
// carries no migrations. Ids are integer row ids. Each agency's own ids stay in the *_id columns.
//
// Times in stop_times are seconds from the service day's start (see serviceDayStart), and can
// pass 24 hours. Positions count each pattern's stops from 0 in order.
export const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE routes (
  id INTEGER PRIMARY KEY,
  agency TEXT NOT NULL,
  route_id TEXT NOT NULL,
  short_name TEXT NOT NULL,
  long_name TEXT NOT NULL,
  mode TEXT NOT NULL,
  color TEXT,
  text_color TEXT,
  UNIQUE (agency, route_id)
);

-- Names such as Inbound and Outbound, where the agency publishes them.
CREATE TABLE directions (
  route INTEGER NOT NULL,
  direction INTEGER NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (route, direction)
) WITHOUT ROWID;

-- kind: stop, station, platform (a stop inside a station), entrance, or other.
-- access: how a rider reaches the vehicle, which sets transfer time. bart, subway, ferry, or street.
-- bearing: compass degrees vehicles leave the stop toward, for labels such as Eastbound.
CREATE TABLE stops (
  id INTEGER PRIMARY KEY,
  agency TEXT NOT NULL,
  stop_id TEXT NOT NULL,
  code TEXT,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  kind TEXT NOT NULL,
  parent INTEGER,
  access TEXT NOT NULL DEFAULT 'street',
  bearing REAL,
  wheelchair INTEGER,
  UNIQUE (agency, stop_id)
);
CREATE INDEX stops_lat ON stops (lat);
CREATE INDEX stops_parent ON stops (parent);
CREATE INDEX stops_code ON stops (code);

CREATE TABLE services (
  id INTEGER PRIMARY KEY,
  agency TEXT NOT NULL,
  service_id TEXT NOT NULL,
  -- Bit 0 is Sunday.
  days INTEGER NOT NULL DEFAULT 0,
  start_date INTEGER,
  end_date INTEGER,
  UNIQUE (agency, service_id)
);
CREATE TABLE service_dates (
  service INTEGER NOT NULL,
  date INTEGER NOT NULL,
  added INTEGER NOT NULL,
  PRIMARY KEY (service, date)
) WITHOUT ROWID;

-- Trips that visit the same stops in the same order share a pattern.
CREATE TABLE patterns (
  id INTEGER PRIMARY KEY,
  route INTEGER NOT NULL,
  direction INTEGER,
  headsign TEXT NOT NULL,
  shape INTEGER,
  length INTEGER NOT NULL,
  trips INTEGER NOT NULL
);
CREATE TABLE pattern_stops (
  pattern INTEGER NOT NULL,
  position INTEGER NOT NULL,
  stop INTEGER NOT NULL,
  PRIMARY KEY (pattern, position)
) WITHOUT ROWID;
CREATE INDEX pattern_stops_stop ON pattern_stops (stop);

CREATE TABLE trips (
  id INTEGER PRIMARY KEY,
  agency TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  pattern INTEGER NOT NULL,
  service INTEGER NOT NULL,
  headsign TEXT NOT NULL,
  UNIQUE (agency, trip_id)
);
CREATE INDEX trips_pattern ON trips (pattern, service);

CREATE TABLE stop_times (
  trip INTEGER NOT NULL,
  position INTEGER NOT NULL,
  stop INTEGER NOT NULL,
  arrival INTEGER NOT NULL,
  departure INTEGER NOT NULL,
  PRIMARY KEY (trip, position)
) WITHOUT ROWID;
CREATE INDEX stop_times_stop ON stop_times (stop, departure);

-- Google encoded polylines, precision 5.
CREATE TABLE shapes (
  id INTEGER PRIMARY KEY,
  agency TEXT NOT NULL,
  shape_id TEXT NOT NULL,
  polyline TEXT NOT NULL,
  UNIQUE (agency, shape_id)
);

CREATE TABLE transfers (
  from_stop INTEGER NOT NULL,
  to_stop INTEGER NOT NULL,
  from_route INTEGER,
  to_route INTEGER,
  type INTEGER NOT NULL,
  min_seconds INTEGER
);
CREATE INDEX transfers_from ON transfers (from_stop);

-- Which routes, directions, and headsigns serve each stop, for search results and grouping.
CREATE TABLE stop_routes (
  stop INTEGER NOT NULL,
  route INTEGER NOT NULL,
  direction INTEGER NOT NULL,
  headsign TEXT NOT NULL,
  trips INTEGER NOT NULL,
  PRIMARY KEY (stop, route, direction, headsign)
) WITHOUT ROWID;
CREATE INDEX stop_routes_route ON stop_routes (route);

-- Stops and stations riders can search for, keyed by stops.id.
CREATE VIRTUAL TABLE stop_search USING fts5 (
  name, code, routes,
  content = '',
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '1 2 3'
);
`;

export function openDatabase(path: string, options: { readOnly?: boolean } = {}) {
  const db = new DatabaseSync(path, { readOnly: options.readOnly ?? false });
  if (!options.readOnly) db.exec('PRAGMA journal_mode = WAL');
  return db;
}

// Typed wrappers so call sites name the row shape once.
export function all<Row>(db: DatabaseSync, sql: string, ...params: SqlParam[]) {
  return db.prepare(sql).all(...params) as Row[];
}

export function get<Row>(db: DatabaseSync, sql: string, ...params: SqlParam[]) {
  return db.prepare(sql).get(...params) as Row | undefined;
}

export type SqlParam = string | number | bigint | null | Uint8Array;
