import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { distanceMeters, type Point, pointGrid } from '../geo.ts';
import { searchText } from '../gtfs/search-text.ts';

// Places a rider might go to, such as shops, restaurants, parks and museums, from OpenStreetMap
// (© OpenStreetMap contributors, under the ODbL, which the page credits). Fetched from the Overpass
// API a tile at a time, about once a week, which keeps well inside its usage policy.

// The main public Overpass server, then another that welcomes the same use, tried in turn when
// one is too busy to answer. docker/squid.conf lets the server reach these and no others.
const OVERPASS_URLS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
// Overpass asks clients to say who they are, and turns away requests that do not.
const USER_AGENT = 'Transfers (transfers.gerbil-porgy.cc)';
// The query's own limit, with a little more for the answer to arrive. A server that never
// answers would otherwise hold the build forever.
const QUERY_SECONDS = 180;
const ANSWER_MS = (QUERY_SECONDS + 30) * 1000;
const TILE_DEGREES = 0.25;
// Places this far from every stop are no use to a transit rider.
const NEAR_STOP_METERS = 1500;
const KEYS = ['amenity', 'shop', 'tourism', 'leisure', 'office', 'historic', 'healthcare', 'craft'] as const;
// Things with names that no one sets out for.
const SKIPPED = new Set([
  'parking',
  'parking_space',
  'parking_entrance',
  'bicycle_parking',
  'motorcycle_parking',
  'bench',
  'waste_basket',
  'waste_disposal',
  'recycling',
  'vending_machine',
  'telephone',
  'post_box',
  'drinking_water',
  'shelter',
  'toilets',
  'clock',
  'loading_dock',
  'grit_bin',
  'bbq',
  'charging_station',
  'bicycle_rental',
  'atm',
  'fountain',
  'picnic_table',
  'pitch',
  'swimming_pool',
  'playground',
  'garden',
  'information',
  'public_bookcase',
  'taxi',
  'outdoor_seating',
  'fitness_station',
  'parcel_locker',
  'yes',
]);
// Other names a place goes by, which search finds it by too: "SFMOMA" for the San Francisco Museum
// of Modern Art.
const OTHER_NAMES = ['short_name', 'alt_name', 'official_name'] as const;

export type OsmElement = { type: 'node' | 'way' | 'relation'; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

// `fame` is how likely a rider means this place among others matching as well, from 0 to 3.
export type PlaceRow = { id: string; name: string; otherNames: string; kind: string; street: string | null; lat: number; lon: number; fame: number };

type FetchOptions = { fetcher?: typeof fetch; log?: (line: string) => void; pause?: number };

// Builds the places database at `path` from the tiles around the stops, swapping it in whole so a
// reader never sees one half built. Each tile is kept beside it once fetched, until a build has
// every tile, so a build that stops partway, as when every server is busy, picks up where it left
// off. A tile no server answers for is left out and named in `missing`.
export async function buildPlaces(stops: Point[], path: string, options: FetchOptions = {}) {
  const cacheDir = `${path}.tiles`;
  const { elements, missing } = await fetchPlaces(stops, { ...options, cacheDir });
  const places = placesFrom(elements, stops);
  const temporary = `${path}.new`;
  buildPlacesDatabase(places, temporary, missing.length);
  renameSync(temporary, path);
  if (missing.length === 0) rmSync(cacheDir, { recursive: true, force: true });
  return { count: places.length, missing };
}

// Every named place in the tiles around the stops, fetched one tile at a time, or read from
// `cacheDir` where an earlier build fetched it.
export async function fetchPlaces(stops: Point[], options: FetchOptions & { cacheDir: string }) {
  const { cacheDir, fetcher = fetch, log = () => {}, pause = 5000 } = options;
  mkdirSync(cacheDir, { recursive: true });
  const tiles = [...new Set(stops.map(({ lat, lon }) => `${Math.floor(lat / TILE_DEGREES)}_${Math.floor(lon / TILE_DEGREES)}`))];
  const elements: OsmElement[] = [];
  const missing: string[] = [];
  for (const [index, tile] of tiles.entries()) {
    const [row, column] = tile.split('_').map(Number) as [number, number];
    const box = `${row * TILE_DEGREES},${column * TILE_DEGREES},${(row + 1) * TILE_DEGREES},${(column + 1) * TILE_DEGREES}`;
    const cached = join(cacheDir, `${tile}.json`);
    if (existsSync(cached)) {
      elements.push(...(JSON.parse(readFileSync(cached, 'utf8')) as OsmElement[]));
      continue;
    }
    const query = `[out:json][timeout:${QUERY_SECONDS}];(${KEYS.map((key) => `nwr["name"]["${key}"](${box});`).join('')});out center tags;`;
    const fetched = await fetchTile(fetcher, query, pause);
    if (fetched) {
      writeFileSync(cached, JSON.stringify(fetched));
      elements.push(...fetched);
      log(`Tile ${index + 1} of ${tiles.length}: ${fetched.length} places`);
    } else {
      missing.push(box);
      log(`Tile ${index + 1} of ${tiles.length}: no server answered`);
    }
    // One tile at a time, with a pause, as Overpass asks of bulk use.
    await new Promise((resolve) => setTimeout(resolve, pause));
  }
  return { elements, missing };
}

// One tile from the first server that answers, giving each a few tries when busy.
async function fetchTile(fetcher: typeof fetch, query: string, pause: number) {
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of OVERPASS_URLS) {
      try {
        const response = await fetcher(url, {
          method: 'POST',
          headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(ANSWER_MS),
        });
        if (!response.ok) continue;
        const answer = (await response.json()) as { elements: OsmElement[]; remark?: string };
        // A query that ran out of time or memory still answers, with what it found so far and a
        // remark that says so.
        if (!answer.remark?.includes('runtime error')) return answer.elements;
      } catch {
        // A server down, a dropped connection, or no answer in time: the next one may answer.
      }
    }
    // Every one busy: wait longer each round before asking again.
    await new Promise((resolve) => setTimeout(resolve, pause * 6 * (attempt + 1)));
  }
  return null;
}

// The places worth searching, each once, near enough to a stop to reach by transit.
export function placesFrom(elements: OsmElement[], stops: Point[]): PlaceRow[] {
  const around = pointGrid(stops, NEAR_STOP_METERS);
  const near = (point: Point) => around(point).some((stop) => distanceMeters(stop, point) <= NEAR_STOP_METERS);
  const rows = new Map<string, PlaceRow>();
  for (const element of elements) {
    const tags = element.tags ?? {};
    const point = element.center ?? (element.lat !== undefined && element.lon !== undefined ? { lat: element.lat, lon: element.lon } : null);
    const name = tags.name?.trim();
    const key = KEYS.find((candidate) => tags[candidate] && !SKIPPED.has(tags[candidate]!));
    if (!point || !name || !key || !near(point)) continue;
    const id = `${element.type[0]}${element.id}`;
    const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ') || null;
    // OpenStreetMap separates several names with semicolons.
    const otherNames = OTHER_NAMES.flatMap((tag) => tags[tag]?.split(';') ?? []).join(' ');
    rows.set(id, { id, name, otherNames, kind: kindName(tags[key]!), street, lat: point.lat, lon: point.lon, fame: fameOf(key, tags) });
  }
  return [...rows.values()];
}

// "fast_food" reads "Fast food".
function kindName(value: string) {
  const words = value.split(';')[0]!.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Landmarks and places that draw crowds before a corner shop.
function fameOf(key: (typeof KEYS)[number], tags: Record<string, string>) {
  if (tags.wikidata || tags.wikipedia) return 3;
  if (key === 'tourism' || key === 'historic' || tags.amenity === 'university' || tags.amenity === 'hospital' || tags.leisure === 'park' || tags.leisure === 'stadium') return 2;
  return tags.brand ? 1 : 0;
}

// The search index holds names as stop names are held (see searchText), so "Café" answers to
// "cafe". It leaves out streets: a rider typing "24th st" wants the stops there, not every shop.
// `missing` counts the tiles no server answered for, so the store tries again soon.
export function buildPlacesDatabase(places: PlaceRow[], path: string, missing = 0) {
  rmSync(path, { force: true });
  const db = new DatabaseSync(path);
  try {
    // The file is thrown away if the build fails, as the schedule's is.
    db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;');
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE places (row INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, kind TEXT NOT NULL, street TEXT, lat REAL NOT NULL, lon REAL NOT NULL, fame INTEGER NOT NULL);
      CREATE INDEX places_lat ON places (lat);
      CREATE VIRTUAL TABLE place_search USING fts5 (name, other_names, kind, content = '', tokenize = 'unicode61 remove_diacritics 2', prefix = '1 2 3');
    `);
    const insert = db.prepare('INSERT INTO places (id, name, kind, street, lat, lon, fame) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const index = db.prepare('INSERT INTO place_search (rowid, name, other_names, kind) VALUES (?, ?, ?, ?)');
    db.exec('BEGIN');
    for (const { id, name, otherNames, kind, street, lat, lon, fame } of places) {
      const { lastInsertRowid } = insert.run(id, name, kind, street, lat, lon, fame);
      index.run(lastInsertRowid, searchText(name), searchText(otherNames), searchText(kind));
    }
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('built_at', String(Math.floor(Date.now() / 1000)));
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('missing', String(missing));
    db.exec('COMMIT');
  } finally {
    db.close();
  }
}
