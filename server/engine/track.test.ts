import { metersFrom } from '../../shared/projection.ts';
import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { Agency } from '../config.ts';
import { buildScheduleDatabase } from '../gtfs/ingest.ts';
import type { RtTrip, RtVehicle, TripSnapshot, VehicleSnapshot } from '../realtime/snapshot.ts';
import { Schedule } from '../schedule.ts';
import { serviceDayStart } from '../time.ts';
import { trackVehicle } from './track.ts';
import { RequestError } from './trip.ts';

// One bus line running east along a street, with a stop every 0.002 degrees of longitude
// (about 176 m), and its shape drawn through every stop and the points between them. A second
// line runs the same way to stop 2, turns north to stop 6, then west and back south to stop 1,
// where it ends: a loop that makes stop 1 twice.
const LAT = 37.7652;
const lon = (index: number) => -122.43 + index * 0.002;
const NOW = 1_791_100_000;
// 8:04 on a service day, when the loop trip, leaving at 8:00 and a minute between stops, is
// between its two visits to stop 1.
const LOOP_NOW = serviceDayStart(20261005) + 8 * 3600 + 4 * 60;
const shapeRows = (id: string, points: [number, number][]) => points.map(([lat, lon], index) => `${id},${lat.toFixed(6)},${lon.toFixed(6)},${index + 1}`);
const steps = (from: [number, number], to: [number, number], count: number) =>
  Array.from({ length: count }, (_, step): [number, number] => [from[0] + ((to[0] - from[0]) * step) / count, from[1] + ((to[1] - from[1]) * step) / count]);

let schedule: Schedule;
before(() => {
  const stops = Array.from({ length: 6 }, (_, index) => `${100 + index},${100 + index},Market St & Stop ${index},${LAT},${lon(index).toFixed(6)}`);
  stops.push(`106,106,Market St & Stop 6,${LAT + 0.002},${lon(2).toFixed(6)}`);
  const shape = Array.from({ length: 21 }, (_, index) => `east,${LAT},${(-122.43 + index * 0.0005).toFixed(6)},${index + 1}`);
  const corners: [number, number][] = [[LAT, lon(0)], [LAT, lon(2)], [LAT + 0.002, lon(2)], [LAT + 0.002, lon(1)], [LAT, lon(1)]];
  const loop = shapeRows('loop', [...corners.slice(0, -1).flatMap((corner, index) => steps(corner, corners[index + 1]!, 4)), corners.at(-1)!]);
  const visits = ['100', '101', '102', '106', '101'];
  const times = [
    ...Array.from({ length: 6 }, (_, index) => `t1,08:0${index}:00,08:0${index}:00,${100 + index},${index + 1}`),
    ...visits.map((stop, index) => `l1,08:0${index}:00,08:0${index}:00,${stop},${index + 1}`),
  ];
  const feeds = new Map<Agency, Map<string, string>>([
    [
      'SF',
      new Map(
        Object.entries({
          'routes.txt': 'route_id,route_short_name,route_long_name,route_type\nF,F,MARKET & WHARVES,0\n',
          'stops.txt': `stop_id,stop_code,stop_name,stop_lat,stop_lon\n${stops.join('\n')}\n`,
          'shapes.txt': `shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n${[...shape, ...loop].join('\n')}\n`,
          'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nall,1,1,1,1,1,1,1,20260101,20271231\n',
          'trips.txt': 'route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id\nF,all,t1,Fishermans Wharf,0,,east\nF,all,l1,Loop,0,,loop\n',
          'stop_times.txt': `trip_id,arrival_time,departure_time,stop_id,stop_sequence\n${times.join('\n')}\n`,
        }),
      ),
    ],
  ]);
  const path = join(mkdtempSync(join(tmpdir(), 'track-')), 'schedule.db');
  buildScheduleDatabase(feeds, path);
  schedule = new Schedule(path);
});
after(() => schedule.close());

const at = (vehicle: Partial<RtVehicle> & { lon: number }, trip = 'SF:t1'): { vehicles: VehicleSnapshot } => ({
  vehicles: { fetchedAt: NOW - 5, byTrip: new Map([[trip, { lat: LAT, bearing: 90, at: NOW - 20, stopId: null, sequence: null, ...vehicle }]]) },
});
const names = (response: ReturnType<typeof trackVehicle>) => response.path.map(({ stop }) => response.stops[stop]!.name);

test('a vehicle on its way draws from the stop behind it to one past the rider, counting the stops between', () => {
  // Heading to stop 2, between 1 and 2, with the rider at stop 4.
  const response = trackVehicle(schedule, at({ lon: lon(1.5), stopId: '102' }), { trip: 'SF:t1', stop: 'SF:104' }, NOW);
  deepStrictEqual(names(response), ['Market St & Stop 1', 'Market St & Stop 2', 'Market St & Stop 3', 'Market St & Stop 4', 'Market St & Stop 5']);
  deepStrictEqual([response.stopsAway, response.passed, response.targetIndex, response.nextIndex], [2, false, 3, 1]);
  strictEqual(response.dataAt, NOW - 5);
  strictEqual(response.headsign, 'Fishermans Wharf');
  strictEqual(response.stops[response.target]!.name, 'Market St & Stop 4');
  // The line runs from the first stop drawn to the last, and the vehicle sits on it.
  const [first, last] = [response.path[0]!, response.path.at(-1)!];
  deepStrictEqual([response.line[0], response.line.at(-1)], [[first.x, first.y], [last.x, last.y]]);
  strictEqual(Math.abs(response.vehicle!.y) <= 1 && response.vehicle!.x > first.x && response.vehicle!.x < response.path[1]!.x, true);
  // The page places the rider from the center the picture counts from, as the server places stops.
  const [x, y] = metersFrom(response.center, { lat: LAT, lon: lon(4) });
  deepStrictEqual([Math.round(x), Math.round(y)], [response.path[3]!.x, response.path[3]!.y]);
});

test('with no stop reported, the vehicle heads to the first stop past it on the line, and past the rider it has passed', () => {
  const coming = trackVehicle(schedule, at({ lon: lon(3) }), { trip: 'SF:t1', stop: 'SF:104' }, NOW);
  strictEqual(coming.stopsAway, 1);
  // Just past stop 3, nearest to it, but heading to 4.
  const justPast = trackVehicle(schedule, at({ lon: lon(3.3) }), { trip: 'SF:t1', stop: 'SF:104' }, NOW);
  deepStrictEqual([justPast.stopsAway, justPast.nextIndex], [0, justPast.targetIndex]);
  const gone = trackVehicle(schedule, at({ lon: lon(5) }), { trip: 'SF:t1', stop: 'SF:103' }, NOW);
  deepStrictEqual([gone.stopsAway, gone.passed, gone.targetIndex, gone.nextIndex], [null, true, 3, 5]);
  deepStrictEqual(names(gone), ['Market St & Stop 0', 'Market St & Stop 1', 'Market St & Stop 2', 'Market St & Stop 3', 'Market St & Stop 4', 'Market St & Stop 5']);
});

test('a vehicle with no position shows the stops before the rider and no vehicle', () => {
  const response = trackVehicle(schedule, { vehicles: { fetchedAt: NOW, byTrip: new Map() } }, { trip: 'SF:t1', stop: 'SF:105' }, NOW);
  deepStrictEqual([response.vehicle, response.stopsAway, response.passed, response.targetIndex, response.nextIndex], [null, null, false, 3, null]);
  deepStrictEqual(names(response), ['Market St & Stop 2', 'Market St & Stop 3', 'Market St & Stop 4', 'Market St & Stop 5']);
  strictEqual(trackVehicle(schedule, { vehicles: null }, { trip: 'SF:t1', stop: 'SF:105' }, NOW).dataAt, null);
});

test('an unknown trip, or a stop the trip does not make, is not found', () => {
  const notFound = (error: unknown) => error instanceof RequestError && error.status === 404;
  throws(() => trackVehicle(schedule, { vehicles: null }, { trip: 'SF:nope', stop: 'SF:104' }, NOW), notFound);
  throws(() => trackVehicle(schedule, { vehicles: null }, { trip: 'SF:t1', stop: 'SF:999' }, NOW), notFound);
});

test('on a loop, the visit the vehicle reports by sequence, or else the one due nearest now, places it', () => {
  // Back at stop 1 the second time, past the rider at stop 2.
  const second = trackVehicle(schedule, at({ lon: lon(1), stopId: '101', sequence: 5 }, 'SF:l1'), { trip: 'SF:l1', stop: 'SF:102' }, LOOP_NOW);
  deepStrictEqual([second.stopsAway, second.passed], [null, true]);
  // With no sequence, the visit scheduled at 8:04 is nearer than the one at 8:01.
  const unsequenced = trackVehicle(schedule, at({ lon: lon(1), stopId: '101' }, 'SF:l1'), { trip: 'SF:l1', stop: 'SF:102' }, LOOP_NOW);
  deepStrictEqual([unsequenced.stopsAway, unsequenced.passed], [null, true]);
  // Golden Gate sends no stop: at stop 1's corner, the line's later pass is the one due now.
  const stopless = trackVehicle(schedule, at({ lon: lon(1) }, 'SF:l1'), { trip: 'SF:l1', stop: 'SF:102' }, LOOP_NOW);
  deepStrictEqual([stopless.stopsAway, stopless.passed], [null, true]);
  // A rider at stop 1 is watching the visit still to come.
  const coming = trackVehicle(schedule, at({ lon: lon(2), stopId: '102', sequence: 3 }, 'SF:l1'), { trip: 'SF:l1', stop: 'SF:101' }, LOOP_NOW);
  deepStrictEqual([coming.stopsAway, coming.targetIndex, coming.nextIndex], [2, 3, 1]);
});

test('a loop that ends where it began is drawn the whole way round', () => {
  // From stop 1, behind the vehicle, round the loop and back to stop 1.
  const response = trackVehicle(schedule, at({ lon: lon(2), stopId: '102', sequence: 3 }, 'SF:l1'), { trip: 'SF:l1', stop: 'SF:101' }, LOOP_NOW);
  deepStrictEqual(names(response), ['Market St & Stop 1', 'Market St & Stop 2', 'Market St & Stop 6', 'Market St & Stop 1']);
  const [first, last] = [response.path[0]!, response.path.at(-1)!];
  deepStrictEqual([response.line[0], response.line.at(-1)], [[first.x, first.y], [last.x, last.y]]);
  const north = response.path[2]!;
  strictEqual(response.line.some(([x, y]) => x === north.x && y === north.y), true);
});

// 8:00 on the day the trips run, when t1 leaves stop 0, a minute between stops.
const EIGHT = serviceDayStart(20261005) + 8 * 3600;
const feed = (trip: Partial<RtTrip>, key = 'SF:t1'): TripSnapshot => ({
  fetchedAt: EIGHT + 250,
  feedTime: null,
  trips: new Map([[key, { agency: 'SF', tripId: key.slice(3), routeId: null, canceled: false, added: false, vehicle: null, stops: [], ...trip }]]),
  byStop: new Map(),
  horizon: new Map(),
});
const update = (stopId: string, fields: { time?: number; delay?: number; skipped?: boolean; sequence?: number }) => ({ stopId, time: fields.time ?? null, delay: fields.delay ?? null, skipped: fields.skipped ?? false, ...(fields.sequence ? { sequence: fields.sequence } : {}) });
const xOf = (response: ReturnType<typeof trackVehicle>, stop: string) => response.path.find(({ stop: key }) => response.stops[key]!.name === `Market St & Stop ${stop}`)!.x;

test('a vehicle that reports no position is placed by the schedule, between the stops it is due at', () => {
  // 8:02:30, halfway from stop 2 (8:02) to stop 3 (8:03).
  const response = trackVehicle(schedule, { vehicles: null }, { trip: 'SF:t1', stop: 'SF:104' }, EIGHT + 150);
  deepStrictEqual([response.vehicle?.estimate, response.stopsAway, response.passed], ['scheduled', 1, false]);
  strictEqual(Math.abs(response.vehicle!.x - (xOf(response, '2') + xOf(response, '3')) / 2) <= 1, true);
  strictEqual(response.vehicle!.bearing, 90);
});

test('with predictions, the delay carries forward and the stops before the first one listed are behind it', () => {
  // Two minutes late from stop 3, so due there at 8:05. At 8:04:30 it left stop 2 at 8:04.
  const late = feed({ stops: [{ stopId: '103', time: null, delay: 120, skipped: false }] });
  const response = trackVehicle(schedule, { vehicles: null, trips: late }, { trip: 'SF:t1', stop: 'SF:104' }, EIGHT + 270);
  deepStrictEqual([response.vehicle?.estimate, response.stopsAway, response.dataAt], ['predicted', 1, EIGHT + 250]);
  strictEqual(Math.abs(response.vehicle!.x - (xOf(response, '2') + xOf(response, '3')) / 2) <= 1, true);
});

test('with no place for it, the map says why: not started, ended, or canceled', () => {
  const track = (now: number, trips?: TripSnapshot) => trackVehicle(schedule, { vehicles: null, trips: trips ?? null }, { trip: 'SF:t1', stop: 'SF:104' }, now);
  deepStrictEqual([track(EIGHT - 600).vehicle, track(EIGHT - 600).stopsAway, track(EIGHT - 600).missing], [null, null, 'not-started']);
  strictEqual(track(EIGHT + 600).missing, 'ended');
  strictEqual(track(EIGHT + 150, feed({ canceled: true })).missing, 'canceled');
  strictEqual(track(EIGHT + 150).missing, undefined);
  // A canceled trip is due nowhere, and an ended one keeps its times.
  deepStrictEqual(track(EIGHT + 150, feed({ canceled: true })).path.map(({ at }) => at), [null, null, null, null, null]);
  strictEqual(track(EIGHT + 600).path.every(({ at }) => at !== null && at < EIGHT + 600), true);
});

test('each stop drawn carries when the vehicle is due there', () => {
  const times = (response: ReturnType<typeof trackVehicle>) => Object.fromEntries(response.path.map(({ stop, at }) => [response.stops[stop]!.name.slice(-6), at === null ? null : at - EIGHT]));
  // A bus reporting its position with no trip update runs to the schedule, a minute a stop.
  deepStrictEqual(times(trackVehicle(schedule, at({ lon: lon(1.5), stopId: '102' }), { trip: 'SF:t1', stop: 'SF:104' }, EIGHT + 90)), { 'Stop 1': 60, 'Stop 2': 120, 'Stop 3': 180, 'Stop 4': 240, 'Stop 5': 300 });
  // Two minutes late from stop 3: stops before the first one listed are left by now at the latest,
  // and a skipped stop has no time.
  const late = feed({ stops: [update('103', { delay: 120 }), update('104', { skipped: true })] });
  deepStrictEqual(times(trackVehicle(schedule, { vehicles: null, trips: late }, { trip: 'SF:t1', stop: 'SF:105' }, EIGHT + 270)), { 'Stop 2': 240, 'Stop 3': 300, 'Stop 4': null, 'Stop 5': 420 });
});

test('a prediction with only a time carries the delay it implies to the stops after it', () => {
  // Due at stop 3 at 8:05, two minutes late, with no delay sent. At 8:05:30 it is halfway to
  // stop 4, due 8:06, rather than past the end of a trip running on time.
  const late = feed({ stops: [update('103', { time: EIGHT + 300 })] });
  const response = trackVehicle(schedule, { vehicles: null, trips: late }, { trip: 'SF:t1', stop: 'SF:105' }, EIGHT + 330);
  deepStrictEqual([response.vehicle?.estimate, response.stopsAway], ['predicted', 1]);
  strictEqual(Math.abs(response.vehicle!.x - (xOf(response, '3') + xOf(response, '4')) / 2) <= 1, true);
});

test('on a loop, a prediction for the second visit is matched to it, by sequence or by time', () => {
  // Only the last stop, the loop's second visit to stop 1 (due 8:04), is still ahead.
  for (const last of [update('101', { time: EIGHT + 270 }), update('101', { delay: 30, sequence: 5 })]) {
    const response = trackVehicle(schedule, { vehicles: null, trips: feed({ stops: [last] }, 'SF:l1') }, { trip: 'SF:l1', stop: 'SF:102' }, LOOP_NOW - 20);
    deepStrictEqual([response.passed, response.vehicle?.estimate], [true, 'predicted']);
  }
});

test('a trip in the feed with no stop on its pattern is placed by the schedule, and a skipped stop is passed over', () => {
  const elsewhere = feed({ stops: [update('999', { time: EIGHT + 400 })] });
  strictEqual(trackVehicle(schedule, { vehicles: null, trips: elsewhere }, { trip: 'SF:t1', stop: 'SF:104' }, EIGHT + 150).vehicle?.estimate, 'scheduled');
  // Stop 2 skipped: at 8:01:30, a quarter of the way from stop 1 (8:01) to stop 3 (8:03), which is
  // halfway to stop 2, rather than standing at stop 2.
  const skipping = feed({ stops: [update('102', { skipped: true }), update('103', { delay: 0 })] });
  const response = trackVehicle(schedule, { vehicles: null, trips: skipping }, { trip: 'SF:t1', stop: 'SF:104' }, EIGHT + 90);
  strictEqual(Math.abs(response.vehicle!.x - (xOf(response, '1') + xOf(response, '2')) / 2) <= 1, true);
  strictEqual(response.nextIndex, response.path.findIndex(({ stop }) => response.stops[stop]!.name === 'Market St & Stop 3'));
});

test("the rider's other stops on the trip are marked and drawn, and one it does not make is left out", () => {
  // Heading to stop 2, where the rider gets on, and on to stop 5, where they transfer.
  const response = trackVehicle(schedule, at({ lon: lon(1.5), stopId: '102' }), { trip: 'SF:t1', stop: 'SF:102', marks: ['SF:102', 'SF:105', 'SF:106'] }, NOW);
  deepStrictEqual(names(response), ['Market St & Stop 1', 'Market St & Stop 2', 'Market St & Stop 3', 'Market St & Stop 4', 'Market St & Stop 5']);
  deepStrictEqual([response.targetIndex, response.marks], [1, [1, 4, null]]);
});

test('on a loop, the transfer stop is marked at its visit after boarding, from either stop', () => {
  // Boarding at stop 2 and transferring at stop 1, which the loop makes before and after stop 2.
  const marks = ['SF:102', 'SF:101'];
  const responses = [
    // Heading to stop 2, and still short of the loop's first visit to stop 1.
    at({ lon: lon(2), stopId: '102', sequence: 3 }, 'SF:l1'),
    at({ lon: lon(0.5), stopId: '101', sequence: 2 }, 'SF:l1'),
  ].flatMap((heading) => [
    trackVehicle(schedule, heading, { trip: 'SF:l1', stop: 'SF:102', marks }, LOOP_NOW),
    trackVehicle(schedule, heading, { trip: 'SF:l1', stop: 'SF:101', marks }, LOOP_NOW),
  ]);
  // The Off time watches the transfer, three stops past the first visit to stop 1.
  deepStrictEqual([responses[3]!.stopsAway, responses[3]!.passed], [3, false]);
  for (const response of responses) {
    const [boarding, transfer] = response.marks.map((index) => (index === null ? null : response.path[index]!));
    deepStrictEqual([response.stops[boarding!.stop]!.name, response.stops[transfer!.stop]!.name], ['Market St & Stop 2', 'Market St & Stop 1']);
    strictEqual(response.marks[1]! > response.marks[0]!, true);
  }
});

test('boarding at a stop a loop makes twice, the journey is the one under way, so the transfer keeps its mark', () => {
  // Boarding at stop 1 (made at 8:01 and 8:04) and transferring at stop 2, heading there now.
  const heading = at({ lon: lon(2), stopId: '102', sequence: 3 }, 'SF:l1');
  const response = trackVehicle(schedule, heading, { trip: 'SF:l1', stop: 'SF:102', marks: ['SF:101', 'SF:102'] }, LOOP_NOW);
  deepStrictEqual(
    response.marks.map((index) => response.stops[response.path[index!]!.stop]!.name),
    ['Market St & Stop 1', 'Market St & Stop 2'],
  );
  deepStrictEqual([response.targetIndex, response.marks[0]! < response.marks[1]!], [response.marks[1], true]);
});

test('a map pinned to its span keeps its stops in place as the vehicle moves on', () => {
  const first = trackVehicle(schedule, at({ lon: lon(1.5), stopId: '102' }), { trip: 'SF:t1', stop: 'SF:104' }, NOW);
  deepStrictEqual(first.span, [1, 5]);
  // Later, past stop 3: unpinned, the picture would start at stop 2 and recenter.
  const later = trackVehicle(schedule, at({ lon: lon(3.5), stopId: '104' }), { trip: 'SF:t1', stop: 'SF:104', span: first.span }, NOW);
  deepStrictEqual([later.path, later.line], [first.path.map((stop) => ({ ...stop })), first.line]);
  deepStrictEqual([later.nextIndex, later.targetIndex], [3, 3]);
  strictEqual(later.vehicle!.x > first.vehicle!.x, true);
});

test('drawn whole, each trip runs from its first stop to its last, whatever span the map was pinned to', () => {
  const stopsOf = (trip: string) => schedule.patterns.get(schedule.trips.get(trip)!.pattern)!.stops.length;
  const request = { trip: 'SF:t1', stop: 'SF:104', span: [1, 5] as [number, number], whole: true, transfer: { trip: 'SF:l1', stop: 'SF:102', whole: true } };
  const response = trackVehicle(schedule, at({ lon: lon(1.5), stopId: '102' }), request, EIGHT + 30);
  deepStrictEqual([response.span, response.path.length], [[0, stopsOf('SF:t1') - 1], stopsOf('SF:t1')]);
  deepStrictEqual(response.transfer?.span, [0, stopsOf('SF:l1') - 1]);
  // The rider's stop keeps its place in the longer picture.
  strictEqual(response.stops[response.path[response.targetIndex!]!.stop]!.name.includes('Stop 4'), true);
});

test('the vehicle the rider transfers to is drawn on the same picture, and one the schedule lacks is left off', () => {
  // Riding t1 to stop 2, then boarding the loop trip there.
  const request = { trip: 'SF:t1', stop: 'SF:101', marks: ['SF:101', 'SF:102'], transfer: { trip: 'SF:l1', stop: 'SF:102' } };
  const response = trackVehicle(schedule, at({ lon: lon(0.5), stopId: '101' }), request, EIGHT + 30);
  const transfer = response.transfer!;
  const placeOf = (leg: typeof transfer, name: string) => leg.path.find(({ stop }) => response.stops[stop]!.name === name)!;
  // Stop 2 lands on the same spot in both legs, and the transfer leg watches it.
  deepStrictEqual([placeOf(transfer, 'Market St & Stop 2').x, placeOf(transfer, 'Market St & Stop 2').y], [placeOf(response, 'Market St & Stop 2').x, placeOf(response, 'Market St & Stop 2').y]);
  strictEqual(response.stops[transfer.path[transfer.targetIndex!]!.stop]!.name, 'Market St & Stop 2');
  strictEqual(response.routes[transfer.route]!.name, 'F');
  const lost = trackVehicle(schedule, at({ lon: lon(0.5), stopId: '101' }), { ...request, transfer: { trip: 'SF:nope', stop: 'SF:102' } }, EIGHT + 30);
  strictEqual(lost.transfer, undefined);
});

test('a pinned map zooms in once, when the vehicle leaves the rider\'s boarding stop, if the rider asks', () => {
  const request = { trip: 'SF:t1', stop: 'SF:104', marks: ['SF:102', 'SF:104'], fitOnBoard: true };
  const first = trackVehicle(schedule, at({ lon: lon(0.5), stopId: '101' }), request, NOW);
  deepStrictEqual(first.span, [0, 5]);
  // Still short of stop 2, where the rider gets on: the picture holds.
  const coming = trackVehicle(schedule, at({ lon: lon(1.5), stopId: '102' }), { ...request, span: first.span }, NOW);
  deepStrictEqual(coming.path, first.path);
  // Past it: the picture starts at stop 2 and recenters, and stays so as the vehicle goes on.
  const aboard = trackVehicle(schedule, at({ lon: lon(2.5), stopId: '103' }), { ...request, span: first.span }, NOW);
  const later = trackVehicle(schedule, at({ lon: lon(3.5), stopId: '104' }), { ...request, span: first.span }, NOW);
  deepStrictEqual([names(aboard)[0], aboard.span], ['Market St & Stop 2', [2, 5]]);
  deepStrictEqual(later.path, aboard.path);
  strictEqual(aboard.path[0]!.x === first.path[2]!.x, false);
  // With the setting off, the picture holds the whole way.
  const held = trackVehicle(schedule, at({ lon: lon(2.5), stopId: '103' }), { ...request, fitOnBoard: false, span: first.span }, NOW);
  deepStrictEqual(held.path, first.path);
});

test('a pinned loop map takes in the visit it watches, and a fresh fit leaves out stops already passed', () => {
  // Opened approaching the loop's first visit to stop 1, pinned to stops 0 to 2.
  const opened = trackVehicle(schedule, at({ lon: lon(0.5), stopId: '101', sequence: 2 }, 'SF:l1'), { trip: 'SF:l1', stop: 'SF:101' }, LOOP_NOW);
  // Past it, the watched visit is the second one, outside the pinned span: the span takes it in.
  const later = trackVehicle(schedule, at({ lon: lon(2), stopId: '102', sequence: 3 }, 'SF:l1'), { trip: 'SF:l1', stop: 'SF:101', span: opened.span }, LOOP_NOW);
  strictEqual(later.targetIndex! < later.path.length, true);
  strictEqual(later.path[later.targetIndex!]!.stop, 'SF:101');
  // Fitting afresh after boarding at stop 2, heading to stop 4: the picture starts behind the
  // vehicle, without stop 2, whose mark has no place in it.
  const fitted = trackVehicle(schedule, at({ lon: lon(3.5), stopId: '104' }), { trip: 'SF:t1', stop: 'SF:105', marks: ['SF:102', 'SF:105'] }, NOW);
  deepStrictEqual([names(fitted)[0], fitted.marks[0], fitted.marks[1]], ['Market St & Stop 3', null, 2]);
});

test('opened from the boarding time, a map fitted after boarding follows the ride on from the vehicle', () => {
  // Boarded at stop 2, transferring at stop 5, heading to stop 4, watching where they got on.
  const request = { trip: 'SF:t1', stop: 'SF:102', marks: ['SF:102', 'SF:105'] };
  const vehicle = at({ lon: lon(3.5), stopId: '104' });
  for (const fitOnBoard of [true, false]) {
    const fitted = trackVehicle(schedule, vehicle, { ...request, fitOnBoard }, NOW);
    deepStrictEqual([fitted.span, fitted.targetIndex, fitted.marks, fitted.passed], [[3, 5], null, [null, 2], true]);
    // Pinned to that, it holds rather than reaching back for the stop watched, also once the
    // position is lost or the vehicle has passed the transfer.
    const pinned = trackVehicle(schedule, vehicle, { ...request, fitOnBoard, span: fitted.span }, NOW);
    const lost = trackVehicle(schedule, { vehicles: null }, { ...request, fitOnBoard, span: fitted.span }, NOW);
    const beyond = trackVehicle(schedule, at({ lon: lon(5.5), stopId: '105' }), { ...request, fitOnBoard, span: [3, 4] }, NOW);
    deepStrictEqual([pinned.span, lost.span, lost.targetIndex, beyond.span, beyond.targetIndex], [[3, 5], [3, 5], null, [3, 5], null]);
  }
});
