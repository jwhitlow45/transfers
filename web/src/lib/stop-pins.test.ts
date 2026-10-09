import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import type { StopResponse } from '../../../shared/api.ts';
import { stopSearch } from '../storage.ts';
import { arrivalCountdown, pinnedArrival, stopPinOf } from './stop-pins.ts';

const row = { stop: 'SF:13477', routes: ['SF:48'], direction: 1, headsign: '22nd St + Iowa St', meters: 0, arrivals: [{ trip: 'SF:t1', route: 'SF:48', at: 1_000, delay: 120, live: true }] };
const data = { generatedAt: 0, dataAt: null, stop: 'SF:13477', rows: [row], routes: {}, stops: {}, alerts: [], feeds: [] } as StopResponse;

test('an arrival pins as the vehicle at its stop, named by when it was due before its delay', () => {
  const search = stopSearch('SF:13477', '24th St & Mission St (13477)');
  const pin = stopPinOf(row.arrivals[0]!, row, search);
  deepStrictEqual(pin, { second: { trip: 'SF:t1', board: 'SF:13477' }, at: 880, ends: 1_000, search, arrival: { route: 'SF:48', headsign: '22nd St + Iowa St' } });
  strictEqual(pinnedArrival(pin, data).arrival?.at, 1_000);
  // Gone by, or never at this stop, it is not among the times.
  strictEqual(pinnedArrival({ ...pin, second: { trip: 'SF:t2', board: 'SF:13477' } }, data).arrival, null);
  strictEqual(pinnedArrival({ ...pin, second: { trip: 'SF:t1', board: 'SF:13476' } }, data).arrival, null);
});

test("a pin from yesterday is not the same trip's run today, as trip ids repeat every day", () => {
  const pin = stopPinOf(row.arrivals[0]!, row, stopSearch('SF:13477', 'A'));
  const tomorrow = { ...data, rows: [{ ...row, arrivals: [{ ...row.arrivals[0]!, at: 1_000 + 86_400 }] }] };
  strictEqual(pinnedArrival(pin, tomorrow).arrival, null);
});

test("the server's answer for the pin places its vehicle, canceled or past the list, and an answer for another pin is not taken for it", () => {
  const pin = stopPinOf(row.arrivals[0]!, row, stopSearch('SF:13477', 'A'));
  const asked = { second: pin.second, at: pin.at };
  const leg = { trip: 'SF:t1', route: 'SF:48', on: { stop: 'SF:13477', at: 1_300, delay: 420 }, off: null, live: true };
  const answered = (second: typeof leg | null, named = asked) => ({ ...data, rows: [{ ...row, arrivals: [] }], pinned: { second }, pin: named }) as StopResponse;
  deepStrictEqual(pinnedArrival(pin, answered(leg)), { arrival: { trip: 'SF:t1', route: 'SF:48', at: 1_300, delay: 420, live: true }, canceled: false, lost: false });
  strictEqual(pinnedArrival(pin, answered({ ...leg, canceled: true } as typeof leg)).canceled, true);
  deepStrictEqual(pinnedArrival(pin, answered(null)), { arrival: null, canceled: false, lost: true });
  // An answer stored for the pin before this one falls back to the stop's times.
  deepStrictEqual(pinnedArrival(pin, { ...answered(null, { ...asked, at: 1 }), rows: [row] }).arrival, row.arrivals[0]);
});

test('a pinned arrival counts down, then says it came, or once it was due, that it is canceled', () => {
  const at = 1_000_000;
  deepStrictEqual(arrivalCountdown(at, (at - 300) * 1000, { canceled: true, known: true }), { lead: 'Arrives in', num: '5', unit: 'min' });
  deepStrictEqual(arrivalCountdown(at, (at + 60) * 1000, { canceled: false, known: true }), { lead: 'Arrived', num: '✓', unit: null });
  deepStrictEqual(arrivalCountdown(at, (at + 60) * 1000, { canceled: true, known: true }), { lead: 'Canceled', num: '✕', unit: null });
  // Before the stop's times come, it says nothing has come yet.
  deepStrictEqual(arrivalCountdown(at, (at + 60) * 1000, { canceled: false, known: false }), { lead: 'Arriving', num: 'Now', unit: null });
});
