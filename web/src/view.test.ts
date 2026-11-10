import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import type { Stop } from '../../shared/api.ts';
import { statusOf, stopPage } from './view.ts';

const stop = (fields: Partial<Stop>): Stop => ({ key: 'SF:15405', agency: 'SF', code: '15405', name: 'Mission St & 16th St', direction: null, mode: 'bus', ...fields });

test('a stop links to its agency page: Muni by its sign number, BART by its station code, others not at all', () => {
  strictEqual(stopPage(stop({})), 'https://www.sfmta.com/15405');
  strictEqual(stopPage(stop({ agency: 'BA', key: 'BA:901209', code: null, bart: 'mont', mode: 'bart' })), 'https://www.bart.gov/stations/mont');
  // A Muni station platform with no sign number, SamTrans, and an unknown stop.
  strictEqual(stopPage(stop({ code: null })), null);
  strictEqual(stopPage(stop({ agency: 'SM', key: 'SM:331', code: '331' })), null);
  strictEqual(stopPage(undefined), null);
});

test('a vehicle yet to leave the first stop of its trip says so in place of on time, and how late it is to leave', () => {
  deepStrictEqual(statusOf(0, true, false, true), { kind: 'waiting', label: 'Not left yet' });
  deepStrictEqual(statusOf(null, true, false, true), { kind: 'waiting', label: 'Not left yet' });
  deepStrictEqual(statusOf(178, true, false, true), { kind: 'late', label: 'Not left, 3 min late' });
  deepStrictEqual(statusOf(-60, true, false, true), { kind: 'waiting', label: 'Not left yet' });
  // Canceled and scheduled say so first.
  deepStrictEqual([statusOf(0, true, true, true).kind, statusOf(null, false, false, true).kind], ['canceled', 'scheduled']);
});
