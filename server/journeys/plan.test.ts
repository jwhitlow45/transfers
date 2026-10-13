import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { RideLeg } from '../../shared/journeys.ts';
import type { Agency } from '../config.ts';
import type { RealtimeView } from '../engine/realtime-view.ts';
import { RequestError } from '../http.ts';
import { type FeedObject, decodeFeed, encodeFeed } from '../realtime/feed.ts';
import { buildAlerts, buildTripSnapshot } from '../realtime/snapshot.ts';
import { changeSeconds, walkBetween } from '../engine/links.ts';
import type { WalkSettings } from '../engine/walk.ts';
import type { Schedule } from '../schedule.ts';
import { CALENDAR, buildSchedule, clock, files } from '../test-gtfs.ts';
import { serviceDayStart } from '../time.ts';
import { footpathsFor, walksFor } from './footpaths.ts';
import { type Endpoint, type JourneyOptions, planJourneys, prepareJourneys, readEnds } from './plan.ts';

// BART from Montgomery to 24th St every 10 minutes from 7:30, the 48 from 24th & Mission to
// Potrero every 15 minutes from 7:32, and the 22 from a stop a few steps up Potrero to Dogpatch
// every 10 minutes from 7:45. Montgomery to Dogpatch takes all three.
const DAY = serviceDayStart(20261005);
const NOW = DAY + 8 * 3600;

function feeds() {
  const runs = (count: number, first: number, every: number, trip: (n: number, at: number) => string[]) => Array.from({ length: count }, (_, n) => trip(n, first + n * every)).flat();
  const trips = (rows: string[]) => `route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id\n${rows.join('\n')}\n`;
  const times = (rows: string[]) => `trip_id,arrival_time,departure_time,stop_id,stop_sequence\n${rows.join('\n')}\n`;
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
        ].join('\n'),
        'calendar.txt': CALENDAR,
        'trips.txt': trips(runs(12, 7.5 * 3600, 600, (n) => [`Yellow-S,all,b${n},SFO,1,,`])),
        'stop_times.txt': times(runs(12, 7.5 * 3600, 600, (n, at) => [`b${n},${clock(at)},${clock(at)},901201,1`, `b${n},${clock(at + 480)},${clock(at + 480)},901601,2`])),
      }),
    ],
    [
      'SF',
      files({
        'routes.txt': 'route_id,route_short_name,route_long_name,route_type\n48,48,QUINTARA/24TH STREET,3\n22,22,FILLMORE,3\n',
        'stops.txt': [
          'stop_id,stop_code,stop_name,stop_lat,stop_lon',
          '13477,13477,24th St & Mission St,37.752178,-122.41855',
          '13500,13500,24th St & Potrero Ave,37.752900,-122.406500',
          '13600,13600,Potrero Ave & 24th St,37.753400,-122.406500',
          '13700,13700,3rd St & 22nd St,37.757700,-122.388700',
        ].join('\n'),
        'calendar.txt': CALENDAR,
        'trips.txt': trips([...runs(8, 0, 0, (n) => [`48,all,m${n},22nd St + Iowa St,1,,`]), ...runs(10, 0, 0, (n) => [`22,all,t${n},Dogpatch,1,,`])]),
        'stop_times.txt': times([
          ...runs(8, 7.5 * 3600 + 120, 900, (n, at) => [`m${n},${clock(at)},${clock(at)},13477,1`, `m${n},${clock(at + 600)},${clock(at + 600)},13500,2`]),
          ...runs(10, 7.75 * 3600, 600, (n, at) => [`t${n},${clock(at)},${clock(at)},13600,1`, `t${n},${clock(at + 720)},${clock(at + 720)},13700,2`]),
        ]),
      }),
    ],
  ]);
}

// Through the real encoder and decoder, as the server reads the feed.
function realtime(entities: FeedObject['entity'] = [], now = NOW): RealtimeView {
  const decoded = decodeFeed(encodeFeed({ header: { gtfsRealtimeVersion: '2.0', timestamp: now }, entity: entities }));
  const agencies = new Set<Agency>(['SF', 'BA']);
  return { trips: buildTripSnapshot(decoded, now, agencies), alerts: buildAlerts(decoded, now, agencies), status: () => 'live', updatedAt: now };
}

let schedule: Schedule;
before(() => {
  schedule = buildSchedule(feeds());
});
after(() => schedule.close());

const stop = (key: string): Endpoint => ({ kind: 'stop', stop: schedule.stopsByKey.get(key)! });
const point = (lat: number, lon: number, name = 'Your location'): Endpoint => ({ kind: 'point', name, at: { lat, lon } });
const rideLegs = (legs: { kind: string }[]) => legs.filter((leg): leg is RideLeg => leg.kind === 'ride');
const rides = (legs: { kind: string }[]) => rideLegs(legs).map(({ route, departs }) => `${route} ${clock(departs - DAY)}`);
// The feed's word on one 48, by its trip number: `delay` seconds late at 24th & Mission and Potrero.
const fortyEight = (n: number, delay: number) => {
  const at = DAY + 7.5 * 3600 + 120 + n * 900 + delay;
  return {
    id: `m${n}`,
    tripUpdate: {
      trip: { tripId: `SF:m${n}`, routeId: 'SF:48' },
      stopTimeUpdate: [
        { stopId: '13477', arrival: { time: at, delay } },
        { stopId: '13500', arrival: { time: at + 600, delay } },
      ],
    },
  };
};

test('a journey takes as many vehicles as it needs, walking between stops, and boards each as late as still makes the next', () => {
  const response = planJourneys(schedule, realtime(), stop('BA:901209'), stop('SF:13700'), NOW);
  const [first] = response.journeys;
  // BART at 8:00 reaches 24th St at 8:08, J's 3 minute change makes the 8:17 48, which reaches
  // Potrero at 8:27, and a walk up Potrero makes the 8:35 22.
  deepStrictEqual(rides(first!.legs), ['BA:Yellow-S 8:00:00', 'SF:48 8:17:00', 'SF:22 8:35:00']);
  deepStrictEqual(first!.legs.map(({ kind }) => kind), ['ride', 'walk', 'ride', 'walk', 'ride']);
  deepStrictEqual([first!.leaves, first!.arrives, first!.rides], [NOW, DAY + 8 * 3600 + 47 * 60, 3]);
  // A rider changes at a station, not a platform. Each vehicle heads where its page would say:
  // BART by the last station of its line, the 48 by its headsign.
  deepStrictEqual(rideLegs(first!.legs).map(({ from, to, toward }) => `${from}>${to} ${toward}`), [
    'BA:901209>BA:901609 24th Street/Mission',
    'SF:13477>SF:13500 22nd St + Iowa St',
    'SF:13600>SF:13700 Dogpatch',
  ]);
  deepStrictEqual(first!.legs[1], { kind: 'walk', from: 'BA:901609', to: 'SF:13477', seconds: 180 });
  // The next ways go later, each its own.
  strictEqual(new Set(response.journeys.map(({ legs }) => rides(legs).join())).size, response.journeys.length);
  ok(response.journeys.every(({ leaves }, n) => n === 0 || leaves >= response.journeys[n - 1]!.leaves));
  deepStrictEqual(response.feeds.map(({ agency }) => agency).sort(), ['BA', 'SF']);
  ok(['BA:Yellow-S', 'SF:48', 'SF:22'].every((route) => response.routes[route]));
});

test('a journey from where the rider is walks to the nearest stops first', () => {
  // A few steps from 24th & Mission, closer to the bus than to the train.
  const response = planJourneys(schedule, realtime(), point(37.7521, -122.4191), stop('SF:13700'), NOW);
  const [first] = response.journeys;
  const walk = first!.legs[0]!;
  deepStrictEqual([walk.kind, walk.kind === 'walk' && walk.from, walk.kind === 'walk' && walk.to], ['walk', null, 'SF:13477']);
  deepStrictEqual(rides(first!.legs), ['SF:48 8:02:00', 'SF:22 8:15:00']);
  // The rider sets off with just the time the walk takes.
  strictEqual(first!.leaves, DAY + 8 * 3600 + 120 - (walk.kind === 'walk' ? walk.seconds : 0));
  deepStrictEqual(response.from, { kind: 'point', name: 'Your location', lat: 37.7521, lon: -122.4191 });
  // A slower walker takes longer to reach the stop.
  const slow = planJourneys(schedule, realtime(), point(37.7521, -122.4191), stop('SF:13700'), NOW, { speed: 0.7 }).journeys[0]!.legs[0]!;
  ok(slow.kind === 'walk' && walk.kind === 'walk' && slow.seconds > walk.seconds);
});

test('a journey to a place walks from the nearest stops, and one to a place within a walk offers the walk', () => {
  const toPlace = planJourneys(schedule, realtime(), stop('BA:901209'), point(37.7585, -122.3887, 'Dogpatch Saloon'), NOW);
  const last = toPlace.journeys[0]!.legs.at(-1)!;
  deepStrictEqual([last.kind, last.kind === 'walk' && last.from, last.kind === 'walk' && last.to], ['walk', 'SF:13700', null]);
  deepStrictEqual(toPlace.to, { kind: 'point', name: 'Dogpatch Saloon', lat: 37.7585, lon: -122.3887 });
  const short = planJourneys(schedule, realtime(), stop('SF:13500'), point(37.7535, -122.405, 'Corner'), NOW);
  deepStrictEqual(short.journeys[0], { leaves: NOW, arrives: short.journeys[0]!.arrives, rides: 0, legs: [{ kind: 'walk', from: 'SF:13500', to: null, seconds: short.journeys[0]!.arrives - NOW }] });
});

test('walking all the way is offered however far when nothing gets there sooner', () => {
  // Over 2 km apart, a long walk each side of the one stop near both, and walking straight there
  // is quicker than by way of it. At 10 nothing runs at all.
  const [north, south] = [point(37.7685, -122.3887, 'North'), point(37.7469, -122.3887, 'South')];
  for (const now of [NOW, DAY + 10 * 3600]) {
    const { journeys } = planJourneys(schedule, realtime([], now), north, south, now);
    deepStrictEqual(journeys.map(({ rides, legs }) => `${rides} ${legs.map(({ kind }) => kind)}`), ['0 walk']);
    ok(journeys[0]!.arrives - now > 2000 / 1.4);
  }
});

test('a trip from or to somewhere no stop is near says so', () => {
  const nowhere = point(37.9, -122.6, 'Point Reyes');
  deepStrictEqual(planJourneys(schedule, realtime(), nowhere, stop('SF:13700'), NOW).notice, { kind: 'far', end: 'from' });
  deepStrictEqual(planJourneys(schedule, realtime(), stop('SF:13700'), nowhere, NOW).notice, { kind: 'far', end: 'to' });
  strictEqual(planJourneys(schedule, realtime(), stop('BA:901209'), stop('SF:13700'), NOW).notice, undefined);
});

test("the feed's predictions time a journey where it has them", () => {
  // The 8:17 48 runs 2 minutes late, and still makes the 8:35 22.
  const first = planJourneys(schedule, realtime([fortyEight(3, 120)]), stop('BA:901209'), stop('SF:13700'), NOW).journeys[0]!;
  const bus = rideLegs(first.legs).find(({ route }) => route === 'SF:48')!;
  deepStrictEqual([bus.trip, bus.live, bus.departs - DAY, bus.departDelay, bus.arriveDelay], ['SF:m3', true, 8 * 3600 + 19 * 60, 120, 120]);
  deepStrictEqual(rides(first.legs).at(-1), 'SF:22 8:35:00');
  const train = rideLegs(first.legs)[0]!;
  deepStrictEqual([train.live, train.departDelay], [false, null]);
  // 16 minutes late, it comes after the 8:32, so the rider takes that one and the train before it.
  // Setting off now, walking there gets in a moment sooner.
  const late = planJourneys(schedule, realtime([fortyEight(3, 960)]), stop('BA:901209'), stop('SF:13700'), NOW).journeys;
  deepStrictEqual(late.slice(0, 2).map(({ legs }) => rides(legs)), [[], ['BA:Yellow-S 8:20:00', 'SF:48 8:32:00', 'SF:22 8:45:00']]);
  ok(late[0]!.arrives < late[1]!.arrives);
});

test('a journey never relies on a canceled trip, or one that has left the stop', () => {
  const canceled = realtime([{ id: 'm3', tripUpdate: { trip: { tripId: 'SF:m3', routeId: 'SF:48', scheduleRelationship: 'CANCELED' } } }]);
  const journeys = planJourneys(schedule, canceled, stop('BA:901209'), stop('SF:13700'), NOW).journeys;
  ok(journeys.length > 0);
  ok(journeys.every(({ legs }) => rideLegs(legs).every(({ trip }) => trip !== 'SF:m3')));
  deepStrictEqual(rides(journeys.find(({ rides }) => rides > 0)!.legs), ['BA:Yellow-S 8:20:00', 'SF:48 8:32:00', 'SF:22 8:45:00']);
  // At 8:16 the feed lists the 8:17 48 only at Potrero, so it has left 24th & Mission early,
  // though its delay there would put it a minute away.
  const now = DAY + 8 * 3600 + 16 * 60;
  const left = realtime([{ id: 'm3', tripUpdate: { trip: { tripId: 'SF:m3', routeId: 'SF:48' }, stopTimeUpdate: [{ stopId: '13500', arrival: { time: DAY + 8 * 3600 + 29 * 60, delay: 120 } }] } }], now);
  const ridden = planJourneys(schedule, left, stop('SF:13477'), stop('SF:13500'), now).journeys.find(({ rides }) => rides > 0)!;
  deepStrictEqual(rides(ridden.legs), ['SF:48 8:32:00']);
});

test('the answer carries the alerts on the routes and stops its journeys use', () => {
  const alert = (id: string, routeId: string, text: string) => ({ id, alert: { informedEntity: [{ agencyId: 'SF', routeId }], headerText: { translation: [{ text, language: 'en' }] } } });
  const response = planJourneys(schedule, realtime([alert('a48', 'SF:48', '48 detour'), alert('a9', 'SF:9', '9 detour')]), stop('BA:901209'), stop('SF:13700'), NOW);
  deepStrictEqual(response.alerts.map(({ header, relevance }) => `${header} ${relevance}`), ['48 detour route']);
});

test("a change's walks reach as far as the rider walks, from a station further, each timed at their pace as a transfer is", () => {
  const paths = footpathsFor(schedule);
  const row = (key: string) => schedule.stopsByKey.get(key)!;
  const seconds = (from: string, to: string, settings: WalkSettings = {}) => walksFor(paths.get(row(from).id), settings).find(({ stop }) => stop === row(to).id)?.seconds;
  for (const speed of [undefined, 0.9, 1.4]) {
    const change = changeSeconds(walkBetween(schedule, row('SF:13500'), row('SF:13600')), row('SF:13500'), row('SF:13600'), speed);
    strictEqual(seconds('SF:13500', 'SF:13600', speed ? { speed } : {}), Math.ceil(change));
  }
  // The two corners of 24th and Potrero are 56 m apart.
  strictEqual(seconds('SF:13500', 'SF:13600', { walk: 50 }), undefined);
  // About 1,060 m along 24th Street from the train or the bus at Mission, which counts as 700 from
  // the station.
  deepStrictEqual([seconds('BA:901601', 'SF:13500', { walk: 800 }) !== undefined, seconds('SF:13477', 'SF:13500', { walk: 800 }) !== undefined], [true, false]);
  // The change J timed takes as long at any pace.
  deepStrictEqual([seconds('BA:901601', 'SF:13477'), seconds('BA:901601', 'SF:13477', { speed: 0.9 })], [180, 180]);
  // However many settings ask, the walks are worked out once.
  strictEqual(footpathsFor(schedule), paths);
});

test('step-free travel allows more time to change at a station and lists the outages at the stations the journeys use', () => {
  const outages = [
    { station: '24th', kind: 'elevator' as const, location: 'Street to Concourse', reason: 'Repair', returns: '10/23/2026' },
    { station: 'mont', kind: 'escalator' as const, location: 'Platform', reason: 'Repair', returns: null },
    // Glen Park is not on these journeys.
    { station: 'glen', kind: 'elevator' as const, location: 'Station', reason: null, returns: null },
  ];
  const plan = (options: JourneyOptions = {}) => planJourneys(schedule, { ...realtime(), access: outages }, stop('BA:901209'), stop('SF:13700'), NOW, options);
  const plain = plan();
  deepStrictEqual([plain.journeys[0]!.legs[1], plain.access], [{ kind: 'walk', from: 'BA:901609', to: 'SF:13477', seconds: 180 }, undefined]);
  // Getting off BART at 24th St takes three minutes more, and its elevator is out. Changing between
  // buses takes no longer.
  const stepFree = plan({ stepFree: true });
  deepStrictEqual(stepFree.journeys[0]!.legs[1], { kind: 'walk', from: 'BA:901609', to: 'SF:13477', seconds: 360 });
  deepStrictEqual(stepFree.journeys[0]!.legs[3], plain.journeys[0]!.legs[3]);
  deepStrictEqual(stepFree.access, [{ station: 'BA:901609', stops: ['BA:901609'], kind: 'elevator', location: 'Street to Concourse', reason: 'Repair', returns: '10/23/2026' }]);
  ok(stepFree.stops['BA:901609']);
  // Riding BART from Montgomery, its platform escalators are on the way. Escalators alone leave
  // the time to change as it is.
  const both = plan({ stepFree: true, escalators: true });
  deepStrictEqual(both.access?.map(({ kind, station }) => `${kind} ${station}`), ['escalator BA:901209', 'elevator BA:901609']);
  deepStrictEqual(plan({ escalators: true }).journeys[0]!.legs[1], plain.journeys[0]!.legs[1]);
});

test('the days a search will read are loaded ahead of it, the next one by evening', async () => {
  deepStrictEqual(await prepareJourneys(() => schedule, DAY + 19 * 3600 + 45 * 60), [20261004, 20261005]);
  // From 8 PM, a search reaches past midnight.
  deepStrictEqual(await prepareJourneys(() => schedule, DAY + 19 * 3600 + 55 * 60), [20261004, 20261005, 20261006]);
  // With no schedule yet, there is nothing to load.
  deepStrictEqual(await prepareJourneys(() => null, NOW), []);
});

test('ends are read as a stop, a place by id or a point, and a bad one is turned away plainly', () => {
  const place = (id: string) => (id === 'n1' ? { id, name: 'Philz Coffee', kind: 'Cafe', street: null, lat: 37.7525, lon: -122.4182 } : null);
  const read = (params: Record<string, string>) => readEnds(schedule, new URLSearchParams(params), place);
  deepStrictEqual(read({ from: 'SF:13477', to: 'place:n1' }), { from: stop('SF:13477'), to: point(37.7525, -122.4182, 'Philz Coffee') });
  deepStrictEqual(read({ from: '@37.7521,-122.4191', to: '@37.7585,-122.3887', tl: '  Dogpatch Saloon ' }), { from: point(37.7521, -122.4191), to: point(37.7585, -122.3887, 'Dogpatch Saloon') });
  strictEqual((read({ from: '@37.7521,-122.4191', to: 'SF:13700', fl: 'x'.repeat(500) }).from as { name: string }).name.length, 100);
  const refused = (params: Record<string, string>, status: number, message: string) =>
    throws(() => read(params), (error) => error instanceof RequestError && error.status === status && error.message === message);
  refused({ from: 'SF:13477' }, 400, 'Send from and to');
  refused({ from: 'SF:13477', to: 'SF:13477' }, 400, 'From and To are the same place');
  refused({ from: 'SF:13477', to: 'SF:99999' }, 404, 'No stop SF:99999');
  refused({ from: 'SF:13477', to: 'place:w2' }, 404, 'That place is not in the list anymore');
  for (const to of ['@91,0', '@37.75,-200', '@37.75', '@37.75,-122.4,1', '@north,west']) refused({ from: 'SF:13477', to }, 400, 'That is not a place on the map');
});
