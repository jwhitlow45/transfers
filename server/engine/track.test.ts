import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { Agency } from '../config.ts';
import { buildScheduleDatabase } from '../gtfs/ingest.ts';
import type { RtVehicle, VehicleSnapshot } from '../realtime/snapshot.ts';
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

const at = (vehicle: Partial<RtVehicle> & { lon: number }, trip = 'SF:t1'): VehicleSnapshot => ({
  fetchedAt: NOW - 5,
  byTrip: new Map([[trip, { lat: LAT, bearing: 90, at: NOW - 20, stopId: null, sequence: null, ...vehicle }]]),
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
});

test('with no stop reported, the nearest stop places the vehicle, and past the rider it has passed', () => {
  const coming = trackVehicle(schedule, at({ lon: lon(3) }), { trip: 'SF:t1', stop: 'SF:104' }, NOW);
  strictEqual(coming.stopsAway, 1);
  const gone = trackVehicle(schedule, at({ lon: lon(5) }), { trip: 'SF:t1', stop: 'SF:103' }, NOW);
  deepStrictEqual([gone.stopsAway, gone.passed, gone.targetIndex, gone.nextIndex], [null, true, 3, 5]);
  deepStrictEqual(names(gone), ['Market St & Stop 0', 'Market St & Stop 1', 'Market St & Stop 2', 'Market St & Stop 3', 'Market St & Stop 4', 'Market St & Stop 5']);
});

test('a vehicle with no position shows the stops before the rider and no vehicle', () => {
  const response = trackVehicle(schedule, { fetchedAt: NOW, byTrip: new Map() }, { trip: 'SF:t1', stop: 'SF:105' }, NOW);
  deepStrictEqual([response.vehicle, response.stopsAway, response.passed, response.targetIndex, response.nextIndex], [null, null, false, 3, null]);
  deepStrictEqual(names(response), ['Market St & Stop 2', 'Market St & Stop 3', 'Market St & Stop 4', 'Market St & Stop 5']);
  strictEqual(trackVehicle(schedule, null, { trip: 'SF:t1', stop: 'SF:105' }, NOW).dataAt, null);
});

test('an unknown trip, or a stop the trip does not make, is not found', () => {
  const notFound = (error: unknown) => error instanceof RequestError && error.status === 404;
  throws(() => trackVehicle(schedule, null, { trip: 'SF:nope', stop: 'SF:104' }, NOW), notFound);
  throws(() => trackVehicle(schedule, null, { trip: 'SF:t1', stop: 'SF:999' }, NOW), notFound);
});

test('on a loop, the visit the vehicle reports by sequence, or else the one due nearest now, places it', () => {
  // Back at stop 1 the second time, past the rider at stop 2.
  const second = trackVehicle(schedule, at({ lon: lon(1), stopId: '101', sequence: 5 }, 'SF:l1'), { trip: 'SF:l1', stop: 'SF:102' }, LOOP_NOW);
  deepStrictEqual([second.stopsAway, second.passed], [null, true]);
  // With no sequence, the visit scheduled at 8:04 is nearer than the one at 8:01.
  const unsequenced = trackVehicle(schedule, at({ lon: lon(1), stopId: '101' }, 'SF:l1'), { trip: 'SF:l1', stop: 'SF:102' }, LOOP_NOW);
  deepStrictEqual([unsequenced.stopsAway, unsequenced.passed], [null, true]);
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
