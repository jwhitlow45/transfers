import { deepStrictEqual } from 'node:assert/strict';
import { test } from 'node:test';

// This browser's storage, which the app reads as a global.
const stored = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => void stored.set(key, value), removeItem: (key: string) => void stored.delete(key) },
});
const { DEFAULT_SETTINGS, dismissNotice, loadDismissed, loadSettings, saveSettings } = await import('./storage.ts');

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
