import { deepStrictEqual } from 'node:assert/strict';
import { test } from 'node:test';

// This browser's storage, which the app reads as a global.
const stored = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => void stored.set(key, value), removeItem: (key: string) => void stored.delete(key) },
});
const { DEFAULT_SETTINGS, dismissNotice, loadDismissed, loadPins, loadSettings, onPinsChange, savePin, saveSettings } = await import('./storage.ts');

const notice = (id: string) => ({ id, kicker: 'Notice · Muni', title: id, body: null, meta: 'Muni' });

test('a dismissed notice stays dismissed, newest first, until 60 days on, and Undo puts it back as dismissed when it was', () => {
  const now = Math.floor(Date.now() / 1000);
  dismissNotice(notice('old'), now - 61 * 86_400);
  dismissNotice(notice('week'), now - 7 * 86_400);
  dismissNotice(notice('today'));
  deepStrictEqual(
    loadDismissed().map(({ id }) => id),
    ['today', 'week'],
  );
  // Restored, then put back by Undo, it keeps its day.
  dismissNotice(notice('week'), now - 7 * 86_400);
  deepStrictEqual(
    loadDismissed().map(({ id, at }) => [id, now - at >= 7 * 86_400]),
    [
      ['today', false],
      ['week', true],
    ],
  );
});

test('outages show by default, and settings saved before that show them, until turned off', () => {
  stored.delete('transfers:settings');
  deepStrictEqual([loadSettings().elevatorOutages, loadSettings().escalatorOutages, loadSettings().stepFree], [true, true, false]);
  // Saved when escalator outages were off by default.
  stored.set('transfers:settings', JSON.stringify({ stepFree: true, escalatorOutages: false, walkSpeed: 1.2 }));
  deepStrictEqual([loadSettings().elevatorOutages, loadSettings().escalatorOutages, loadSettings().stepFree, loadSettings().walkSpeed], [true, true, true, 1.2]);
  // Turned off since, which holds.
  saveSettings({ ...loadSettings(), escalatorOutages: false });
  deepStrictEqual([loadSettings().elevatorOutages, loadSettings().escalatorOutages], [true, false]);
  // Stored as something other than settings, the defaults.
  for (const value of ['null', 'false', '0']) {
    stored.set('transfers:settings', value);
    deepStrictEqual([loadSettings().elevatorOutages, loadSettings().escalatorOutages, loadSettings().walkSpeed], [true, true, DEFAULT_SETTINGS.walkSpeed]);
  }
});

test('a pin written again keeps its place among the pins, and every change to them is told', () => {
  const search = (from: string) => ({ from, to: 'b', fromLabel: from, toLabel: 'B' });
  const pin = (from: string, ends: number) => ({ second: { trip: 't', board: 's' }, at: 100, ends, search: search(from) });
  let told = 0;
  const stop = onPinsChange(() => told++);
  savePin(search('first'), pin('first', 1));
  savePin(search('second'), pin('second', 1));
  // The first pin's times move: it stays first, as the pin bar's tabs keep their order.
  savePin(search('first'), pin('first', 2));
  deepStrictEqual(loadPins().map(({ search: { from }, ends }) => [from, ends]), [['first', 2], ['second', 1]]);
  savePin(search('first'), null);
  deepStrictEqual(loadPins().map(({ search: { from } }) => from), ['second']);
  deepStrictEqual(told, 4);
  stop();
  savePin(search('second'), null);
  deepStrictEqual([told, loadPins()], [4, []]);
});
