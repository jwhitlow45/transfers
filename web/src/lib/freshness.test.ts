import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { type LiveReport, ageShort, clockSkewMs, freshness, homeStatus, liveNote } from './freshness.ts';

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

test('a few seconds between server and phone is the trip over the network, not the clock', () => {
  // Made at 1000 s, arrived at 1001.8 s on a phone whose clock is right.
  strictEqual(clockSkewMs(1000, 1_001_800), 0);
  strictEqual(clockSkewMs(1000, 1_006_000), -6000);
});

test('Home says offline when any card is, and the oldest times showing', () => {
  const card = (feed: LiveReport['feed'], age: number | null, settled = true): LiveReport => ({ feed, fetchedAt: NOW - 1000, dataAt: age === null ? null : secondsAgo(age), skew: 0, settled });
  strictEqual(homeStatus([], NOW), null);
  deepStrictEqual(homeStatus([card('live', 12), card('offline', 40)], NOW), { feed: 'offline', secondsSinceUpdate: 40, stale: false });
  deepStrictEqual(homeStatus([card('loading', null), card('loading', null)], NOW), { feed: 'loading', secondsSinceUpdate: null, stale: false });
  deepStrictEqual(homeStatus([card('loading', null), card('live', 20)], NOW), { feed: 'live', secondsSinceUpdate: 20, stale: false });
  strictEqual(homeStatus([card('live', 20), card('refreshing', 30)], NOW)?.feed, 'refreshing');
  // A card whose first answer is still settling does not warn yet.
  strictEqual(homeStatus([card('live', 200, false), card('live', 20)], NOW)?.stale, false);
  strictEqual(homeStatus([card('live', 200), card('live', 20)], NOW)?.stale, true);
});

test('Home counts each card\'s age by the server\'s clock', () => {
  // This phone runs a minute slow, so the server's 30-second-old data is 30 seconds old, not 90.
  const report: LiveReport = { feed: 'live', fetchedAt: NOW - 60_000, dataAt: secondsAgo(30), skew: 60_000, settled: true };
  strictEqual(homeStatus([report], NOW - 60_000)?.secondsSinceUpdate, 30);
});

test("a Home card's note says offline, with how old its times are when it has any, and old times once settled", () => {
  const old = freshness(NOW, NOW, secondsAgo(200));
  strictEqual(liveNote('offline', old, true), 'Offline · times 3 min old');
  strictEqual(liveNote('offline', freshness(NOW, null, null), false), 'Offline');
  strictEqual(liveNote('live', old, true), 'Live times 3 min old');
  // Before the first answer since the page opened, old stored times are not warned about yet.
  strictEqual(liveNote('live', old, false), null);
  strictEqual(liveNote('live', freshness(NOW, NOW, secondsAgo(20)), true), null);
});
