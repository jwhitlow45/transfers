import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import type { StopResponse } from '../../../shared/api.ts';
import { stopSearch } from '../storage.ts';
import { pinnedArrival, stopPinOf } from './stop-pins.ts';

const row = { stop: 'SF:13477', routes: ['SF:48'], direction: 1, headsign: '22nd St + Iowa St', meters: 0, arrivals: [{ trip: 'SF:t1', route: 'SF:48', at: 1_000, delay: 120, live: true }] };
const data = { generatedAt: 0, dataAt: null, stop: 'SF:13477', rows: [row], routes: {}, stops: {}, alerts: [], feeds: [] } as StopResponse;

test('an arrival pins as the vehicle at its stop, named by when it was due before its delay', () => {
  const search = stopSearch('SF:13477', '24th St & Mission St (13477)');
  const pin = stopPinOf(row.arrivals[0]!, row, search);
  deepStrictEqual(pin, { second: { trip: 'SF:t1', board: 'SF:13477' }, at: 880, ends: 1_000, search, arrival: { route: 'SF:48', headsign: '22nd St + Iowa St' } });
  strictEqual(pinnedArrival(pin, data)?.arrival.at, 1_000);
  // Gone by, or never at this stop, it is not among the times.
  strictEqual(pinnedArrival({ ...pin, second: { trip: 'SF:t2', board: 'SF:13477' } }, data), null);
  strictEqual(pinnedArrival({ ...pin, second: { trip: 'SF:t1', board: 'SF:13476' } }, data), null);
});
