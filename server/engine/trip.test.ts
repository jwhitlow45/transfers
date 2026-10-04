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
import { mergeOrder, search } from '../api/search.ts';
import { destinations, planTrip } from './trip.ts';

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
  // Three afternoon 48s, when BART in this network does not run.
  for (let n = 10; n < 13; n++) {
    const at = 14 * 3600 + (n - 10) * 900;
    muniTrips.push(`48,all,m${n},22nd St + Iowa St,1,,`);
    muniTimes.push(`m${n},${clock(at - 120)},${clock(at - 120)},13486,1`, `m${n},${clock(at)},${clock(at)},13477,2`, `m${n},${clock(at + 600)},${clock(at + 600)},13500,3`);
  }
  // The N runs under Market St through Montgomery, sharing the station with BART, out to Church.
  for (let n = 0; n < 8; n++) {
    const leaves = 7.5 * 3600 + 300 + n * 600;
    muniTrips.push(`N,all,n${n},Ocean Beach,0,,`);
    muniTimes.push(`n${n},${clock(leaves)},${clock(leaves)},16994,1`, `n${n},${clock(leaves + 540)},${clock(leaves + 540)},16998,2`);
  }
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
        'routes.txt': 'route_id,route_short_name,route_long_name,route_type\n48,48,QUINTARA/24TH STREET,3\nN,N,JUDAH,0\n',
        'stops.txt': [
          'stop_id,stop_code,stop_name,stop_lat,stop_lon',
          '13486,13486,24th St & Valencia St,37.752300,-122.420900',
          '13477,13477,24th St & Mission St,37.752178,-122.41855',
          '13500,13500,24th St & Potrero Ave,37.752900,-122.406500',
          // No route stops here. It is a block from Potrero, where the 48 ends.
          '13501,13501,24th St & Hampshire St,37.752900,-122.407500',
          '16994,16994,Metro Montgomery Station/Outbound,37.789200,-122.401700',
          '16998,16998,Metro Church Station/Outbound,37.767194,-122.429168',
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
  // Getting off at a BART platform is getting off at its station.
  strictEqual(group?.alight, 'BA:901609');
  strictEqual(group?.board, 'SF:13477');
  strictEqual(group?.walkMeters, 36);
  // The calibrated 3 minutes, and a window as wide as the 10 minutes between trains.
  deepStrictEqual(group?.window, { min: 3, max: 13 });
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
  // Trains that would wait longer than 13 minutes (b4 for m4, b6 and b7 for m6) are left out,
  // and each bus keeps its best train. The canceled m5 falls among the shown buses, so it
  // shows in place.
  deepStrictEqual(departures, [
    { bus: 'SF:m3', live: false, delay: null, canceled: false, trains: ['BA:b3:9:scheduled'] },
    { bus: 'SF:m4', live: true, delay: 120, canceled: false, trains: ['BA:b5:6:scheduled'] },
    { bus: 'SF:m5', live: true, delay: null, canceled: true, trains: [] },
    { bus: 'SF:m6', live: false, delay: null, canceled: false, trains: ['BA:b8:4'] },
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

test('a station a block away is a walk, not a one-stop bus ride', () => {
  const response = planTrip(schedule, realtime(), { from: 'SF:13486', to: 'BA:901609' }, NOW);
  strictEqual(response.groups.length, 1);
  const group = response.groups[0]!;
  strictEqual(group.kind, 'walk');
  deepStrictEqual(group.routes, ['BA:Yellow-S']);
  strictEqual(group.board, 'BA:901601');
  ok(group.departures.length > 0 && group.departures.every(({ connections }) => connections.length === 0));
});

test('a route that already stops at From is a walk of no distance', () => {
  const group = planTrip(schedule, realtime(), { from: 'SF:13486', to: 'route:SF:48' }, NOW).groups[0]!;
  strictEqual(group.kind, 'walk');
  strictEqual(group.board, 'SF:13486');
  strictEqual(group.window.min, 0);
});

test('a route not running for hours says when it starts', () => {
  // The N in the fixture runs 7:35 to 8:45 in the morning, so at 2 PM it is idle until the next day.
  const afternoon = DAY + 14 * 3600;
  const response = planTrip(schedule, realtime(), { from: 'BA:901209', to: 'route:SF:N' }, afternoon);
  strictEqual(response.groups.length, 0);
  deepStrictEqual(response.notice, { kind: 'idle', side: 'to', next: DAY + 86_400 + 7.5 * 3600 + 300 });
});

test('suggests the smallest raise of the maximum when nothing connects', () => {
  // Trains reach 24th St on the 8s and scheduled buses come on the 2s and 7s, so transfers run
  // 4, 9, 14, ... minutes. The live bus 2 minutes late adds 6 and 16. A 7 to 8 minute window
  // finds none, and 7 to 9 finds the 9s.
  const empty = planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13477', min: 7, max: 8 }, NOW).groups[0]!;
  ok(empty.departures.every(({ connections }) => connections.length === 0));
  const widen = empty.widen!;
  ok(widen, 'expected a suggestion');
  // Only the maximum grows: the minimum is the time the walk takes.
  deepStrictEqual(widen, { min: 7, max: 9 });
  const widened = planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13477', ...widen }, NOW).groups[0]!;
  ok(widened.departures.some(({ connections }) => connections.length > 0));
  strictEqual(widened.widen, undefined);
});

test('lists first-leg routes and destinations for each transfer point', () => {
  const response = planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13477' }, NOW);
  deepStrictEqual(response.groups[0]?.firstRoutes, ['BA:Yellow-S']);
  const { groups } = destinations(schedule, { from: 'BA:901209', to: 'SF:13477' });
  deepStrictEqual(groups.map(({ board, stops }) => [board, stops]), [['SF:13477', ['SF:13500']]]);
});

test('a BART station as destination matches its platform', () => {
  const response = planTrip(schedule, realtime(), { from: 'SF:13486', to: 'BA:901609', dest: 'BA:902109' }, NOW);
  const departure = response.groups[0]!.departures.find(({ canceled }) => !canceled)!;
  // Trains reach Glen Park 4 minutes after 24th St.
  strictEqual(departure.destination, departure.at + 240);
});

test('BART and Muni Metro share Montgomery, and the rider can pick either', () => {
  const station = schedule.stopsByKey.get('BA:901209')!;
  deepStrictEqual(schedule.sharedMembers.get(station.id)?.map(({ stopId }) => stopId), ['16994']);
  deepStrictEqual(schedule.boardingStops(station, new Set(['SF'])).map(({ stopId }) => stopId), ['16994']);
  deepStrictEqual(schedule.boardingStops(station, new Set(['BA'])).map(({ stopId }) => stopId), ['901201']);
  // Only BART reaches 24th St & Mission.
  strictEqual(planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13477', fromAgencies: ['SF'] }, NOW).groups.length, 0);
  strictEqual(planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13477', fromAgencies: ['BA'] }, NOW).groups.length, 1);
  const response = planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13477' }, NOW);
  deepStrictEqual(response.stops['BA:901209']?.serves, ['BA', 'SF']);
});

test('search finds a shared station once, by name', () => {
  const montgomery = search(schedule, 'montgomery', { routes: false }).results;
  deepStrictEqual(montgomery.map((result) => (result.type === 'stop' ? result.key : result.route)), ['BA:901209']);
  // Its Muni Metro platform still answers to its own code.
  deepStrictEqual(search(schedule, '16994', { routes: false }).results.map((result) => (result.type === 'stop' ? result.key : '')), ['SF:16994']);
});

test('naming a route exactly where only a stop will do lists the stops it makes, in order', () => {
  const along = (query: string, routes = false) =>
    search(schedule, query, { routes }).along?.map(({ route, directions }) => ({ route, stops: directions.map(({ stops }) => stops.map(({ key }) => key)) }));
  deepStrictEqual(along('48'), [{ route: 'SF:48', stops: [['SF:13486', 'SF:13477', 'SF:13500']] }]);
  // A Muni Metro platform in a shared station stands for the station.
  deepStrictEqual(along('n'), [{ route: 'SF:N', stops: [['BA:901209', 'SF:16998']] }]);
  deepStrictEqual(along('Yellow'), [{ route: 'BA:Yellow-S', stops: [['BA:901209', 'BA:901609', 'BA:902109']] }]);
  deepStrictEqual(along('4'), undefined);
  // To can be the route itself.
  deepStrictEqual(along('48', true), undefined);
});

test('stop orders merge with short runs placed where they join', () => {
  // The second run starts at 9 before joining at 3 and adds 6. The third loops back to 3.
  deepStrictEqual(mergeOrder([[1, 2, 3, 4, 5], [9, 3, 4, 6, 5], [3, 4, 3]]), [1, 2, 9, 3, 4, 6, 5]);
  // A run sharing no stop goes at the end.
  deepStrictEqual(mergeOrder([[1, 2], [7, 8]]), [1, 2, 7, 8]);
});

test('a walk group with a destination boards where the route still reaches it, and says so when none does', () => {
  // From 24th & Valencia the 48 needs no transfer, and it reaches Potrero.
  const reaches = planTrip(schedule, realtime(), { from: 'SF:13486', to: 'route:SF:48', dest: 'SF:13500' }, NOW);
  deepStrictEqual(reaches.groups.map(({ kind, board }) => `${kind} ${board}`), ['walk SF:13486']);
  strictEqual(reaches.notice, undefined);
  // The 48 here never goes downtown. That is the destination's doing, not a gap in service.
  const away = planTrip(schedule, realtime(), { from: 'SF:13486', to: 'route:SF:48', dest: 'BA:901209' }, NOW);
  deepStrictEqual(away.groups, []);
  deepStrictEqual(away.notice, { kind: 'destination' });
});

test('a named stop a short walk from From is said to be a walk', () => {
  // Potrero is a block away, and nothing rides there from here.
  const response = planTrip(schedule, realtime(), { from: 'SF:13501', to: 'SF:13500' }, NOW);
  deepStrictEqual(response.groups, []);
  deepStrictEqual(response.notice, { kind: 'walkable', stop: 'SF:13500', meters: 88 });
  ok(response.stops['SF:13500']);
  // The same as a destination.
  deepStrictEqual(planTrip(schedule, realtime(), { from: 'SF:13501', to: 'route:SF:48', dest: 'SF:13500' }, NOW).notice, { kind: 'walkable', stop: 'SF:13500', meters: 88 });
});

test('when the route to catch runs but nothing from From does, the notice says so', () => {
  const afternoon = DAY + 14 * 3600;
  const response = planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13477' }, afternoon);
  deepStrictEqual(response.notice, { kind: 'idle', side: 'from', next: DAY + 86_400 + 7.5 * 3600 });
});

test('a bus the feed says skips the stop does not come back as scheduled', () => {
  const busAt = (n: number) => DAY + 7.5 * 3600 + 120 + n * 900;
  const feed: FeedObject = {
    header: { gtfsRealtimeVersion: '2.0', timestamp: NOW },
    entity: [
      {
        id: 'm4',
        tripUpdate: {
          trip: { tripId: 'SF:m4', routeId: 'SF:48' },
          stopTimeUpdate: [
            { stopId: '13477', scheduleRelationship: 'SKIPPED' as const },
            { stopId: '13500', arrival: { time: busAt(4) + 600, delay: 0 } },
          ],
        },
      },
    ],
  };
  const decoded = decodeFeed(encodeFeed(feed));
  const agencies = new Set<Agency>(['SF', 'BA']);
  const view = { trips: buildTripSnapshot(decoded, NOW, agencies), alerts: [], status: () => 'live' as const, updatedAt: NOW };
  const trips = planTrip(schedule, view, { from: 'BA:901209', to: 'SF:13477' }, NOW).groups[0]!.departures.map(({ trip }) => trip);
  ok(!trips.includes('SF:m4'), `got ${trips.join(', ')}`);
});

test('a walk group leaves out departures sooner than the rider asked to hide', () => {
  const group = planTrip(schedule, realtime(), { from: 'SF:13486', to: 'route:SF:48', hide: 30 }, NOW).groups[0]!;
  strictEqual(group.kind, 'walk');
  ok(group.departures.length > 0 && group.departures.every(({ at }) => at >= NOW + 30 * 60));
});
