import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { freshness, nextPollMs } from './freshness.ts';

const NOW = 1_791_000_000_000;
const seconds = (n: number) => NOW / 1000 - n;

test('data a minute old or less is fresh', () => {
  deepStrictEqual(freshness(NOW, NOW - 5000, seconds(40), false), { ageSeconds: 40, stale: false, cause: null });
  strictEqual(freshness(NOW, NOW, seconds(60), false).stale, false);
});

test('old data from a server that answered lately means 511 is behind', () => {
  deepStrictEqual(freshness(NOW, NOW - 10_000, seconds(150), false), { ageSeconds: 150, stale: true, cause: 'source' });
});

test('old data because this device stopped reaching the server', () => {
  strictEqual(freshness(NOW, NOW - 120_000, seconds(130), false).cause, 'connection');
  strictEqual(freshness(NOW, NOW - 5000, seconds(90), true).cause, 'connection');
});

test('no live data is not called stale', () => {
  deepStrictEqual(freshness(NOW, NOW, null, false), { ageSeconds: null, stale: false, cause: null });
});

test('the next poll lands just after the server refreshes', () => {
  // The server got data 10 s ago, refreshes at 30, so poll in 22.
  strictEqual(nextPollMs(seconds(10), NOW), 22_000);
  // Never sooner than 5 s, never later than 30 s.
  strictEqual(nextPollMs(seconds(31), NOW), 5000);
  strictEqual(nextPollMs(null, NOW), 30_000);
});
