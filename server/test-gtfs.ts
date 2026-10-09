import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Agency } from './config.ts';
import { buildScheduleDatabase } from './gtfs/ingest.ts';
import { Schedule } from './schedule.ts';

// For tests that build a small network of their own and read it as the server does.

// A GTFS time from seconds after midnight: 8.5 hours is "8:30:00".
export const clock = (seconds: number) => `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:00`;

// One service, "all", running every day through 2027.
export const CALENDAR = 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nall,1,1,1,1,1,1,1,20260101,20271231\n';

// One agency's GTFS files, each name with its text.
export const files = (entries: Record<string, string>) => new Map(Object.entries(entries));

// The schedule database built from each agency's files, in a fresh temporary directory.
export function buildSchedule(feeds: Map<Agency, Map<string, string>>) {
  const path = join(mkdtempSync(join(tmpdir(), 'schedule-')), 'schedule.db');
  buildScheduleDatabase(feeds, path);
  return new Schedule(path);
}
