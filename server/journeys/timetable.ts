import type { PatternRow, Schedule } from '../schedule.ts';
import { serviceDayStart } from '../time.ts';

// Some of one pattern's trips on one service date, in the order they leave its first stop, with
// each trip's arrival and departure at every stop, in unix seconds: trip t's departure at position
// p is times[(t * stops + p) * 2 + 1]. None overtakes another (see patternTrips).
export type PatternTrips = {
  pattern: PatternRow;
  keys: string[];
  times: Float64Array;
};

// A service date's trips, by pattern id, for routing in memory: a day is about half a million stop
// times, which a request could not read from the database one query at a time. Each trip can also
// be found by its key, as the feed names the trips it times.
export type Timetable = { date: number; byPattern: Map<number, PatternTrips[]>; byKey: Map<string, { trips: PatternTrips; trip: number }> };

// The dates a schedule has loaded, kept while it is the current one. Three cover a journey from
// late at night into the next morning.
const loaded = new WeakMap<Schedule, Map<number, Timetable>>();
const KEPT_DATES = 3;

export function timetableFor(schedule: Schedule, date: number): Timetable {
  let dates = loaded.get(schedule);
  if (!dates) loaded.set(schedule, (dates = new Map()));
  const known = dates.get(date);
  if (known) return known;
  const table = load(schedule, date);
  dates.set(date, table);
  for (const old of [...dates.keys()].sort((a, b) => a - b).slice(0, Math.max(0, dates.size - KEPT_DATES))) dates.delete(old);
  return table;
}

function load(schedule: Schedule, date: number): Timetable {
  const dayStart = serviceDayStart(date);
  const trips = new Map<number, { key: string; times: number[] }[]>();
  let current = null as { row: number; key: string; times: number[] } | null;
  const rows = schedule.db
    .prepare(
      `SELECT t.id AS row, t.agency, t.trip_id AS tripId, t.pattern, s.arrival, s.departure
       FROM trips t JOIN stop_times s ON s.trip = t.id
       WHERE t.service IN (SELECT value FROM json_each(?))
       ORDER BY t.id, s.position`,
    )
    .iterate(JSON.stringify(schedule.activeServices(date))) as Iterable<{ row: number; agency: string; tripId: string; pattern: number; arrival: number; departure: number }>;
  for (const { row, agency, tripId, pattern, arrival, departure } of rows) {
    if (current?.row !== row) {
      current = { row, key: `${agency}:${tripId}`, times: [] };
      let list = trips.get(pattern);
      if (!list) trips.set(pattern, (list = []));
      list.push(current);
    }
    current.times.push(dayStart + arrival, dayStart + departure);
  }
  const byPattern = new Map<number, PatternTrips[]>();
  for (const [id, list] of trips) {
    const pattern = schedule.patterns.get(id);
    if (!pattern) continue;
    // A trip with times at fewer stops than its pattern has would read past its own.
    byPattern.set(id, patternTrips(pattern, list.filter(({ times }) => times.length === pattern.stops.length * 2)));
  }
  const byKey = new Map<string, { trips: PatternTrips; trip: number }>();
  for (const lists of byPattern.values()) for (const trips of lists) trips.keys.forEach((key, trip) => byKey.set(key, { trips, trip }));
  return { date, byPattern, byKey };
}

// A pattern's trips, split into lists in which none overtakes another, as an express can a local
// on the same stops: in each, a trip that leaves before another is at every stop no later. Of a
// list's trips running on schedule, the router follows only the first it can catch, which is only
// the soonest anywhere when the trips keep their order.
export function patternTrips(pattern: PatternRow, trips: { key: string; times: number[] }[]): PatternTrips[] {
  const lists: { key: string; times: number[] }[][] = [];
  for (const trip of [...trips].sort((a, b) => a.times[1]! - b.times[1]!)) {
    const list = lists.find((each) => !overtakes(trip.times, each.at(-1)!.times));
    if (list) list.push(trip);
    else lists.push([trip]);
  }
  const width = pattern.stops.length * 2;
  return lists.map((list) => {
    const times = new Float64Array(list.length * width);
    list.forEach((trip, index) => times.set(trip.times, index * width));
    return { pattern, keys: list.map(({ key }) => key), times };
  });
}

// Whether a trip that leaves after another is somewhere before it.
const overtakes = (later: number[], earlier: number[]) => later.some((time, index) => time < earlier[index]!);
