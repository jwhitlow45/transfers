import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { AGENCIES, type Agency } from './config.ts';
import { buildScheduleDatabase, unzipFeed } from './gtfs/ingest.ts';
import type { KeyPool } from './realtime/keys.ts';
import { Schedule } from './schedule.ts';
import { nowSeconds, zonedParts } from './time.ts';

const MAX_AGE_SECONDS = 24 * 3600;
// Agencies publish schedule changes overnight, and few riders are out at 3:30 AM.
const REBUILD_HOUR = 3;

// Holds the current schedule and rebuilds it from 511 once a day, swapping the new database in
// whole so requests never see a half-built one.
export class ScheduleStore {
  private current: Schedule | null = null;
  private building: Promise<void> | null = null;
  private readonly path: string;
  private readonly pool: KeyPool;

  constructor(dataDir: string, pool: KeyPool) {
    mkdirSync(dataDir, { recursive: true });
    this.path = join(dataDir, 'schedule.db');
    this.pool = pool;
  }

  get schedule() {
    return this.current;
  }

  async start() {
    if (existsSync(this.path)) {
      try {
        this.current = new Schedule(this.path);
      } catch (error) {
        console.error('Could not open the schedule database, rebuilding:', error);
      }
    }
    if (!this.current || nowSeconds() - this.current.builtAt > MAX_AGE_SECONDS) await this.rebuild();
    const timer = setInterval(() => {
      const { hour } = zonedParts(nowSeconds());
      const age = this.current ? nowSeconds() - this.current.builtAt : Infinity;
      if (hour === REBUILD_HOUR && age > 3600) void this.rebuild();
    }, 10 * 60 * 1000);
    timer.unref();
  }

  rebuild() {
    this.building ??= this.build().finally(() => (this.building = null));
    return this.building;
  }

  private async build() {
    const started = performance.now();
    try {
      const feeds = new Map<Agency, Map<string, string>>();
      for (const agency of AGENCIES) {
        feeds.set(agency, unzipFeed(await this.pool.request('datafeeds', { operator_id: agency })));
      }
      const temporary = `${this.path}.new`;
      buildScheduleDatabase(feeds, temporary);
      renameSync(temporary, this.path);
      const previous = this.current;
      this.current = new Schedule(this.path);
      // The old file is already unlinked, and closing it frees the space.
      previous?.close();
      console.log(`Schedule rebuilt in ${((performance.now() - started) / 1000).toFixed(1)} s`);
    } catch (error) {
      console.error('Schedule rebuild failed, keeping the previous one:', error);
    }
  }
}
