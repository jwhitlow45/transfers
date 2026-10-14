import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import type { Alert } from '../../../shared/api.ts';
import { countStopAlerts, laterMinutes } from './summary.ts';

const now = 1_000_000 * 1000;
const at = (minutes: number, live = true) => ({ at: 1_000_000 + minutes * 60, live });
const live = (minutes: number) => ({ minutes, scheduled: false });

test('later keeps the next two departures after the soonest, once each', () => {
  deepStrictEqual(laterMinutes([at(16), at(4), at(9), at(4), at(9), at(30)], at(4).at, now), [live(9), live(16)]);
});

test('later is empty when nothing follows', () => {
  deepStrictEqual(laterMinutes([at(4), at(4)], at(4).at, now), []);
});

test('a later minute is scheduled only when every departure in it is', () => {
  deepStrictEqual(laterMinutes([at(4), at(9, false), at(9), at(16, false)], at(4).at, now), [live(9), { minutes: 16, scheduled: true }]);
});

const alert = (id: string, relevance: string, stops: string[]) => ({ id, relevance, stops }) as unknown as Alert;

test('stop alerts count at any stop the rider stands at, unless dismissed', () => {
  const alerts = [alert('a', 'stop', ['BA:board']), alert('b', 'stop', ['BA:transfer']), alert('c', 'route', ['BA:transfer']), alert('d', 'stop', ['BA:transfer']), alert('e', 'stop', ['BA:elsewhere'])];
  strictEqual(countStopAlerts(alerts, new Set(['BA:board', 'BA:transfer']), new Set(['d'])), 2);
});
