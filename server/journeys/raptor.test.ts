import { deepStrictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import type { PatternRow } from '../schedule.ts';
import { type Access, type Network, type Path, raptor } from './raptor.ts';
import { type PatternTrips, patternTrips } from './timetable.ts';

// A network over numbered stops: lines of trips given as their time at each stop, arriving and
// leaving at once, and walks between stops as [from, to, seconds].
function network(lines: { stops: number[]; trips: number[][] }[], walks: [number, number, number][] = []): Network {
  const patterns = lines.map(({ stops, trips }, id) => {
    const pattern: PatternRow = { id, route: id, direction: null, headsign: '', shape: null, stops, trips: trips.length };
    return { pattern, trips: patternTrips(pattern, trips.map((times, n) => ({ key: `${id}:${n}`, times: times.flatMap((at) => [at, at]) }))) };
  });
  const tripsOf = new Map(patterns.map(({ pattern, trips }) => [pattern, trips]));
  const time = (trips: PatternTrips, trip: number, position: number) => trips.times[(trip * trips.pattern.stops.length + position) * 2]!;
  return {
    stopCount: Math.max(...lines.flatMap(({ stops }) => stops)) + 1,
    patternsAt: (stop) => patterns.flatMap(({ pattern }) => pattern.stops.flatMap((at, position) => (at === stop ? [{ pattern, position }] : []))),
    trips: (pattern) => tripsOf.get(pattern)!,
    arrival: time,
    departure: time,
    footpaths: (stop) => walks.filter(([from]) => from === stop).map(([, to, seconds]) => ({ stop: to, seconds })),
    changeSeconds: 60,
  };
}

const at = (stop: number, seconds = 0): Access[] => [{ stop, seconds }];
// Each journey's rides as "departs-arrives".
const rides = (paths: Path[]) => paths.map(({ legs }) => legs.flatMap((leg) => (leg.kind === 'ride' ? [`${leg.departs}-${leg.arrives}`] : [])).join(' '));

test('a vehicle that leaves after another and overtakes it is boarded when only it makes the next', () => {
  // From 0 to 1, then 1 to 2, then 2 to 3. The 270 from 1 leaves first but reaches 2 after the
  // only vehicle on from there has gone, and the 300 overtakes it.
  const lines = [
    { stops: [0, 1], trips: [[100, 200]] },
    { stops: [1, 2], trips: [[270, 800], [300, 400]] },
    { stops: [2, 3], trips: [[500, 600]] },
  ];
  deepStrictEqual(rides(raptor(network(lines), at(0), at(3), 0, 4)), ['100-200 300-400 500-600']);
});
