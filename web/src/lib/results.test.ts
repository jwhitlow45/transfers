import { deepStrictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import type { Connection, Departure, Group } from '../../../shared/api.ts';
import { cardLeft, orderGroups, visibleDepartures } from './results.ts';

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

test('going to a stop, the way there soonest comes first, and catching a route, the soonest to leave', () => {
  // The 8:12 bus after a change gets there at 8:22. A bus straight there leaves sooner, at 8:05, but
  // takes until 8:30.
  const change = { ...group, departures: [departure('m3', at(8, 12), [connection('b2', at(8, 1))], at(8, 22))] } as unknown as Group;
  const straight = { ...group, kind: 'walk', alight: 'SF:13486', board: 'SF:13486', departures: [departure('w1', at(8, 5), [], at(8, 30))] } as unknown as Group;
  const kinds = (groups: Group[]) => groups.map(({ kind }) => kind ?? 'ride');
  deepStrictEqual(kinds(orderGroups([straight, change], now, false, true)), ['ride', 'walk']);
  deepStrictEqual(kinds(orderGroups([change, straight], now, false, false)), ['walk', 'ride']);
});
