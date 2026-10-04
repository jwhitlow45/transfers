import { deepStrictEqual } from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Agency } from '../config.ts';
import { buildScheduleDatabase } from '../gtfs/ingest.ts';
import { Schedule } from '../schedule.ts';
import { findLinks } from './links.ts';

// A line along one street, like the California cable car: westbound it ends at Van Ness, two
// blocks past Larkin, and eastbound it starts there. Blocks are 150 m apart, and each corner has
// a stop on each side of the street.
const LAT = 37.79;
const lon = (meters: number) => (-122.422 + meters / 88_000).toFixed(6);
const CORNERS = [
  ['vanness', 0],
  ['polk', 150],
  ['larkin', 300],
  ['hyde', 450],
  ['jones', 600],
  ['market', 1500],
] as const;

function network(shortRunTrips: number) {
  const stops = ['stop_id,stop_code,stop_name,stop_lat,stop_lon'];
  for (const [name, meters] of CORNERS) {
    stops.push(`${name}-wb,${name}-wb,${name} westbound,${(LAT + 0.0002).toFixed(6)},${lon(meters)}`);
    stops.push(`${name}-eb,${name}-eb,${name} eastbound,${LAT.toFixed(6)},${lon(meters)}`);
  }
  const trips: string[] = [];
  const times: string[] = [];
  const run = (id: string, direction: number, headsign: string, sequence: string[]) => {
    trips.push(`C,all,${id},${headsign},${direction},,`);
    sequence.forEach((stop, index) => {
      const at = `08:${String(index * 2).padStart(2, '0')}:00`;
      times.push(`${id},${at},${at},${stop},${index + 1}`);
    });
  };
  const westbound = ['market-wb', 'jones-wb', 'hyde-wb', 'larkin-wb', 'polk-wb', 'vanness-wb'];
  const eastbound = ['vanness-eb', 'polk-eb', 'larkin-eb', 'hyde-eb', 'jones-eb', 'market-eb'];
  for (let n = 0; n < 10; n++) run(`w${n}`, 0, 'Van Ness', westbound);
  for (let n = 0; n < 10; n++) run(`e${n}`, 1, 'Market', eastbound);
  // A short run that starts at Hyde, one block past Larkin.
  for (let n = 0; n < shortRunTrips; n++) run(`s${n}`, 1, 'Market', eastbound.slice(3));
  const calendar = 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nall,1,1,1,1,1,1,1,20260101,20271231\n';
  const files = new Map(
    Object.entries({
      'routes.txt': 'route_id,route_short_name,route_long_name,route_type\nC,C,CALIFORNIA,3\n',
      'stops.txt': `${stops.join('\n')}\n`,
      'calendar.txt': calendar,
      'trips.txt': `route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id\n${trips.join('\n')}\n`,
      'stop_times.txt': `trip_id,arrival_time,departure_time,stop_id,stop_sequence\n${times.join('\n')}\n`,
    }),
  );
  const path = join(mkdtempSync(join(tmpdir(), 'links-')), 'schedule.db');
  buildScheduleDatabase(new Map<Agency, Map<string, string>>([['SF', files]]), path);
  return new Schedule(path);
}

const fromLarkin = (schedule: Schedule, destination?: string) => {
  const route = schedule.routesByKey.get('SF:C')!;
  const reaches = destination ? { reaches: new Set([schedule.stopsByKey.get(destination)!.id]) } : {};
  return findLinks(schedule, schedule.stopsByKey.get('SF:larkin-wb')!, { route }, reaches).map((link) => `${link.kind} ${link.headsign} at ${link.board.stopId}`);
};

test('a walk boards where the route stops, not upstream, and skips a direction that ends a walk away', () => {
  const schedule = network(2);
  // Westbound ends at Van Ness, 300 m on: no group at all, and no ride to it elsewhere.
  // Eastbound boards across the street, not at Polk, whose cars pass Larkin anyway. Hyde's two
  // extra trips do not outweigh the stop at hand.
  deepStrictEqual(fromLarkin(schedule), ['walk Market at larkin-eb']);
  schedule.close();
});

test('a walk boards a block over when most of the service starts there', () => {
  const schedule = network(30);
  // Larkin has 10 of Hyde's 40 trips, under three quarters.
  deepStrictEqual(fromLarkin(schedule), ['walk Market at hyde-eb']);
  schedule.close();
});

test('a walk to a destination boards before it, even where a stop past it is busier', () => {
  const schedule = network(30);
  // Hyde wins on its own, but a rider going to Hyde boards at Larkin.
  deepStrictEqual(fromLarkin(schedule, 'SF:hyde-eb'), ['walk Market at larkin-eb']);
  schedule.close();
});
