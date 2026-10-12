// Builds the places database from OpenStreetMap through the Overpass API, for development, where
// a server restarted often never builds it on its own: node server/places/ingest-cli.ts
// [schedule.db] [places.db]
import { join } from 'node:path';
import { config } from '../config.ts';
import { Schedule } from '../schedule.ts';
import { buildPlaces } from './ingest.ts';

const [schedulePath = join(config.dataDir, 'schedule.db'), out = join(config.dataDir, 'places.db')] = process.argv.slice(2);
const started = performance.now();
const schedule = new Schedule(schedulePath);
const stops = [...schedule.patternsByStop.keys()].map((id) => schedule.stop(id));
schedule.close();
const { count, missing } = await buildPlaces(stops, out, { log: console.log });
console.log(`Built ${out} with ${count} places in ${((performance.now() - started) / 1000).toFixed(0)} s${missing.length ? `. No server answered for ${missing.join('; ')}: run this again to fetch them` : ''}`);
