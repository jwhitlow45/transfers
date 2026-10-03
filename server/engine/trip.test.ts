import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { Agency } from '../config.ts';
import { buildScheduleDatabase } from '../gtfs/ingest.ts';
import { type FeedObject, decodeFeed, encodeFeed } from '../realtime/feed.ts';
import { buildAlerts, buildTripSnapshot } from '../realtime/snapshot.ts';
import { Schedule } from '../schedule.ts';
import { serviceDayStart } from '../time.ts';
import { planTrip } from './trip.ts';

// A tiny network shaped like J's commute: BART from Montgomery to 24th St Mission, where the
// 48 stops 36 m from the station's entrance. BART runs every 10 minutes, the 48 every 15.
const DATE = 20261005;
const DAY = serviceDayStart(DATE);
const NOW = DAY + 8 * 3600;
const clock = (seconds: number) => `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:00`;

function feeds() {
  const calendar = `service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nall,1,1,1,1,1,1,1,20260101,20271231\n`;
  const bartTrips: string[] = [];
  const bartTimes: string[] = [];
  for (let n = 0; n < 12; n++) {
    const leaves = 7.5 * 3600 + n * 600;
    bartTrips.push(`Yellow-S,all,b${n},SFO,1,,`);
    bartTimes.push(
      `b${n},${clock(leaves)},${clock(leaves + 30)},901201,1`,
      `b${n},${clock(leaves + 480)},${clock(leaves + 510)},901601,2`,
      `b${n},${clock(leaves + 720)},${clock(leaves + 750)},902101,3`,
    );
  }
  const muniTrips: string[] = [];
  const muniTimes: string[] = [];
  for (let n = 0; n < 10; n++) {
    const at = 7.5 * 3600 + 120 + n * 900;
    muniTrips.push(`48,all,m${n},22nd St + Iowa St,1,,`);
    muniTimes.push(`m${n},${clock(at - 120)},${clock(at - 120)},13486,1`, `m${n},${clock(at)},${clock(at)},13477,2`, `m${n},${clock(at + 600)},${clock(at + 600)},13500,3`);
  }
  const files = (entries: Record<string, string>) => new Map(Object.entries(entries));
  return new Map<Agency, Map<string, string>>([
    [
      'BA',
      files({
        'routes.txt': 'route_id,route_short_name,route_long_name,route_type\nYellow-S,Yellow-S,Antioch to SFO,1\n',
        'stops.txt': [
          'stop_id,stop_code,stop_name,stop_lat,stop_lon,location_type,parent_station',
          '901209,901209,Montgomery Street,37.789173,-122.401587,1,',
          '901201,901201,Montgomery Street,37.789213,-122.401642,0,901209',
          '901609,901609,24th Street / Mission,37.752419,-122.418468,1,',
          '901601,901601,24th Street / Mission,37.752422,-122.418518,0,901609',
          '24TH_3,,SW Entrance,37.75194137,-122.4188268,2,901609',
          '902109,902109,Glen Park,37.733064,-122.433817,1,',
          '902101,902101,Glen Park,37.733064,-122.433817,0,902109',
        ].join('\n'),
        'calendar.txt': calendar,
        'trips.txt': `route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id\n${bartTrips.join('\n')}\n`,
        'stop_times.txt': `trip_id,arrival_time,departure_time,stop_id,stop_sequence\n${bartTimes.join('\n')}\n`,
      }),
    ],
    [
      'SF',
      files({
        'routes.txt': 'route_id,route_short_name,route_long_name,route_type\n48,48,QUINTARA/24TH STREET,3\n',
        'stops.txt': [
          'stop_id,stop_code,stop_name,stop_lat,stop_lon',
          '13486,13486,24th St & Valencia St,37.752300,-122.420900',
          '13477,13477,24th St & Mission St,37.752178,-122.41855',
          '13500,13500,24th St & Potrero Ave,37.752900,-122.406500',
        ].join('\n'),
        'calendar.txt': calendar,
        'trips.txt': `route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id\n${muniTrips.join('\n')}\n`,
        'stop_times.txt': `trip_id,arrival_time,departure_time,stop_id,stop_sequence\n${muniTimes.join('\n')}\n`,
      }),
    ],
  ]);
}

let schedule: Schedule;
before(() => {
  const path = join(mkdtempSync(join(tmpdir(), 'trip-')), 'schedule.db');
  buildScheduleDatabase(feeds(), path);
  schedule = new Schedule(path);
});
after(() => schedule.close());

// Trains b6 to b8 are live and on time. Bus m4 (scheduled 8:32) runs 2 minutes late, bus m5
// (8:47) is canceled, and the rest of the buses and trains are known only from the schedule.
function realtime() {
  const stopUpdate = (stopId: string, time: number, delay: number) => ({ stopId, arrival: { time, delay } });
  const busAt = (n: number) => DAY + 7.5 * 3600 + 120 + n * 900;
  const feed: FeedObject = {
    header: { gtfsRealtimeVersion: '2.0', timestamp: NOW },
    entity: [
      ...[6, 7, 8].map((n) => {
        const leaves = DAY + 7.5 * 3600 + n * 600;
        return { id: `b${n}`, tripUpdate: { trip: { tripId: `BA:b${n}`, routeId: 'BA:Yellow-S' }, stopTimeUpdate: [stopUpdate('901201', leaves, 0), stopUpdate('901601', leaves + 480, 0)] } };
      }),
      {
        id: 'm4',
        tripUpdate: { trip: { tripId: 'SF:m4', routeId: 'SF:48' }, stopTimeUpdate: [stopUpdate('13477', busAt(4) + 120, 120), stopUpdate('13500', busAt(4) + 720, 120)] },
      },
      { id: 'm5', tripUpdate: { trip: { tripId: 'SF:m5', routeId: 'SF:48', scheduleRelationship: 'CANCELED' as const } } },
      {
        id: 'alert',
        alert: {
          informedEntity: [{ agencyId: 'SF', routeId: 'SF:48', stopId: '13477' }],
          headerText: { translation: [{ text: '48 STOP TEMP. MOVED Board at 24th & Capp', language: 'en' }] },
        },
      },
    ],
  };
  // Through the real encoder and decoder, as the server reads it.
  const decoded = decodeFeed(encodeFeed(feed));
  const agencies = new Set<Agency>(['SF', 'BA']);
  return {
    trips: buildTripSnapshot(decoded, NOW, agencies),
    alerts: buildAlerts(decoded, NOW, agencies),
    status: () => 'live' as const,
    updatedAt: NOW,
  };
}

test('finds the 48 at 24th St Mission from Montgomery', () => {
  const response = planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13477' }, NOW);
  strictEqual(response.groups.length, 1);
  const [group] = response.groups;
  strictEqual(group?.alight, 'BA:901601');
  strictEqual(group?.board, 'SF:13477');
  strictEqual(group?.walkMeters, 36);
  // The calibrated 3 minutes, and a window widened to the 48's 15 minute headway.
  deepStrictEqual(group?.window, { min: 3, max: 18 });
  strictEqual(response.routes['BA:Yellow-S']?.name, 'Yellow');
});

test('pairs live and scheduled trips and shows the canceled bus in place', () => {
  const response = planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13477' }, NOW);
  const departures = response.groups[0]!.departures.map((departure) => ({
    bus: departure.trip,
    live: departure.live,
    delay: departure.delay,
    canceled: departure.canceled ?? false,
    trains: departure.connections.map(({ trip, transfer, live }) => `${trip}:${transfer}${live ? '' : ':scheduled'}`),
  }));
  // Train b6 (reaches 24th St 8:38) would wait 24 minutes for m6, over the maximum, so it is
  // left out. The canceled m5 falls among the shown buses, so it shows in place.
  deepStrictEqual(departures, [
    { bus: 'SF:m3', live: false, delay: null, canceled: false, trains: ['BA:b3:9:scheduled'] },
    { bus: 'SF:m4', live: true, delay: 120, canceled: false, trains: ['BA:b4:16:scheduled', 'BA:b5:6:scheduled'] },
    { bus: 'SF:m5', live: true, delay: null, canceled: true, trains: [] },
    { bus: 'SF:m6', live: false, delay: null, canceled: false, trains: ['BA:b7:14', 'BA:b8:4'] },
  ]);
});

test('names the alert on the boarding stop', () => {
  const response = planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13477' }, NOW);
  deepStrictEqual(response.alerts.map(({ relevance, header }) => [relevance, header]), [['stop', '48 STOP TEMP. MOVED Board at 24th & Capp']]);
});

test('shows destination arrival and respects rider settings', () => {
  const response = planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13477', dest: 'SF:13500', min: 5, max: 10, hide: 10 }, NOW);
  const group = response.groups[0]!;
  deepStrictEqual(group.window, { min: 5, max: 10 });
  strictEqual(group.departures.find(({ trip }) => trip === 'SF:m4')?.destination, DAY + 7.5 * 3600 + 120 + 4 * 900 + 720);
  ok(group.departures.every(({ destination, at }) => destination === undefined || destination > at));
  ok(group.departures.flatMap(({ connections }) => connections).every(({ departs }) => departs - NOW >= 600));
});

test('the 48 to BART groups trains by platform', () => {
  const response = planTrip(schedule, realtime(), { from: 'SF:13486', to: 'BA:901609' }, NOW);
  strictEqual(response.groups.length, 1);
  deepStrictEqual(response.groups[0]?.routes, ['BA:Yellow-S']);
  strictEqual(response.groups[0]?.alight, 'SF:13477');
});
