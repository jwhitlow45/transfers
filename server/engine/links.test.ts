import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Agency } from '../config.ts';
import { buildScheduleDatabase } from '../gtfs/ingest.ts';
import { Schedule } from '../schedule.ts';
import { serviceDayStart } from '../time.ts';
import { findLinks } from './links.ts';
import { planTrip } from './trip.ts';

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

// Builds a one-route network. `stops` are names with their position along the street in meters
// and whether they sit on its north side. `runs` repeat a stop sequence `count` times.
function build(stops: [string, number, boolean][], runs: { id: string; direction: number; headsign: string; sequence: string[]; count: number }[]) {
  const rows = ['stop_id,stop_code,stop_name,stop_lat,stop_lon'];
  for (const [name, meters, north] of stops) rows.push(`${name},${name},${name},${(LAT + (north ? 0.0002 : 0)).toFixed(6)},${lon(meters)}`);
  const trips: string[] = [];
  const times: string[] = [];
  for (const { id, direction, headsign, sequence, count } of runs) {
    for (let n = 0; n < count; n++) {
      trips.push(`C,all,${id}${n},${headsign},${direction},,`);
      sequence.forEach((stop, index) => {
        const at = `08:${String(index * 2).padStart(2, '0')}:00`;
        times.push(`${id}${n},${at},${at},${stop},${index + 1}`);
      });
    }
  }
  const calendar = 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nall,1,1,1,1,1,1,1,20260101,20271231\n';
  const files = new Map(
    Object.entries({
      'routes.txt': 'route_id,route_short_name,route_long_name,route_type\nC,C,CALIFORNIA,3\n',
      'stops.txt': `${rows.join('\n')}\n`,
      'calendar.txt': calendar,
      'trips.txt': `route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id\n${trips.join('\n')}\n`,
      'stop_times.txt': `trip_id,arrival_time,departure_time,stop_id,stop_sequence\n${times.join('\n')}\n`,
    }),
  );
  const path = join(mkdtempSync(join(tmpdir(), 'links-')), 'schedule.db');
  buildScheduleDatabase(new Map<Agency, Map<string, string>>([['SF', files]]), path);
  return new Schedule(path);
}

function network(shortRunTrips: number) {
  const stops = CORNERS.flatMap(([name, meters]): [string, number, boolean][] => [
    [`${name}-wb`, meters, true],
    [`${name}-eb`, meters, false],
  ]);
  const eastbound = ['vanness-eb', 'polk-eb', 'larkin-eb', 'hyde-eb', 'jones-eb', 'market-eb'];
  return build(stops, [
    { id: 'w', direction: 0, headsign: 'Van Ness', sequence: ['market-wb', 'jones-wb', 'hyde-wb', 'larkin-wb', 'polk-wb', 'vanness-wb'], count: 10 },
    { id: 'e', direction: 1, headsign: 'Market', sequence: eastbound, count: 10 },
    // A short run that starts at Hyde, one block past Larkin.
    { id: 's', direction: 1, headsign: 'Market', sequence: eastbound.slice(3), count: shortRunTrips },
  ]);
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

test('a loop that comes back past From after the rider gets off still boards near From', () => {
  // Like the 18 at Legion of Honor: boarded across the street from From, it reaches the named
  // stop, then loops back through From itself.
  const schedule = build(
    [
      ['from', 0, false],
      ['across', 0, true],
      ['out', 600, true],
      ['to', 1200, true],
    ],
    [{ id: 'l', direction: 0, headsign: 'Loop', sequence: ['across', 'out', 'to', 'from'], count: 10 }],
  );
  const from = schedule.stopsByKey.get('SF:from')!;
  const to = schedule.stopsByKey.get('SF:to')!;
  const boards = (links: ReturnType<typeof findLinks>) => links.map((link) => `${link.kind} at ${link.board.stopId}`);
  deepStrictEqual(boards(findLinks(schedule, from, { stop: to })), ['walk at across']);
  deepStrictEqual(boards(findLinks(schedule, from, { route: schedule.routesByKey.get('SF:C')! }, { reaches: new Set([to.id]) })), ['walk at across']);
  // Going on past the named stop and around to From itself, the ride ends where it started.
  deepStrictEqual(boards(findLinks(schedule, from, { stop: to }, { reaches: new Set([from.id]) })), []);
  schedule.close();
});

test('a ride straight to a named stop may end across the street from it, or where the route ends', () => {
  const schedule = network(2);
  const links = (from: string, to: string) =>
    findLinks(schedule, schedule.stopsByKey.get(`SF:${from}`)!, { stop: schedule.stopsByKey.get(`SF:${to}`)! }).map((link) => `${link.kind} ${link.headsign} at ${link.board.stopId}`);
  // Westbound cars leave Jones away from Larkin, so as a stop to transfer at, westbound Jones is
  // out of reach. Eastbound ones stop across the street.
  deepStrictEqual(links('larkin-wb', 'jones-wb'), ['walk Market at larkin-eb']);
  // Westbound ends at Van Ness, where no one boards.
  deepStrictEqual(links('jones-wb', 'vanness-wb'), ['walk Van Ness at jones-wb']);
  schedule.close();
});

test('a pinned ride straight to a named stop ends where the bus reaches it or its corner after boarding', () => {
  // A loop that starts at To, and after picking the rider up comes back across the street from it.
  const schedule = build(
    [
      ['to', 0, false],
      ['corner', 0, true],
      ['from', 900, false],
      ['out', 1500, false],
    ],
    [{ id: 'l', direction: 0, headsign: 'Loop', sequence: ['to', 'from', 'out', 'corner'], count: 1 }],
  );
  const day = serviceDayStart(20261005);
  const view = { trips: null, alerts: [], status: () => 'schedule' as const, updatedAt: null };
  const [departure] = planTrip(schedule, view, { from: 'SF:from', to: 'SF:to' }, day + 7.9 * 3600).groups.flatMap(({ departures }) => departures);
  // It leaves From at 8:02 and comes past To at 8:06.
  deepStrictEqual([departure?.at, departure?.destination], [day + 8 * 3600 + 120, day + 8 * 3600 + 360]);
  const pin = { second: { trip: 'SF:l0', board: 'SF:from' }, at: day + 8 * 3600 + 120 };
  deepStrictEqual(planTrip(schedule, view, { from: 'SF:from', to: 'SF:to', pin }, day + 7.9 * 3600).pinned?.second?.off, { stop: 'SF:corner', at: day + 8 * 3600 + 360, delay: null });
  schedule.close();
});

test('a ride straight to a named stop arrives at the first of the stop or its corner it reaches, in the results and when pinned', () => {
  // The bus passes the stop across the street just before To.
  const schedule = build(
    [
      ['from', 900, false],
      ['out', 450, false],
      ['corner', 0, true],
      ['to', 0, false],
      ['beyond', -600, false],
    ],
    [{ id: 'p', direction: 0, headsign: 'West', sequence: ['from', 'out', 'corner', 'to', 'beyond'], count: 1 }],
  );
  const day = serviceDayStart(20261005);
  const view = { trips: null, alerts: [], status: () => 'schedule' as const, updatedAt: null };
  const [departure] = planTrip(schedule, view, { from: 'SF:from', to: 'SF:to' }, day + 7.9 * 3600).groups.flatMap(({ departures }) => departures);
  // It reaches the corner at 8:04 and To at 8:06.
  strictEqual(departure?.destination, day + 8 * 3600 + 240);
  const pin = { second: { trip: 'SF:p0', board: 'SF:from' }, at: day + 8 * 3600 };
  deepStrictEqual(planTrip(schedule, view, { from: 'SF:from', to: 'SF:to', pin }, day + 7.9 * 3600).pinned?.second?.off, { stop: 'SF:corner', at: day + 8 * 3600 + 240, delay: null });
  schedule.close();
});
