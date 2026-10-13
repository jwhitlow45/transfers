import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { search } from '../api/search.ts';
import type { Agency } from '../config.ts';
import type { Schedule } from '../schedule.ts';
import { CALENDAR, buildSchedule, files } from '../test-gtfs.ts';
import { type OsmElement, buildPlaces, buildPlacesDatabase, fetchPlaces, placesFrom } from './ingest.ts';
import { Places } from './store.ts';

// Two stops in the Mission, and places as Overpass sends them: a node, a way with its center, one
// with nothing anyone sets out for, one far from any stop, and two Philz, one in the Mission and
// one downtown.
const stops = [
  { lat: 37.752178, lon: -122.41855 },
  { lat: 37.7647, lon: -122.4199 },
  { lat: 37.7894, lon: -122.4016 },
];
const elements: OsmElement[] = [
  { type: 'node', id: 1, lat: 37.7525, lon: -122.4182, tags: { name: 'Philz Coffee', amenity: 'cafe', brand: 'Philz Coffee', 'addr:housenumber': '3101', 'addr:street': '24th Street' } },
  { type: 'way', id: 2, center: { lat: 37.7596, lon: -122.4269 }, tags: { name: 'Mission Dolores Park', leisure: 'park', wikidata: 'Q1932432' } },
  { type: 'node', id: 3, lat: 37.7646, lon: -122.4197, tags: { name: 'Valencia Garage', amenity: 'parking' } },
  { type: 'node', id: 4, lat: 37.9, lon: -122.6, tags: { name: 'Faraway Café', amenity: 'cafe' } },
  { type: 'node', id: 5, lat: 37.7648, lon: -122.42, tags: { name: 'Mission Pie', shop: 'bakery' } },
  { type: 'node', id: 6, lat: 37.7649, lon: -122.4201, tags: { name: 'Café de Mission', amenity: 'fast_food' } },
  { type: 'node', id: 7, lat: 37.7893, lon: -122.4015, tags: { name: 'Philz Coffee', amenity: 'cafe', brand: 'Philz Coffee' } },
  { type: 'way', id: 8, center: { lat: 37.7857, lon: -122.4011 }, tags: { name: 'San Francisco Museum of Modern Art', short_name: 'SFMOMA', tourism: 'museum' } },
];

// One street stop for search to find among the places.
let schedule: Schedule;
let places: Places;
before(() => {
  schedule = buildSchedule(
    new Map<Agency, Map<string, string>>([
      [
        'SF',
        files({
          'routes.txt': 'route_id,route_short_name,route_long_name,route_type\n48,48,QUINTARA/24TH STREET,3\n',
          'stops.txt': 'stop_id,stop_code,stop_name,stop_lat,stop_lon\n13477,13477,24th St & Mission St,37.752178,-122.41855\n13500,13500,24th St & Potrero Ave,37.752900,-122.406500\n',
          'calendar.txt': CALENDAR,
          'trips.txt': 'route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id\n48,all,m0,22nd St + Iowa St,1,,\n',
          'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nm0,8:00:00,8:00:00,13477,1\nm0,8:10:00,8:10:00,13500,2\n',
        }),
      ],
    ]),
  );
  const path = join(mkdtempSync(join(tmpdir(), 'places-')), 'places.db');
  buildPlacesDatabase(placesFrom(elements, stops), path);
  places = new Places(path);
});
after(() => {
  schedule.close();
  places.close();
});

test('places come from named things a rider sets out for, near a stop, each once', () => {
  const rows = placesFrom([...elements, elements[0]!], stops);
  deepStrictEqual(rows.map(({ id, kind }) => `${id} ${kind}`).sort(), ['n1 Cafe', 'n5 Bakery', 'n6 Fast food', 'n7 Cafe', 'w2 Park', 'w8 Museum']);
  strictEqual(rows.find(({ id }) => id === 'n1')?.street, '3101 24th Street');
});

test('search matches words as typed, accents or not, the better known first', () => {
  deepStrictEqual(places.search('philz cof', undefined, 5).map(({ id }) => id).sort(), ['n1', 'n7']);
  deepStrictEqual(places.search('cafe de', undefined, 5).map(({ name }) => name), ['Café de Mission']);
  // The park is a landmark, so it leads the places named for the Mission.
  strictEqual(places.search('mission', undefined, 5)[0]?.name, 'Mission Dolores Park');
  deepStrictEqual(places.search('bakery', undefined, 5).map(({ name }) => name), ['Mission Pie']);
  // A place answers to the other names it goes by, though it shows by its own.
  deepStrictEqual(places.search('sfmoma', undefined, 5).map(({ name }) => name), ['San Francisco Museum of Modern Art']);
  // Streets are for stops: a shop on 24th Street is not what "24th" means.
  deepStrictEqual(places.search('24th', undefined, 5), []);
  strictEqual(places.get('w2')?.name, 'Mission Dolores Park');
  strictEqual(places.get('w9'), null);
  deepStrictEqual(places.search('  ', undefined, 5), []);
});

test('search results list places too, the nearer first among matches as good', () => {
  const mission = { lat: 37.7522, lon: -122.4186 };
  const downtown = { lat: 37.7894, lon: -122.4016 };
  const found = (near: { lat: number; lon: number }) => search(schedule, 'philz', { routes: true, near, places }).places?.map(({ id }) => id);
  deepStrictEqual(found(mission), ['n1', 'n7']);
  deepStrictEqual(found(downtown), ['n7', 'n1']);
  // Stops still come first, and without a place list, or with a letter or two, no places.
  const both = search(schedule, 'mission', { routes: true, places });
  deepStrictEqual([both.results[0]?.type, both.places?.[0]?.name], ['stop', 'Mission Dolores Park']);
  strictEqual(search(schedule, 'philz', { routes: true }).places, undefined);
  strictEqual(search(schedule, 'ph', { routes: true, places }).places, undefined);
});

test('a busy server hands the tile to the next, fetched tiles are kept for a rerun, and a tile none answer is named', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'places-')), 'places.db');
  // Stops in two tiles: the Mission, and downtown San Jose.
  const twoTiles = [stops[0]!, { lat: 37.33, lon: -121.89 }];
  const asked: string[] = [];
  const sanJose = (body: string) => decodeURIComponent(body).includes('37.25,-122,');
  let busy = true;
  const fetcher = (async (url: string, init: { body: string }) => {
    asked.push(new URL(url).host);
    if (url.includes('overpass-api.de')) return new Response('busy', { status: 504 });
    if (sanJose(init.body) && busy) return new Response('busy', { status: 429 });
    return Response.json({ elements: [elements[0]] });
  }) as unknown as typeof fetch;
  const first = await buildPlaces(twoTiles, path, { fetcher, pause: 0 });
  deepStrictEqual([first.count, first.missing], [1, ['37.25,-122,37.5,-121.75']]);
  strictEqual(asked.slice(0, 2).join(), 'overpass-api.de,overpass.private.coffee');
  // What it found is searchable, and the tiles wait for the next build.
  const built = new Places(path);
  strictEqual(built.get('n1')?.name, 'Philz Coffee');
  built.close();
  strictEqual(existsSync(`${path}.tiles`), true);
  // Again: the Mission's tile comes from the cache, and only San Jose's is asked for, of each
  // server three times while they stay busy.
  asked.length = 0;
  const again = await fetchPlaces(twoTiles, { cacheDir: `${path}.tiles`, fetcher, pause: 0 });
  deepStrictEqual([again.elements.length, asked.length], [1, 6]);
  // Once every tile is in, the cache goes.
  busy = false;
  deepStrictEqual((await buildPlaces(twoTiles, path, { fetcher, pause: 0 })).missing, []);
  strictEqual(existsSync(`${path}.tiles`), false);
});

test('an answer a server cut short, out of time or memory, is no answer, and the next server is asked', async () => {
  const cacheDir = () => join(mkdtempSync(join(tmpdir(), 'places-')), 'places.db.tiles');
  const cutShort = { remark: 'runtime error: Query timed out in "query" at line 1 after 181 seconds.', elements: [elements[0]] };
  let whole = true;
  const fetcher = (async (url: string) => (url.includes('overpass-api.de') || !whole ? Response.json(cutShort) : Response.json({ elements: elements.slice(0, 2) }))) as unknown as typeof fetch;
  const found = await fetchPlaces([stops[0]!], { cacheDir: cacheDir(), fetcher, pause: 0 });
  deepStrictEqual([found.elements.length, found.missing], [2, []]);
  whole = false;
  const none = await fetchPlaces([stops[0]!], { cacheDir: cacheDir(), fetcher, pause: 0 });
  deepStrictEqual([none.elements.length, none.missing.length], [0, 1]);
});
