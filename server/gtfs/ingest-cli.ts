// Builds the schedule database from GTFS zips on disk, for development without spending
// 511 requests: node server/gtfs/ingest-cli.ts <dir with SF.zip, BA.zip, ...> [out.db]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENCIES, config } from '../config.ts';
import { buildScheduleDatabase, unzipFeed } from './ingest.ts';

const [dir, out = join(config.dataDir, 'schedule.db')] = process.argv.slice(2);
if (!dir) {
  console.error('Usage: node server/gtfs/ingest-cli.ts <dir with SF.zip, BA.zip, SM.zip, GG.zip, GF.zip> [out.db]');
  process.exit(1);
}
const started = performance.now();
const feeds = new Map(AGENCIES.map((agency) => [agency, unzipFeed(readFileSync(join(dir, `${agency}.zip`)))]));
buildScheduleDatabase(feeds, out);
console.log(`Built ${out} in ${((performance.now() - started) / 1000).toFixed(1)} s`);
