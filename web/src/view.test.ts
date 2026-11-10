import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import type { Stop } from '../../shared/api.ts';
import { statusAt, statusOf, stopPage } from './view.ts';

const stop = (fields: Partial<Stop>): Stop => ({ key: 'SF:15405', agency: 'SF', code: '15405', name: 'Mission St & 16th St', direction: null, mode: 'bus', ...fields });

test('a stop links to its agency page: Muni by its sign number, BART by its station code, others not at all', () => {
  strictEqual(stopPage(stop({})), 'https://www.sfmta.com/15405');
  strictEqual(stopPage(stop({ agency: 'BA', key: 'BA:901209', code: null, bart: 'mont', mode: 'bart' })), 'https://www.bart.gov/stations/mont');
  // A Muni station platform with no sign number, SamTrans, and an unknown stop.
  strictEqual(stopPage(stop({ code: null })), null);
  strictEqual(stopPage(stop({ agency: 'SM', key: 'SM:331', code: '331' })), null);
  strictEqual(stopPage(undefined), null);
});

test('a vehicle yet to leave the first stop of its trip says so in place of on time, and how late or early it is', () => {
  deepStrictEqual(statusOf(0, true, false, true), { kind: 'waiting', label: 'Not left yet' });
  deepStrictEqual(statusOf(null, true, false, true), { kind: 'waiting', label: 'Not left yet' });
  deepStrictEqual(statusOf(178, true, false, true), { kind: 'late', label: 'Not left, 3\u00a0min\u00a0late' });
  deepStrictEqual(statusOf(-60, true, false, true), { kind: 'early', label: 'Not left, 1\u00a0min\u00a0early' });
  deepStrictEqual(statusOf(-29, true, false, true), { kind: 'waiting', label: 'Not left yet' });
  // Canceled and scheduled say so first.
  deepStrictEqual([statusOf(0, true, true, true).kind, statusOf(null, false, false, true).kind], ['canceled', 'scheduled']);
});

test('a status beside a countdown says not left only while the vehicle is held as coming', () => {
  const at = 1_000_000;
  const status = (minutesPast: number, notStarted: boolean) => statusAt(at, (at + minutesPast * 60) * 1000, 120, true, false, notStarted).label;
  // Ahead of its time, and for half an hour past it, a vehicle yet to leave its first stop says so.
  deepStrictEqual([status(-5, true), status(29, true)], ['Not left, 2\u00a0min\u00a0late', 'Not left, 2\u00a0min\u00a0late']);
  // Past the hold its row reads "Left 32 min ago", so the status is its delay alone.
  strictEqual(status(32, true), '2\u00a0min\u00a0late');
  strictEqual(status(32, false), '2\u00a0min\u00a0late');
  strictEqual(statusAt(at, (at + 32 * 60) * 1000, 0, true, false, true).label, 'On time');
  // Canceled and scheduled come first, as in statusOf.
  strictEqual(statusAt(at, at * 1000, null, false, false, true).label, 'Scheduled');
});
