import { deepStrictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import type { PatternRow } from '../schedule.ts';
import { type Access, type Network, type Path, raptor } from './raptor.ts';
import { type PatternTrips, patternTrips } from './timetable.ts';

// A network over numbered stops: lines of trips given as their time at each stop, arriving and
// leaving at once, walks between stops as [from, to, seconds], stops the feed says a trip skips,
// and times the feed predicts in place of the schedule's, each trip's stop named as
// "<line>:<trip>@<position>", counting each line's trips as given.
function network(lines: { stops: number[]; trips: number[][] }[], walks: [number, number, number][] = [], skips: string[] = [], live: Record<string, number> = {}): Network {
  const patterns = lines.map(({ stops, trips }, id) => {
    const pattern: PatternRow = { id, route: id, direction: null, headsign: '', shape: null, stops, trips: trips.length };
    return { pattern, trips: patternTrips(pattern, trips.map((times, n) => ({ key: `${id}:${n}`, times: times.flatMap((at) => [at, at]) }))) };
  });
  const tripsOf = new Map(patterns.map(({ pattern, trips }) => [pattern, trips]));
  const time = (trips: PatternTrips, trip: number, position: number) => {
    const name = `${trips.keys[trip]}@${position}`;
    return skips.includes(name) ? null : (live[name] ?? trips.times[(trip * trips.pattern.stops.length + position) * 2]!);
  };
  return {
    stopCount: Math.max(...lines.flatMap(({ stops }) => stops)) + 1,
    patternsAt: (stop) => patterns.flatMap(({ pattern }) => pattern.stops.flatMap((at, position) => (at === stop ? [{ pattern, position }] : []))),
    trips: (pattern) => tripsOf.get(pattern)!,
    arrival: time,
    departure: time,
    live: (trips) => new Set(trips.keys.flatMap((key, trip) => ([...skips, ...Object.keys(live)].some((name) => name.startsWith(`${key}@`)) ? [trip] : []))),
    footpaths: (stop) => walks.filter(([from]) => from === stop).map(([, to, seconds]) => ({ stop: to, seconds })),
    changeSeconds: () => 60,
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

test('a vehicle the rider is on that skips a stop carries them on, rather than a later one boarded there', () => {
  // The 100 from 0 skips 1 today, where the rider could also start, and reaches 2 at 300. The
  // next one gets there too late.
  const lines = [{ stops: [0, 1, 2], trips: [[100, 200, 300], [150, 250, 900]] }];
  const starts = [...at(0), ...at(1, 240)];
  deepStrictEqual(rides(raptor(network(lines, [], ['0:0@1']), starts, at(2), 0, 4, 800)), ['100-300']);
});

test('a walk that makes a vehicle counts over a ride that gets there sooner but has to change', () => {
  // From 0, one vehicle reaches 1 at 200, and another reaches 4 at 150, a minute's walk from 1.
  // Walking there, the rider makes the 250 from 1, which changing off the first vehicle misses.
  const lines = [
    { stops: [0, 1], trips: [[100, 200]] },
    { stops: [0, 4], trips: [[100, 150]] },
    { stops: [1, 3], trips: [[250, 300]] },
  ];
  const [path] = raptor(network(lines, [[4, 1, 60]]), at(0), at(3), 0, 4);
  deepStrictEqual(path?.legs.map((leg) => (leg.kind === 'ride' ? `${leg.departs}-${leg.arrives}` : `walk ${leg.from}>${leg.to}`)), ['100-150', 'walk 4>1', '250-300']);
  deepStrictEqual(path.arrives, 300);
});

test('a ride to the end arrives when it gets there, with no change to make', () => {
  // The vehicle reaching 1 at 200 arrives then, though a walk would have the rider ready to
  // board there sooner than changing off it.
  const lines = [
    { stops: [0, 1], trips: [[100, 200]] },
    { stops: [0, 4], trips: [[100, 150]] },
  ];
  deepStrictEqual(raptor(network(lines, [[4, 1, 60]]), at(0), at(1), 0, 4).map(({ arrives }) => arrives), [200]);
});

test('a vehicle the feed says has fallen behind the next is passed by it, which the rider boards', () => {
  // As scheduled, the 270 from 1 reaches 2 first, but it is running so late that the 300 behind it
  // gets there first, making the only vehicle on from there.
  const lines = [
    { stops: [0, 1], trips: [[100, 200]] },
    { stops: [1, 2], trips: [[270, 350], [300, 400]] },
    { stops: [2, 3], trips: [[500, 600]] },
  ];
  deepStrictEqual(rides(raptor(network(lines, [], [], { '1:0@1': 800 }), at(0), at(3), 0, 4)), ['100-200 300-400 500-600']);
});

test('a stop the vehicle the rider is on skips can still be where another picks them up', () => {
  // The rider can be at 0 by 150 or at 1 by 200. The 200 from 0, the first they can catch there,
  // skips 1 today and reaches 2 at 400, after the only vehicle on has gone. The 100 from 0, gone
  // by the time they reach 0, picks them up at 1 at 250 and makes it.
  const lines = [
    { stops: [0, 1, 2], trips: [[100, 250, 350], [200, 300, 400]] },
    { stops: [2, 3], trips: [[420, 500]] },
  ];
  const starts = [...at(0, 150), ...at(1, 200)];
  deepStrictEqual(rides(raptor(network(lines, [], ['0:1@1']), starts, at(3), 0, 4)), ['250-350 420-500']);
});

test('walking from the start to the end leaves the vehicles that get there later for the planner to weigh', () => {
  // Walking takes until 1200, while the bus leaves at 600 and arrives at 1300: a rider who would
  // rather set off later may take it (see keepBest in plan.ts).
  const lines = [{ stops: [0, 1], trips: [[600, 1300]] }];
  deepStrictEqual(rides(raptor(network(lines, [[0, 1, 1200]]), at(0), at(1), 0, 4)), ['600-1300']);
});

test('a vehicle the feed says has fallen far behind the next is passed by it, however long between them', () => {
  // As scheduled, the 270 from 1 reaches 2 well before the next, due 1000, but it is running so
  // late that the 1000 gets there first, making the only vehicle on from there.
  const lines = [
    { stops: [0, 1], trips: [[100, 200]] },
    { stops: [1, 2], trips: [[270, 350], [1000, 1100]] },
    { stops: [2, 3], trips: [[1200, 1300]] },
  ];
  deepStrictEqual(rides(raptor(network(lines, [], [], { '1:0@1': 1800 }), at(0), at(3), 0, 4)), ['100-200 1000-1100 1200-1300']);
});

test('starting near enough to walk to the end leaves the vehicles that get there later for the planner to weigh', () => {
  // The rider can be at 0 at once or at the end, 1, by 600, while the bus leaves 0 at 450 and
  // reaches 1 at 700.
  const lines = [{ stops: [0, 1], trips: [[450, 700]] }];
  deepStrictEqual(rides(raptor(network(lines), [...at(0), ...at(1, 600)], at(1), 0, 4)), ['450-700']);
});

test('walking from the start to the end leaves a walk to it off a vehicle that gets there later', () => {
  // Walking from 0 reaches the end, 1, at 1200, while the bus from 0 at 600 reaches 2 at 1100,
  // 200 seconds' walk from 1.
  const lines = [{ stops: [0, 2], trips: [[600, 1100]] }];
  const [path] = raptor(network(lines, [[0, 1, 1200], [2, 1, 200]]), at(0), at(1), 0, 4);
  deepStrictEqual(path?.legs.map((leg) => (leg.kind === 'ride' ? `${leg.departs}-${leg.arrives}` : `walk ${leg.from}>${leg.to}`)), ['600-1100', 'walk 2>1']);
  deepStrictEqual(path.arrives, 1300);
});

test('a vehicle the feed times passes one on schedule ahead of it where the schedule closes the gap between them', () => {
  // As scheduled, the 270 from 1 reaches 2 at 2000 and the 1000 at 2100, but the 1000, running
  // five minutes early there, arrives at 1800, making the only vehicle on.
  const lines = [
    { stops: [0, 1], trips: [[100, 200]] },
    { stops: [1, 2], trips: [[270, 2000], [1000, 2100]] },
    { stops: [2, 3], trips: [[1900, 2000]] },
  ];
  deepStrictEqual(rides(raptor(network(lines, [], [], { '1:1@1': 1800 }), at(0), at(3), 0, 4)), ['100-200 1000-1800 1900-2000']);
});
