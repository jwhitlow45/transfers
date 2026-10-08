import { strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import type { Group, Mode, Route, TripResponse } from '../../../shared/api.ts';
import type { Pin } from '../storage.ts';
import { ringsBell } from './eggs.ts';

const route = (key: string, mode: Mode): Route => ({ key, agency: 'SF', name: key, longName: key, mode, color: null });
const group = (second: string, first: string): Group => ({
  alight: 'SF:1',
  board: 'SF:2',
  routes: [second],
  direction: 0,
  headsign: 'Downtown',
  walkMeters: 0,
  firstRoutes: [first],
  window: { min: 3, max: 12 },
  departures: [
    {
      trip: `${second}:t`,
      route: second,
      at: 100,
      delay: null,
      live: false,
      connections: [{ trip: `${first}:t`, route: first, departs: 10, departDelay: null, arrives: 50, arriveDelay: null, live: false, transfer: 5 }],
    },
  ],
});
const data = (second: Mode, first: Mode): TripResponse =>
  ({ groups: [group('SF:A', 'SF:B')], routes: { 'SF:A': route('SF:A', second), 'SF:B': route('SF:B', first) } }) as unknown as TripResponse;
const pin: Pin = { first: { trip: 'SF:B:t', alight: 'SF:1' }, second: { trip: 'SF:A:t', board: 'SF:2' }, at: 100, ends: 100 };

test('a pinned trip rings the bell when either vehicle is a cable car', () => {
  strictEqual(ringsBell(pin, data('cable-car', 'bus')), true);
  strictEqual(ringsBell(pin, data('bus', 'cable-car')), true);
});

test('a pinned trip on other vehicles, or with no results, stays quiet', () => {
  strictEqual(ringsBell(pin, data('bus', 'light-rail')), false);
  strictEqual(ringsBell(pin, null), false);
});

test('a cable car the pin does not ride stays quiet', () => {
  strictEqual(ringsBell({ ...pin, second: { trip: 'other', board: 'SF:2' }, first: undefined }, data('cable-car', 'bus')), false);
});
