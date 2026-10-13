import { deepStrictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import type { Connection, Departure, Group } from '../../../shared/api.ts';
import { cardLeft, listedConnections, nothingCatchable, orderGroups, tripSeconds, visibleDepartures } from './results.ts';

const at = (hour: number, minute: number) => (hour * 60 + minute) * 60;
const connection = (trip: string, departs: number): Connection => ({ trip, route: 'BA:Yellow', departs, departDelay: 0, arrives: departs + 480, arriveDelay: 0, live: true, transfer: 4 });
const departure = (trip: string, leaves: number, connections: Connection[], destination?: number): Departure => ({
  trip,
  route: 'SF:48',
  at: leaves,
  delay: null,
  live: true,
  connections,
  ...(destination ? { destination } : {}),
});
// A bus every 10 minutes from 8:02, each made by a train 9 minutes before. Bus m1 left at 7:55 for
// Potrero, which it reaches at 8:05, and its train left at 7:40.
const group = {
  alight: 'BA:901609',
  board: 'SF:13477',
  routes: ['SF:48'],
  direction: null,
  departures: [
    departure('m1', at(7, 55), [connection('b0', at(7, 40))], at(8, 5)),
    departure('m2', at(8, 2), [connection('b1', at(7, 50))]),
    departure('m3', at(8, 12), [connection('b2', at(8, 1))]),
    departure('m4', at(8, 22), [connection('b3', at(8, 11))]),
    departure('m5', at(8, 32), [connection('b4', at(8, 21))]),
    departure('m6', at(8, 42), [connection('b5', at(8, 31))]),
  ],
} as unknown as Group;
const trips = (departures: Departure[]) => departures.map(({ trip, connections }) => `${trip}:${connections.map(({ trip }) => trip).join(',')}`);
const now = at(8, 0) * 1000;

test('rows the rider may be on stay on top of the three they can catch, until their rides end', () => {
  deepStrictEqual(trips(visibleDepartures(group, now, false)), ['m3:b2', 'm4:b3', 'm5:b4']);
  deepStrictEqual(trips(visibleDepartures(group, now, false, true)), ['m1:b0', 'm2:b1', 'm3:b2', 'm4:b3', 'm5:b4']);
  // Bus m1 reaches Potrero at 8:05, and m2 leaves the transfer stop at 8:02.
  deepStrictEqual(trips(visibleDepartures(group, at(8, 6) * 1000, false, true)), ['m3:b2', 'm4:b3', 'm5:b4', 'm6:b5']);
});

test('a card has left once its bus has, or every train that makes it has', () => {
  deepStrictEqual(
    visibleDepartures(group, now, false, true).map((departure) => cardLeft(group, departure, now)),
    [true, true, false, false, false],
  );
});

test('a ride straight to To comes after the transfers there, however soon it leaves', () => {
  const straight = { ...group, kind: 'walk', alight: 'SF:13477', board: 'SF:13477', departures: [departure('w1', at(8, 1), [], at(8, 11))] } as unknown as Group;
  const kinds = (groups: Group[]) => groups.map(({ kind }) => kind ?? 'ride');
  deepStrictEqual(kinds(orderGroups([straight, group], now, false, undefined, false)), ['ride', 'walk']);
  // With a destination, a walk group's times are the destination's, so soonest comes first.
  deepStrictEqual(kinds(orderGroups([group, straight], now, false, 'SF:13500', false)), ['walk', 'ride']);
});

test('going to a stop, the soonest there comes first, and each bus lists the trains that make it by least travel time', () => {
  // The 8:12 bus gets there at 8:22. The 8:02 bus leaves sooner but gets there at 8:30.
  const sooner = { ...group, board: 'SF:1', departures: [departure('m3', at(8, 12), [connection('b2', at(8, 1)), connection('b3', at(8, 3))], at(8, 22))] } as unknown as Group;
  const later = { ...group, board: 'SF:2', departures: [departure('m2', at(8, 2), [connection('b1', at(7, 55))], at(8, 30))] } as unknown as Group;
  const boards = (groups: Group[]) => groups.map(({ board }) => board);
  deepStrictEqual(boards(orderGroups([later, sooner], now, false, undefined, true)), ['SF:1', 'SF:2']);
  // Both trains make the 8:12 bus, and the one leaving at 8:03 takes less time to get there.
  const bus = sooner.departures[0]!;
  deepStrictEqual([listedConnections(bus, true), listedConnections(bus, false)].map((list) => list.map(({ trip }) => trip)), [['b3', 'b2'], ['b2', 'b3']]);
});

test('a trip takes from the last vehicle that still makes it, or with none, from the walk to where it boards, to getting there', () => {
  // Trains at 8:01 and 8:03 make the 8:12 bus, which gets there at 8:22.
  const bus = departure('m3', at(8, 12), [connection('b2', at(8, 1)), connection('b3', at(8, 3))], at(8, 22));
  deepStrictEqual(tripSeconds(bus, false, 0, now), 19 * 60);
  // At 8:02 only the 8:03 train is left to catch, and at 8:04 the rider may be on either.
  deepStrictEqual([tripSeconds(bus, false, 0, at(8, 2) * 1000), tripSeconds(bus, false, 0, at(8, 4) * 1000)], [19 * 60, 19 * 60]);
  // A bus straight there, leaving at 8:05 and there at 8:20, after a 2 minute walk to it.
  deepStrictEqual(tripSeconds(departure('w1', at(8, 5), [], at(8, 20)), true, 120, now), 17 * 60);
  deepStrictEqual(tripSeconds(departure('w2', at(8, 5), []), true, 120, now), null);
});

test('groups with nothing left to catch, and no wider window offered, are no way at all', () => {
  // At 9:00 every bus in the group has left.
  deepStrictEqual(nothingCatchable([group], at(9, 0) * 1000, false), true);
  deepStrictEqual(nothingCatchable([group], now, false), false);
  // A window too narrow is not why there is nothing: widening is the way.
  deepStrictEqual(nothingCatchable([{ ...group, widen: { min: 3, max: 20 } } as Group], at(9, 0) * 1000, false), false);
  deepStrictEqual(nothingCatchable([], now, false), false);
});
