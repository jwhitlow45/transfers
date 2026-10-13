import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import type { Agency } from '../config.ts';
import type { Schedule } from '../schedule.ts';
import { CALENDAR, buildSchedule, files } from '../test-gtfs.ts';
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

// Builds a network along one street, of route C unless a run names another. `stops` are names
// with their position along the street in meters and whether they sit on its north side. `runs`
// repeat a stop sequence `count` times.
function build(stops: [string, number, boolean][], runs: { id: string; route?: string; direction: number; headsign: string; sequence: string[]; count: number }[]) {
  const rows = ['stop_id,stop_code,stop_name,stop_lat,stop_lon'];
  for (const [name, meters, north] of stops) rows.push(`${name},${name},${name},${(LAT + (north ? 0.0002 : 0)).toFixed(6)},${lon(meters)}`);
  const trips: string[] = [];
  const times: string[] = [];
  for (const { id, route = 'C', direction, headsign, sequence, count } of runs) {
    for (let n = 0; n < count; n++) {
      trips.push(`${route},all,${id}${n},${headsign},${direction},,`);
      sequence.forEach((stop, index) => {
        const at = `08:${String(index * 2).padStart(2, '0')}:00`;
        times.push(`${id}${n},${at},${at},${stop},${index + 1}`);
      });
    }
  }
  const muni = files({
    'routes.txt': `route_id,route_short_name,route_long_name,route_type\n${[...new Set(runs.map(({ route = 'C' }) => route))].map((route) => `${route},${route},${route},3`).join('\n')}\n`,
    'stops.txt': `${rows.join('\n')}\n`,
    'calendar.txt': CALENDAR,
    'trips.txt': `route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id\n${trips.join('\n')}\n`,
    'stop_times.txt': `trip_id,arrival_time,departure_time,stop_id,stop_sequence\n${times.join('\n')}\n`,
  });
  return buildSchedule(new Map<Agency, Map<string, string>>([['SF', muni]]));
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
  // Westbound cars leave Jones away from Polk, so as a stop to transfer at, westbound Jones is
  // out of reach. Eastbound ones stop across the street.
  deepStrictEqual(links('polk-wb', 'jones-wb'), ['walk Market at polk-eb']);
  // From Larkin, Jones is itself a walk.
  deepStrictEqual(links('larkin-wb', 'jones-wb'), []);
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

test('another route on the named stop\'s corner is no ride there, as the rider named the stop for its own', () => {
  // Like the 14 on Mission St at 24th, beside the 48's stop on 24th St.
  const schedule = build(
    [
      ['from', 0, false],
      ['to', 900, false],
      ['corner', 900, true],
      ['past', 1500, true],
      ['start', 1800, false],
      ['end', 600, false],
    ],
    [
      { id: 'f', route: 'F', direction: 0, headsign: 'East', sequence: ['from', 'corner', 'past'], count: 10 },
      { id: 'd', route: 'D', direction: 1, headsign: 'West', sequence: ['start', 'to', 'end'], count: 10 },
    ],
  );
  const links = (to: string) =>
    findLinks(schedule, schedule.stopsByKey.get('SF:from')!, { stop: schedule.stopsByKey.get(`SF:${to}`)! }).map((link) => `${link.kind} ${link.routes.map(({ shortName }) => shortName).join()}`);
  // F reaches the corner, so it is how the rider gets to D, not a ride to D's stop.
  deepStrictEqual(links('to'), ['ride D']);
  deepStrictEqual(links('corner'), ['walk F']);
  schedule.close();
});

test('going to a stop, routes boarded at one place that both get there are one choice', () => {
  // A and B leave From together and both reach To, B by way of a detour. C leaves From too but
  // never reaches To.
  const schedule = build(
    [
      ['from', 0, false],
      ['detour', 600, true],
      ['to', 1200, false],
      ['away', -900, false],
    ],
    [
      { id: 'a', route: 'A', direction: 0, headsign: 'East', sequence: ['from', 'to'], count: 10 },
      { id: 'b', route: 'B', direction: 0, headsign: 'Detour', sequence: ['from', 'detour', 'to'], count: 10 },
      { id: 'c', route: 'C', direction: 0, headsign: 'West', sequence: ['from', 'away'], count: 10 },
    ],
  );
  const links = findLinks(schedule, schedule.stopsByKey.get('SF:from')!, { destination: schedule.stopsByKey.get('SF:to')! });
  deepStrictEqual(links.map((link) => `${link.kind} ${link.routes.map(({ shortName }) => shortName).join('+')} at ${link.board.stopId}`), ['walk A+B at from']);
  schedule.close();
});

test('going to a stop a route already reaches from near From, the ways with a change are left out', () => {
  // A goes straight from From to To. F and then D get there too, changing at the middle of the street.
  const stops: [string, number, boolean][] = [
    ['from', 0, false],
    ['mid', 1200, false],
    ['change', 1200, true],
    ['to', 2400, false],
  ];
  const runs = [
    { id: 'f', route: 'F', direction: 0, headsign: 'Mid', sequence: ['from', 'mid'], count: 10 },
    { id: 'd', route: 'D', direction: 0, headsign: 'East', sequence: ['change', 'to'], count: 10 },
  ];
  const links = (schedule: Schedule) =>
    findLinks(schedule, schedule.stopsByKey.get('SF:from')!, { destination: schedule.stopsByKey.get('SF:to')! }).map((link) => `${link.kind} ${link.routes.map(({ shortName }) => shortName).join('+')}`);
  const changing = build(stops, runs);
  deepStrictEqual(links(changing), ['ride D']);
  changing.close();
  const straight = build(stops, [...runs, { id: 'a', route: 'A', direction: 0, headsign: 'East', sequence: ['from', 'to'], count: 10 }]);
  deepStrictEqual(links(straight), ['walk A']);
  straight.close();
});

test('going to a stop, another route that stops on its corner gets the rider there too', () => {
  // Like the 14 on Mission St at 24th, beside the 48's stop on 24th St.
  const schedule = build(
    [
      ['from', 0, false],
      ['to', 900, false],
      ['corner', 900, true],
      ['past', 1500, true],
      ['start', 1800, false],
      ['end', 600, false],
    ],
    [
      { id: 'f', route: 'F', direction: 0, headsign: 'East', sequence: ['from', 'corner', 'past'], count: 10 },
      { id: 'd', route: 'D', direction: 1, headsign: 'West', sequence: ['start', 'to', 'end'], count: 10 },
    ],
  );
  const links = findLinks(schedule, schedule.stopsByKey.get('SF:from')!, { destination: schedule.stopsByKey.get('SF:to')! });
  deepStrictEqual(links.map((link) => `${link.kind} ${link.routes.map(({ shortName }) => shortName).join()}`), ['walk F']);
  schedule.close();
});

test('going to a stop, each place a first vehicle meets a route is its own way there, as it is not catching the route', () => {
  // T comes from the west through B2, then B1, and on to To. F from From meets it at B1 and G,
  // with fewer trips, at B2.
  const schedule = build(
    [
      ['from', 0, false],
      ['g1', -1200, true],
      ['b2', -1200, false],
      ['f1', 1200, true],
      ['b1', 1200, false],
      ['to', 3000, false],
    ],
    [
      { id: 'f', route: 'F', direction: 0, headsign: 'East', sequence: ['from', 'f1'], count: 10 },
      { id: 'g', route: 'G', direction: 1, headsign: 'West', sequence: ['from', 'g1'], count: 5 },
      { id: 't', route: 'T', direction: 0, headsign: 'East', sequence: ['b2', 'b1', 'to'], count: 10 },
    ],
  );
  const from = schedule.stopsByKey.get('SF:from')!;
  const points = (links: ReturnType<typeof findLinks>) => links.map((link) => `${link.firstLegs.map(({ pattern }) => schedule.route(pattern.route).shortName).join()} to T at ${link.board.stopId}`).sort();
  deepStrictEqual(points(findLinks(schedule, from, { destination: schedule.stopsByKey.get('SF:to')! })), ['F to T at b1', 'G to T at b2']);
  // Catching T, the busier first vehicle's point is the one.
  deepStrictEqual(points(findLinks(schedule, from, { route: schedule.routesByKey.get('SF:T')! })), ['F to T at b1']);
  schedule.close();
});

test('going to a stop, the first vehicle may pick the rider up across the street, and the row says where', () => {
  // From's own stop serves only W, heading away. E leaves from across the street and meets D,
  // which goes on to To.
  const schedule = build(
    [
      ['from', 0, true],
      ['west', -1500, true],
      ['across', 0, false],
      ['mid', 1200, false],
      ['far1', 5000, true],
      ['far2', 4000, true],
      ['change', 1200, true],
      ['to', 2400, true],
    ],
    [
      { id: 'w', route: 'W', direction: 1, headsign: 'West', sequence: ['from', 'west'], count: 1 },
      { id: 'e', route: 'E', direction: 0, headsign: 'East', sequence: ['across', 'mid'], count: 1 },
      { id: 'd', route: 'D', direction: 0, headsign: 'To', sequence: ['far1', 'far2', 'change', 'to'], count: 1 },
    ],
  );
  const from = schedule.stopsByKey.get('SF:from')!;
  const to = schedule.stopsByKey.get('SF:to')!;
  const links = findLinks(schedule, from, { destination: to });
  deepStrictEqual(links.map((link) => `${link.kind} ${link.routes.map(({ shortName }) => shortName).join()} from ${link.firstLegs.map(({ pattern, origin }) => schedule.stop(pattern.stops[origin]!).stopId).join()}`), ['ride D from across']);
  // Catching D, From's own stop is where the first vehicle leaves, so there is none.
  deepStrictEqual(findLinks(schedule, from, { route: schedule.routesByKey.get('SF:D')! }), []);
  const day = serviceDayStart(20261005);
  const view = { trips: null, alerts: [], status: () => 'schedule' as const, updatedAt: null };
  const response = planTrip(schedule, view, { from: 'SF:from', to: 'SF:to', view: 'trips' }, day + 7.9 * 3600);
  deepStrictEqual(response.groups.flatMap(({ departures }) => departures.flatMap(({ connections }) => connections.map(({ trip, board }) => `${trip} ${board}`))), ['SF:e0 SF:across']);
  ok(response.stops['SF:across']);
  schedule.close();
});

test('going to a stop, a route straight there from across the street counts the walk across', () => {
  const schedule = build(
    [
      ['from', 0, true],
      ['across', 0, false],
      ['to', 1500, false],
    ],
    [{ id: 's', route: 'S', direction: 0, headsign: 'East', sequence: ['across', 'to'], count: 1 }],
  );
  const [link] = findLinks(schedule, schedule.stopsByKey.get('SF:from')!, { destination: schedule.stopsByKey.get('SF:to')! });
  deepStrictEqual([link?.kind, link?.board.stopId], ['walk', 'across']);
  ok(link!.walkMeters > 15 && link!.defaultMinutes >= 1);
  schedule.close();
});
