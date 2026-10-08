import { deepStrictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { laterMinutes } from './summary.ts';

const now = 1_000_000 * 1000;
const at = (minutes: number) => 1_000_000 + minutes * 60;

test('later keeps the next two departures after the soonest, once each', () => {
  deepStrictEqual(laterMinutes([at(16), at(4), at(9), at(4), at(9), at(30)], at(4), now), [9, 16]);
});

test('later is empty when nothing follows', () => {
  deepStrictEqual(laterMinutes([at(4), at(4)], at(4), now), []);
});
