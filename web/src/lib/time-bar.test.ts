import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { barScale, barText, tickMinutes } from './time-bar.ts';

// 6:10 PM Pacific on 2026-11-09, and the minutes after it.
const at = (minute: number) => Date.UTC(2026, 10, 10, 2, 10) / 1000 + minute * 60;
const times = { rideStart: at(0), rideEnd: at(13), gapEnd: at(18), busEnd: at(32) };
const live = { second: '120', minutes: 5, firstScheduled: false, secondScheduled: false, tight: false };

test('ticks step by 15 minutes until they would crowd', () => {
  deepStrictEqual(tickMinutes(40), [0, 15, 30]);
  deepStrictEqual(tickMinutes(120), [0, 30, 60, 90]);
});

test('the bar runs from now to a little past the end of the trip', () => {
  const { ride, gap, bus, ticks } = barScale(times, (at(0) - 120) * 1000);
  // 34 minutes from now to the end, and a tenth more.
  const pct = (minutes: number) => (minutes / 37.4) * 100;
  strictEqual(ride.left.toFixed(3), pct(2).toFixed(3));
  strictEqual((ride.left + ride.width).toFixed(3), gap.left.toFixed(3));
  strictEqual((gap.left + gap.width).toFixed(3), bus.left.toFixed(3));
  strictEqual((bus.left + bus.width).toFixed(3), pct(34).toFixed(3));
  deepStrictEqual(ticks.map(({ minute }) => minute), [0, 15, 30]);
  strictEqual(ticks[0]!.left, 0);
});

test('once the ride has begun, the bar starts where it did and the ticks still count from now', () => {
  const { ride, ticks } = barScale(times, at(5) * 1000);
  strictEqual(ride.left, 0);
  strictEqual(ticks[0]!.left.toFixed(3), ((5 / 35.2) * 100).toFixed(3));
});

test('without a destination the second ride is a stub', () => {
  const { bus } = barScale({ ...times, busEnd: null }, at(0) * 1000);
  strictEqual((bus.left + bus.width).toFixed(3), ((26 / 28.6) * 100).toFixed(3));
});

test('the words under the bar and the sentence spoken for it', () => {
  deepStrictEqual(barText(times, live), {
    legend: ['Ride 6:10–6:23', '5 min transfer', '120 6:28–6:42'],
    spoken: 'Ride 6:10 to 6:23 PM, then a 5 minute transfer, then the 120 from 6:28 to 6:42 PM',
  });
  deepStrictEqual(barText({ ...times, busEnd: null }, { ...live, secondScheduled: true, tight: true }), {
    legend: ['Ride 6:10–6:23', '~5 min transfer, tight', '120 ~6:28'],
    spoken: 'Ride 6:10 to 6:23 PM, then a scheduled 5 minute transfer, tight, then the 120 at 6:28 PM, scheduled',
  });
});
