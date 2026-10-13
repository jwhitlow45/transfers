import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Agency } from '../config.ts';
import { type FeedObject, decodeFeed, encodeFeed } from '../realtime/feed.ts';
import { buildAlerts, buildTripSnapshot } from '../realtime/snapshot.ts';
import { all } from '../db.ts';
import type { Schedule } from '../schedule.ts';
import { CALENDAR, buildSchedule, clock, files } from '../test-gtfs.ts';
import { serviceDayStart } from '../time.ts';
import { nearby } from '../api/nearby.ts';
import { mergeOrder, search } from '../api/search.ts';
import { stopArrivals } from '../api/stop.ts';
import { trackVehicle } from './track.ts';
import { destinations, planTrip } from './trip.ts';

// A tiny network shaped like J's commute: BART from Montgomery to 24th St Mission, where the
// 48 stops 36 m from the station's entrance. BART runs every 10 minutes, the 48 every 15.
const DATE = 20261005;
const DAY = serviceDayStart(DATE);
const NOW = DAY + 8 * 3600;

function feeds() {
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
        'calendar.txt': CALENDAR,
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
          // No route stops here either. It is 92 m east of 24th & Mission.
          '13478,13478,24th St & Capp St,37.752178,-122.417500',
          '16994,16994,Metro Montgomery Station/Outbound,37.789200,-122.401700',
          '16998,16998,Metro Church Station/Outbound,37.767194,-122.429168',
        ].join('\n'),
        'calendar.txt': CALENDAR,
        'trips.txt': `route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id\n${muniTrips.join('\n')}\n`,
        'stop_times.txt': `trip_id,arrival_time,departure_time,stop_id,stop_sequence\n${muniTimes.join('\n')}\n`,
      }),
    ],
  ]);
}

// The same network with 80 more Muni stops named just "Montgomery St", all served by one route,
// for searches where street stops crowd out a station. Names that short rank above the station's
// longer entry by text alone, as Montgomery St's many corners do in the real data.
function crowdedFeeds() {
  const network = feeds();
  const muni = network.get('SF')!;
  const corners = Array.from({ length: 80 }, (_, n) => ({ id: `m${n}`, name: `Montgomery St`, lon: (-122.46 + n * 0.0005).toFixed(6) }));
  muni.set('stops.txt', `${muni.get('stops.txt')}\n${corners.map(({ id, name, lon }) => `${id},,${name},37.731000,${lon}`).join('\n')}`);
  muni.set('routes.txt', `${muni.get('routes.txt')}23,23,MONTEREY,3\n`);
  muni.set('trips.txt', `${muni.get('trips.txt')}23,all,mty,Bayview,0,,\n`);
  muni.set('stop_times.txt', `${muni.get('stop_times.txt')}${corners.map(({ id }, n) => `mty,${clock(8 * 3600 + n * 60)},${clock(8 * 3600 + n * 60)},${id},${n + 1}`).join('\n')}\n`);
  return network;
}

// The same network with names as agencies publish them, which riders should not see: Muni's F
// to "Fisherman`s Wharf" and M to "Balboa Park via S.F. State", a Golden Gate ferry with no
// headsign, and BART trains headed by their last stations' full names.
function namedFeeds() {
  const network = feeds();
  const run = (trip: string, visits: [string, number][]) => visits.map(([stop, at], n) => `${trip},${clock(at)},${clock(at)},${stop},${n + 1}`).join('\n');
  const muni = network.get('SF')!;
  muni.set('routes.txt', `${muni.get('routes.txt')}F,F,MARKET & WHARVES,0\nM,M,OCEAN VIEW,0\n`);
  muni.set('trips.txt', `${muni.get('trips.txt')}F,all,f0,Fisherman\`s Wharf,0,,\nM,all,v0,Balboa Park via S.F. State,0,,\n`);
  muni.set('stop_times.txt', `${muni.get('stop_times.txt')}${run('f0', [['13486', 8 * 3600 + 600], ['13477', 8 * 3600 + 720]])}\n${run('v0', [['13477', 8 * 3600 + 600], ['13500', 8 * 3600 + 1200]])}\n`);
  const bart = network.get('BA')!;
  bart.set('routes.txt', `${bart.get('routes.txt')}Grey-S,Grey-S,Coliseum to Oakland Airport,1\n`);
  bart.set(
    'stops.txt',
    [
      bart.get('stops.txt'),
      '907109,907109,San Francisco International Airport,37.616035,-122.392612,1,',
      '907101,907101,San Francisco International Airport,37.616035,-122.392612,0,907109',
      '907209,907209,Coliseum,37.753661,-122.196869,1,',
      '907201,907201,Coliseum,37.753661,-122.196869,0,907209',
      '907409,907409,Oakland International Airport,37.713238,-122.212191,1,',
      '907401,907401,Oakland International Airport Station,37.713238,-122.212191,0,907409',
    ].join('\n'),
  );
  bart.set('trips.txt', `${bart.get('trips.txt')}Yellow-S,all,sfo,San Francisco International Airport,1,,\nGrey-S,all,oak,Oakland Airport,1,,\n`);
  bart.set('stop_times.txt', `${bart.get('stop_times.txt')}${run('sfo', [['901201', 8 * 3600 + 600], ['901601', 8 * 3600 + 1080], ['907101', 8 * 3600 + 2400]])}\n${run('oak', [['907201', 8 * 3600 + 600], ['907401', 8 * 3600 + 1080]])}\n`);
  network.set(
    'GF',
    files({
      'routes.txt': 'route_id,route_short_name,route_long_name,route_type\nLARK,Larkspur,Larkspur - San Francisco,4\n',
      'stops.txt': 'stop_id,stop_code,stop_name,stop_lat,stop_lon\n43002,43002,Larkspur Ferry Terminal,37.945900,-122.508800\n43003,43003,San Francisco Ferry Building,37.795500,-122.393700\n',
      'calendar.txt': CALENDAR,
      'trips.txt': 'route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id\nLARK,all,g0,,0,,\n',
      'stop_times.txt': `trip_id,arrival_time,departure_time,stop_id,stop_sequence\n${run('g0', [['43002', 8 * 3600 + 600], ['43003', 8 * 3600 + 2400]])}\n`,
    }),
  );
  return network;
}

let schedule: Schedule;
let crowded: Schedule;
let named: Schedule;
before(() => {
  schedule = buildSchedule(feeds());
  crowded = buildSchedule(crowdedFeeds());
  named = buildSchedule(namedFeeds());
});
after(() => {
  schedule.close();
  crowded.close();
  named.close();
});

// Trains b6 to b8 are live and on time. Bus m4 (scheduled 8:32) runs 2 minutes late, bus m5
// (8:47) is canceled, and the rest of the buses and trains are known only from the schedule.
// `extra` adds to the feed.
function realtime(extra: FeedObject['entity'] = []) {
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
      ...extra,
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

test('sends the short name of the stop in To, and of no other', () => {
  const response = planTrip(schedule, realtime(), { from: 'SF:13486', to: 'SF:13500', view: 'trips' }, NOW);
  strictEqual(response.stops['SF:13500']?.shortName, '24th & Potrero');
  strictEqual(response.stops['SF:13486']?.shortName, undefined);
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
  // shows in place. Train b2 left at 7:50, so the rider may be on it: its bus, m2 at 8:02, comes
  // on top of the three they can still catch.
  deepStrictEqual(departures, [
    { bus: 'SF:m2', live: false, delay: null, canceled: false, trains: ['BA:b2:4:scheduled'] },
    { bus: 'SF:m3', live: false, delay: null, canceled: false, trains: ['BA:b3:9:scheduled'] },
    { bus: 'SF:m4', live: true, delay: 120, canceled: false, trains: ['BA:b5:6:scheduled'] },
    { bus: 'SF:m5', live: true, delay: null, canceled: true, trains: [] },
    { bus: 'SF:m6', live: false, delay: null, canceled: false, trains: ['BA:b8:4'] },
  ]);
});

test('a train that has left From stays with its live arrival, as the rider may be on it, however soon the rider hides', () => {
  // Train b2 left Montgomery at 7:50, a minute late. The feed now lists only 24th St, at 7:59.
  const left = realtime([{ id: 'b2', tripUpdate: { trip: { tripId: 'BA:b2', routeId: 'BA:Yellow-S' }, stopTimeUpdate: [{ stopId: '901601', arrival: { time: DAY + 7.5 * 3600 + 1200 + 540, delay: 60 } }] } }]);
  const group = planTrip(schedule, left, { from: 'BA:901209', to: 'SF:13477', hide: 10 }, NOW).groups[0]!;
  const connection = group.departures.find(({ trip }) => trip === 'SF:m2')?.connections.find(({ trip }) => trip === 'BA:b2');
  deepStrictEqual(connection && [connection.departs, connection.arrives, connection.live, connection.hidden], [DAY + 7.5 * 3600 + 1260, DAY + 7.5 * 3600 + 1740, true, undefined]);
});

test('a vehicle the feed says has passed counts as gone even when the delay later on would have it leave after now', () => {
  // Train b3 is due at Montgomery at 8:00, and the feed lists only 24th St, two minutes late.
  // Two minutes on Montgomery's time would be 8:02, yet the feed says it has gone.
  const b3 = { id: 'b3', tripUpdate: { trip: { tripId: 'BA:b3', routeId: 'BA:Yellow-S' }, stopTimeUpdate: [{ stopId: '901601', arrival: { time: DAY + 7.5 * 3600 + 1800 + 600, delay: 120 } }] } };
  const group = planTrip(schedule, realtime([b3]), { from: 'BA:901209', to: 'SF:13477', hide: 10 }, NOW).groups[0]!;
  const connection = group.departures.flatMap(({ connections }) => connections).find(({ trip }) => trip === 'BA:b3');
  deepStrictEqual([connection !== undefined, connection?.hidden, (connection?.departs ?? Infinity) < NOW], [true, undefined, true]);
  // Bus m2, due at Valencia at 8:00, is listed only at Potrero, a minute late: the rider may be on it.
  const m2 = { id: 'm2', tripUpdate: { trip: { tripId: 'SF:m2', routeId: 'SF:48' }, stopTimeUpdate: [{ stopId: '13500', arrival: { time: DAY + 7.5 * 3600 + 120 + 1800 + 660, delay: 60 } }] } };
  const walk = planTrip(schedule, realtime([m2]), { from: 'SF:13486', to: 'route:SF:48', dest: 'SF:13500' }, NOW).groups.find(({ kind }) => kind === 'walk')!;
  strictEqual(walk.departures.some(({ trip }) => trip === 'SF:m2'), true);
});

test('a train that has left keeps the bus it really made, and goes once that bus has, rather than taking a later one', () => {
  // At 8:05, trains b1 (7:40) and b2 (7:50) made bus m2, which left 24th St at 8:02. Train b3, which
  // left at 8:00, makes m3 at 8:17. A wide window would let b1 and b2 reach m3 too.
  const group = planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13477', max: 30 }, NOW + 300).groups[0]!;
  deepStrictEqual(group.departures.find(({ trip }) => trip === 'SF:m3')?.connections.filter(({ departs }) => departs < NOW + 300).map(({ trip }) => trip), ['BA:b3']);
  strictEqual(group.departures.some(({ trip }) => trip === 'SF:m2'), false);
});

test('a bus that has left the transfer stop stays until it reaches the destination, and without one, goes', () => {
  // At 8:05, bus m2 left 24th St at 8:02 and reaches Potrero at 8:12.
  const at = NOW + 300;
  const toPotrero = planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13477', dest: 'SF:13500' }, at).groups[0]!;
  deepStrictEqual(toPotrero.departures.find(({ trip }) => trip === 'SF:m2')?.connections.map(({ trip }) => trip), ['BA:b2']);
  const noDestination = planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13477' }, at).groups[0]!;
  strictEqual(noDestination.departures.some(({ trip }) => trip === 'SF:m2'), false);
  // Past Potrero, its ride is over.
  strictEqual(planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13477', dest: 'SF:13500' }, NOW + 800).groups[0]!.departures.some(({ trip }) => trip === 'SF:m2'), false);
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

test('a stop in To opens on transfers when a route already takes the rider there or it is a walk, and otherwise on trips', () => {
  const view = (from: string, to: string) => planTrip(schedule, realtime(), { from, to }, NOW).view;
  // BART stops 36 m from 24th & Mission's corner.
  strictEqual(view('BA:901209', 'SF:13477'), 'transfers');
  // Potrero takes BART and then the 48.
  strictEqual(view('BA:901209', 'SF:13500'), 'trips');
  // Hampshire is a block from Potrero.
  strictEqual(view('SF:13501', 'SF:13500'), 'transfers');
  // Asked for, a tab is what it shows, and a route has none.
  strictEqual(planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13500', view: 'transfers' }, NOW).view, 'transfers');
  strictEqual(view('BA:901209', 'route:SF:48'), undefined);
});

test('the trips to a stop ride BART straight there when it stops by its corner', () => {
  const response = planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13477', view: 'trips' }, NOW);
  deepStrictEqual(response.groups.map(({ kind, routes, board }) => ({ kind, routes, board })), [{ kind: 'walk', routes: ['BA:Yellow-S'], board: 'BA:901201' }]);
  const departure = response.groups[0]!.departures.find(({ canceled }) => !canceled)!;
  // Each train reaches 24th St 8 minutes after Montgomery.
  strictEqual(departure.destination, departure.at + 480);
});

test('the trips to a stop past a transfer say when each bus gets there', () => {
  const response = planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13500', view: 'trips' }, NOW);
  deepStrictEqual(response.groups.map(({ kind, alight, board, routes }) => ({ kind, alight, board, routes })), [{ kind: undefined, alight: 'BA:901609', board: 'SF:13477', routes: ['SF:48'] }]);
  const m4 = response.groups[0]!.departures.find(({ trip }) => trip === 'SF:m4')!;
  // Two minutes late leaving 24th St, it reaches Potrero 10 minutes later.
  strictEqual(m4.destination, m4.at + 600);
  // The stop is the destination, so one sent along with it changes nothing.
  deepStrictEqual(planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13500', dest: 'BA:902109', view: 'trips' }, NOW).groups, response.groups);
});

test('the trips to a station a block away say it is a walk, and those to one further ride there', () => {
  // 24th & Valencia is under 200 m from 24th St Mission's entrance.
  const near = planTrip(schedule, realtime(), { from: 'SF:13486', to: 'BA:901609', view: 'trips' }, NOW);
  deepStrictEqual([near.groups, near.notice], [[], { kind: 'walkable', stop: 'BA:901609', meters: 187 }]);
  const glenPark = planTrip(schedule, realtime(), { from: 'SF:13486', to: 'BA:902109', view: 'trips' }, NOW).groups[0]!;
  const departure = glenPark.departures.find(({ canceled }) => !canceled)!;
  // Trains reach Glen Park 4 minutes after 24th St.
  deepStrictEqual([glenPark.kind, departure.destination], ['walk', departure.at + 240]);
});

test('the trips to a stop say when nothing on a way runs, whatever the window, and name each way by where it boards', () => {
  // At 11, BART here has stopped for the day, though the 48 runs again from 2.
  const late = planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13500', view: 'trips' }, DAY + 11 * 3600);
  deepStrictEqual(late.groups.map(({ idle, key }) => ({ idle, key })), [{ idle: true, key: 'ride>SF:13477' }]);
  // At 8 it runs, so a window nothing fits is the rider's own doing, not a lack of service.
  const strict = planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13500', view: 'trips', min: 30, max: 30 }, NOW);
  deepStrictEqual(strict.groups.map(({ idle }) => idle), [undefined]);
  // Transfers groups keep the identity they always had.
  strictEqual(planTrip(schedule, realtime(), { from: 'BA:901209', to: 'route:SF:48' }, NOW).groups[0]!.key, undefined);
});

test('with nothing typed, From lists the stops nearest the rider, and how far each is', () => {
  // On 24th St, a few steps east of Mission.
  const near = search(schedule, '', { routes: false, near: { lat: 37.752178, lon: -122.41845 } }).results.map((result) => (result.type === 'stop' ? `${result.key} ${result.meters}` : ''));
  // 24th & Capp, a few meters off, has no routes, so it is no place to start.
  deepStrictEqual(near, ['SF:13477 10', 'BA:901609 40', 'SF:13486 220']);
  deepStrictEqual(search(schedule, '', { routes: false }).results, []);
});

test('a station comes first for the start of its name, even among many street stops that share it', () => {
  // The case only means something if text rank alone puts the station past the first 60.
  const station = crowded.stopsByKey.get('BA:901209')!.id;
  const byText = all<{ id: number }>(crowded.db, 'SELECT rowid AS id FROM stop_search WHERE stop_search MATCH ? ORDER BY rank', '"mont"*');
  ok(byText.findIndex(({ id }) => id === station) >= 60);
  const results = search(crowded, 'mont', { routes: false }).results;
  strictEqual(results[0]?.type === 'stop' && results[0].key, 'BA:901209');
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

test('a named stop a short walk away whose route is not running says so, not that it is a walk', () => {
  // At 3 AM no 48 runs. Walking to 24th & Mission would mean waiting there for hours.
  const response = planTrip(schedule, realtime(), { from: 'SF:13478', to: 'SF:13477' }, DAY + 3 * 3600);
  deepStrictEqual(response.groups, []);
  strictEqual(response.notice?.kind, 'idle');
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

test('step-free travel allows more time to change at a station and lists elevator outages on the trip', () => {
  const outages = [
    { station: '24th', kind: 'elevator' as const, location: 'Street to Concourse', reason: 'Repair', returns: '10/23/2026' },
    { station: 'mont', kind: 'escalator' as const, location: 'Platform', reason: 'Repair', returns: null },
    // Glen Park is not on this trip.
    { station: 'glen', kind: 'elevator' as const, location: 'Station', reason: null, returns: null },
  ];
  const plain = planTrip(schedule, { ...realtime(), access: outages }, { from: 'BA:901209', to: 'SF:13477' }, NOW);
  deepStrictEqual([plain.groups[0]?.window.min, plain.access], [3, undefined]);
  // Getting off BART at 24th St, three more minutes, and 24th St's elevator outage.
  const stepFree = planTrip(schedule, { ...realtime(), access: outages }, { from: 'BA:901209', to: 'SF:13477', stepFree: true }, NOW);
  strictEqual(stepFree.groups[0]?.window.min, 6);
  deepStrictEqual(stepFree.access, [{ station: 'BA:901609', stops: ['BA:901609'], kind: 'elevator', location: 'Street to Concourse', reason: 'Repair', returns: '10/23/2026' }]);
  // A minimum the rider set is theirs: the page sends the window back as shown, and editing only
  // the maximum must not add the allowance again.
  const own = planTrip(schedule, { ...realtime(), access: outages }, { from: 'BA:901209', to: 'SF:13477', stepFree: true, min: 6, max: 16 }, NOW);
  deepStrictEqual(own.groups[0]?.window, { min: 6, max: 16 });
  // Escalators too: Montgomery's, where the rider gets on, listed first, in the order of the trip.
  const both = planTrip(schedule, { ...realtime(), access: outages }, { from: 'BA:901209', to: 'SF:13477', stepFree: true, escalators: true }, NOW);
  deepStrictEqual(both.access?.map(({ station, kind, stops }) => `${kind} ${station} ${stops.join(',')}`), ['escalator BA:901209 BA:901209', 'elevator BA:901609 BA:901609']);
});

test("a rider who chose Muni Metro at a shared station is not shown BART's platform outages there", () => {
  const outages = [
    { station: 'mont', kind: 'elevator' as const, location: 'Platform', reason: null, returns: null },
    { station: 'mont', kind: 'elevator' as const, location: 'Street to Concourse', reason: null, returns: null },
  ];
  const locations = (fromAgencies?: ('BA' | 'SF')[]) =>
    planTrip(schedule, { ...realtime(), access: outages }, { from: 'BA:901209', to: 'SF:13477', stepFree: true, ...(fromAgencies ? { fromAgencies } : {}) }, NOW).access?.map(({ location }) => location);
  deepStrictEqual(locations(), ['Platform', 'Street to Concourse']);
  deepStrictEqual(locations(['SF']), ['Street to Concourse']);
  // Riding the N from Montgomery's Muni Metro platform, which the shared station takes in.
  const metro = planTrip(schedule, { ...realtime(), access: outages }, { from: 'SF:16994', to: 'SF:16998', stepFree: true }, NOW);
  deepStrictEqual(metro.access?.map(({ location }) => location), ['Street to Concourse']);
  // From the shared station with no system chosen, but only the N leaves it toward Church.
  const onlyMetro = planTrip(schedule, { ...realtime(), access: outages }, { from: 'BA:901209', to: 'SF:16998', stepFree: true }, NOW);
  deepStrictEqual(onlyMetro.access?.map(({ location }) => location), ['Street to Concourse']);
});

test('nearby leaves out a route with nothing coming, and keeps its stop on the map', () => {
  const station = { lat: 37.752419, lon: -122.418468 };
  const routesAt = (now: number) => nearby(schedule, realtime(), station, 400, now).nearby.map(({ routes }) => routes.join(','));
  deepStrictEqual(routesAt(NOW), ['BA:Yellow-S', 'SF:48']);
  // The fixture's trains run only in the morning, and afternoon 48s start at 2 PM.
  const afternoon = DAY + 13.5 * 3600;
  const response = nearby(schedule, realtime(), station, 400, afternoon);
  deepStrictEqual(response.nearby.map(({ routes }) => routes.join(',')), ['SF:48']);
  ok(response.nearby.every(({ arrivals }) => arrivals.length > 0));
  ok(response.schematic.stops.some(({ stop }) => stop === 'BA:901609'));
});

test('nearby shows a route at its next nearest stop when nothing comes to the nearest', () => {
  // An early 48 starts at 24th & Capp, 92 m east of 24th & Mission, where no other 48 stops.
  const network = feeds();
  const muni = network.get('SF')!;
  muni.set('trips.txt', `${muni.get('trips.txt')}48,all,early,22nd St + Iowa St,1,,\n`);
  muni.set('stop_times.txt', `${muni.get('stop_times.txt')}${[['13478', 0], ['13477', 120], ['13500', 720]].map(([stop, after], n) => `early,${clock(5.5 * 3600 + Number(after))},${clock(5.5 * 3600 + Number(after))},${stop},${n + 1}`).join('\n')}\n`);
  const early = buildSchedule(network);
  try {
    const response = nearby(early, realtime(), { lat: 37.752178, lon: -122.4175 }, 400, NOW);
    const row = response.nearby.find(({ routes }) => routes.includes('SF:48'));
    strictEqual(row?.stop, 'SF:13477');
    ok(row.arrivals.length > 0);
    // The stop it shows at is on the map, and so is the idle nearest one, as another stop.
    ok(['SF:13477', 'SF:13478'].every((key) => response.schematic.stops.some(({ stop }) => stop === key)));
  } finally {
    early.close();
  }
});

test('a pinned trip follows its vehicles where the rider gets on and off, and the destination the search has now', () => {
  const plain = planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13477' }, NOW);
  const group = plain.groups[0]!;
  const departure = group.departures.find(({ connections, canceled }) => !canceled && connections.some(({ live }) => live))!;
  const connection = departure.connections.find(({ live }) => live)!;
  const pin = { first: { trip: connection.trip, alight: group.alight }, second: { trip: departure.trip, board: group.board }, at: departure.at };
  const pinned = planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13477', pin }, NOW).pinned!;
  deepStrictEqual(pinned.first, {
    trip: connection.trip,
    route: connection.route,
    on: { stop: 'BA:901209', at: connection.departs, delay: 0 },
    off: { stop: group.alight, at: connection.arrives, delay: 0 },
    live: true,
  });
  deepStrictEqual(pinned.second?.on, { stop: group.board, at: departure.at, delay: departure.delay });
  strictEqual(pinned.second?.off, null);
  // A destination set later is where the second vehicle's part of the trip ends: the 48 reaches
  // Potrero 10 minutes after 24th St.
  const toPotrero = planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13477', dest: 'SF:13500', pin }, NOW).pinned!;
  strictEqual(toPotrero.second?.off?.at, departure.at + 600);
  strictEqual(toPotrero.second?.off?.stop, 'SF:13500');
  // The answer names the pin it is for, so a page can tell it from one for a pin since replaced.
  deepStrictEqual(planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13477', pin }, NOW).pin, pin);
});

test('a pinned trip counts a delay as its results do, by the delay the feed gives', () => {
  // Train b9 is due at 9:00 and 9:08 by the feed, a minute after the schedule here, which the feed
  // counts as on time.
  const leaves = DAY + 9 * 3600;
  const update = (stopId: string, time: number) => ({ stopId, arrival: { time, delay: 0 } });
  const late = realtime([{ id: 'b9', tripUpdate: { trip: { tripId: 'BA:b9', routeId: 'BA:Yellow-S' }, stopTimeUpdate: [update('901201', leaves + 60), update('901601', leaves + 540)] } }]);
  const pin = { first: { trip: 'BA:b9', alight: 'BA:901609', at: leaves + 480 }, second: { trip: 'SF:m6', board: 'SF:13477' }, at: DAY + 9 * 3600 + 17 * 60 };
  const pinned = planTrip(schedule, late, { from: 'BA:901209', to: 'SF:13477', pin }, NOW).pinned!;
  deepStrictEqual([pinned.first?.on, pinned.first?.off], [
    { stop: 'BA:901209', at: leaves + 60, delay: 0 },
    { stop: 'BA:901609', at: leaves + 540, delay: 0 },
  ]);
});

test("a pinned trip from another day keeps to that day's schedule, and a canceled one says so", () => {
  const plain = planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13477' }, NOW);
  const group = plain.groups[0]!;
  const departure = group.departures.find(({ canceled, live }) => !canceled && !live)!;
  const yesterday = { second: { trip: departure.trip, board: group.board }, at: departure.at - 86_400 };
  const old = planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13477', pin: yesterday }, NOW).pinned!;
  deepStrictEqual(old.second?.on, { stop: group.board, at: departure.at - 86_400, delay: null });
  strictEqual(old.second?.live, false);
  // Bus m5, due at 8:47, is canceled in the feed.
  const canceled = { second: { trip: 'SF:m5', board: group.board }, at: DAY + 8 * 3600 + 47 * 60 };
  strictEqual(planTrip(schedule, realtime(), { from: 'BA:901209', to: 'SF:13477', pin: canceled }, NOW).pinned?.second?.canceled, true);
});

test('a pinned ride straight to a named To stop ends there, as its results do', () => {
  // The 48 already stops at Valencia, From, and reaches 24th & Mission, To.
  const plain = planTrip(schedule, realtime(), { from: 'SF:13486', to: 'SF:13477' }, NOW);
  const group = plain.groups.find(({ kind }) => kind === 'walk')!;
  const departure = group.departures.find(({ canceled, destination }) => !canceled && destination !== undefined)!;
  const pin = { second: { trip: departure.trip, board: group.board }, at: departure.at };
  const pinned = planTrip(schedule, realtime(), { from: 'SF:13486', to: 'SF:13477', pin }, NOW).pinned!;
  deepStrictEqual(pinned.second?.off, { stop: 'SF:13477', at: departure.destination, delay: departure.delay });
});

test("a pinned loop keeps the visit it was pinned at once the vehicle has gone past it", () => {
  // A 48 that leaves Valencia at 8:10, loops back past it at 8:20, and ends at Potrero.
  const network = feeds();
  const muni = network.get('SF')!;
  muni.set('trips.txt', `${muni.get('trips.txt')}48,all,loop,22nd St + Iowa St,1,,\n`);
  const visits: [string, number][] = [['13486', 8 * 3600 + 600], ['13477', 8 * 3600 + 720], ['13486', 8 * 3600 + 1200], ['13500', 8 * 3600 + 1800]];
  muni.set('stop_times.txt', `${muni.get('stop_times.txt')}${visits.map(([stop, at], n) => `loop,${clock(at)},${clock(at)},${stop},${n + 1}`).join('\n')}\n`);
  const looped = buildSchedule(network);
  try {
    const pin = { second: { trip: 'SF:loop', board: 'SF:13486' }, at: DAY + 8 * 3600 + 600 };
    // To a route, so nothing past boarding pins where the rider goes on it.
    const at = (now: number) => planTrip(looped, realtime(), { from: 'BA:901209', to: 'route:SF:48', pin }, now).pinned?.second?.on?.at;
    strictEqual(at(NOW), DAY + 8 * 3600 + 600);
    // At 8:15, past the first visit and before the second.
    strictEqual(at(DAY + 8 * 3600 + 900), DAY + 8 * 3600 + 600);
    // Running 8 minutes late, its first visit is due at 8:18, nearer the second's 8:20 on the
    // schedule. The pin names the visit by its schedule, so it keeps the first.
    const late = realtime([{ id: 'loop', tripUpdate: { trip: { tripId: 'SF:loop', routeId: 'SF:48' }, stopTimeUpdate: [{ stopId: '13486', stopSequence: 1, arrival: { time: DAY + 8 * 3600 + 1080, delay: 480 } }] } }]);
    strictEqual(planTrip(looped, late, { from: 'BA:901209', to: 'route:SF:48', pin }, NOW).pinned?.second?.on?.at, DAY + 8 * 3600 + 1080);
    // A feed that sends the time alone: the results count the delay at the visit the update names,
    // so a pin made from them, the time less the delay, names that visit too.
    const timeOnly = realtime([{ id: 'loop', tripUpdate: { trip: { tripId: 'SF:loop', routeId: 'SF:48' }, stopTimeUpdate: [{ stopId: '13486', stopSequence: 1, arrival: { time: DAY + 8 * 3600 + 1080 } }] } }]);
    const results = planTrip(looped, timeOnly, { from: 'SF:13486', to: 'route:SF:48' }, NOW);
    const departure = results.groups.flatMap(({ departures }) => departures).find(({ trip }) => trip === 'SF:loop')!;
    deepStrictEqual([departure.at, departure.delay], [DAY + 8 * 3600 + 1080, 480]);
    const fromResults = { second: { trip: 'SF:loop', board: results.groups[0]!.board }, at: departure.at - departure.delay! };
    strictEqual(planTrip(looped, timeOnly, { from: 'SF:13486', to: 'route:SF:48', pin: fromResults }, NOW).pinned?.second?.on?.at, DAY + 8 * 3600 + 1080);
  } finally {
    looped.close();
  }
});

test('a route that ends at To is a ride straight there, with when each bus arrives', () => {
  const response = planTrip(schedule, realtime(), { from: 'SF:13486', to: 'SF:13500' }, NOW);
  deepStrictEqual(
    response.groups.map(({ kind, board, routes }) => ({ kind, board, routes })),
    [{ kind: 'walk', board: 'SF:13486', routes: ['SF:48'] }],
  );
  const m2 = response.groups[0]!.departures.find(({ trip }) => trip === 'SF:m2')!;
  strictEqual(m2.destination, m2.at + 720);
});

test("a stop's arrivals list each route and direction there, soonest first, and a platform opens its station", () => {
  const street = stopArrivals(schedule, realtime(), 'SF:13477', NOW);
  strictEqual(street.stop, 'SF:13477');
  deepStrictEqual(street.rows.map(({ routes }) => routes), [['SF:48']]);
  const times = street.rows[0]!.arrivals.map(({ at }) => at);
  deepStrictEqual(times, [...times].sort((a, b) => a - b));
  ok(times.length > 0 && times.length <= 6 && times.every((at) => at >= NOW - 30));
  // The 8:47 is canceled, so it is left out.
  ok(street.rows[0]!.arrivals.every(({ trip }) => trip !== 'SF:m5'));
  // Montgomery's BART platform stands for the station, whose Muni Metro platform comes too.
  const station = stopArrivals(schedule, realtime(), 'BA:901201', NOW);
  strictEqual(station.stop, 'BA:901209');
  deepStrictEqual(station.rows.map(({ routes }) => routes.join(',')).sort(), ['BA:Yellow-S', 'SF:N']);
  ok(station.rows.every(({ stop }) => stop === 'BA:901209'));
  throws(() => stopArrivals(schedule, realtime(), 'SF:0', NOW), /No stop/);
});

test('every page names a direction as results do: a ferry by its last stop, a backtick as ’, and no "via"', () => {
  const headsignOf = (rows: { routes: string[]; headsign: string }[], route: string) => rows.find(({ routes }) => routes.includes(route))?.headsign;
  const near = nearby(named, realtime(), { lat: 37.752178, lon: -122.41855 }, 400, NOW).nearby;
  deepStrictEqual([headsignOf(near, 'SF:F'), headsignOf(near, 'SF:M')], ['Fisherman’s Wharf', 'Balboa Park']);
  deepStrictEqual(stopArrivals(named, realtime(), 'GF:43002', NOW).rows.map(({ headsign }) => headsign), ['San Francisco Ferry Building']);
  const toward = (code: string) => search(named, code, { routes: false }).results.flatMap((result) => (result.type === 'stop' ? result.toward : []));
  deepStrictEqual([toward('13486'), toward('13477'), toward('43002')], [['22nd St + Iowa St', 'Fisherman’s Wharf'], ['22nd St + Iowa St', 'Balboa Park'], ['San Francisco Ferry Building']]);
  const [route] = search(named, 'M', { routes: true }).results.filter((result) => result.type === 'route');
  deepStrictEqual(route?.directions.map(({ headsign }) => headsign), ['Balboa Park']);
  // An M to Balboa Park via S.F. State goes where its group does, so it says nothing more.
  const group = planTrip(named, realtime(), { from: 'SF:13477', to: 'route:SF:M' }, NOW).groups[0]!;
  deepStrictEqual([group.headsign, group.departures.map(({ toward }) => toward ?? null)], ['Balboa Park', [null]]);
});

test('the live map names where a vehicle is going as results do, BART by the place its line ends', () => {
  const headsign = (trip: string, stop: string) => trackVehicle(named, { vehicles: null }, { trip, stop }, NOW).headsign;
  deepStrictEqual(
    [headsign('BA:sfo', 'BA:901601'), headsign('BA:oak', 'BA:907201'), headsign('SF:f0', 'SF:13477'), headsign('SF:v0', 'SF:13477')],
    ['SFO', 'Oakland Airport', 'Fisherman’s Wharf', 'Balboa Park'],
  );
  // Oakland's airport is no more SFO in results than on the map.
  strictEqual(planTrip(named, realtime(), { from: 'BA:907209', to: 'route:BA:Grey-S' }, NOW).groups[0]?.headsign, 'Oakland Airport');
});
