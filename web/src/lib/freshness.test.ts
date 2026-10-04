import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { ageShort, clockSkewMs, freshness } from './freshness.ts';

const NOW = 1_791_000_000_000;
const secondsAgo = (n: number) => NOW / 1000 - n;

test('data up to two and a half refreshes old is fresh', () => {
  deepStrictEqual(freshness(NOW, NOW - 29_000, secondsAgo(61)), { ageSeconds: 61, stale: false, cause: null });
  strictEqual(freshness(NOW, NOW - 5000, secondsAgo(75)).stale, false);
});

test('old data from a server this device reached lately means 511 is behind', () => {
  deepStrictEqual(freshness(NOW, NOW - 10_000, secondsAgo(150)), { ageSeconds: 150, stale: true, cause: 'source' });
});

test('old data because this device missed a refresh is the connection', () => {
  strictEqual(freshness(NOW, NOW - 70_000, secondsAgo(80)).cause, 'connection');
});

test('no live data is not called stale', () => {
  deepStrictEqual(freshness(NOW, NOW, null), { ageSeconds: null, stale: false, cause: null });
});

test('short ages for the status line', () => {
  strictEqual(ageShort(12), '12s');
  strictEqual(ageShort(185), '3m');
  strictEqual(ageShort(7300), '2h');
});

test('a phone clock two minutes fast is corrected by the server timestamp', () => {
  // The response says the server made it at 1000 s, and it arrived when the phone read 1120 s.
  strictEqual(clockSkewMs(1000, 1_120_000), -120_000);
  strictEqual(clockSkewMs(undefined, 1_120_000), 0);
});
