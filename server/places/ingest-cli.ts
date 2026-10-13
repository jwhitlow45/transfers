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
const { count, missing, stale, kept } = await buildPlaces(stops, out, { log: console.log });
const seconds = ((performance.now() - started) / 1000).toFixed(0);
console.log(kept ? `Kept the places already in ${out}, which has tiles this build lacks, after ${seconds} s` : `Built ${out} with ${count} places in ${seconds} s`);
if (missing.length > 0) console.log(`No server answered for ${missing.join('; ')}: run this again to fetch them`);
if (stale.length > 0) console.log(`No server answered for ${stale.join('; ')}, so their last answers stand: run this again to refresh them`);
