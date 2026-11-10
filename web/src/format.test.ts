import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { approx, approxMinutes, atLeast, clockOrDay, countdownTo, hasLeft, isOwlHour, isOwlRoute, minuteCount, stillWaiting, untilText, walkMinutes } from './format.ts';

// Wednesday 2026-10-07 10:00 PM Pacific.
const now = Date.parse('2026-10-08T05:00:00Z');

test('a time later today shows the clock alone', () => {
  strictEqual(clockOrDay(Date.parse('2026-10-08T06:30:00Z') / 1000, now), '11:30\u00a0PM');
});

test('a time on another day shows the weekday, by Pacific date', () => {
  strictEqual(clockOrDay(Date.parse('2026-10-08T13:12:00Z') / 1000, now), 'Thu 6:12\u00a0AM');
});

test('owl hours run from midnight to 5 AM', () => {
  strictEqual(isOwlHour(new Date(2026, 9, 8, 0, 0)), true);
  strictEqual(isOwlHour(new Date(2026, 9, 8, 4, 59)), true);
  strictEqual(isOwlHour(new Date(2026, 9, 8, 5, 0)), false);
  strictEqual(isOwlHour(new Date(2026, 9, 8, 23, 59)), false);
});

test('an owl route has owl in its short or long name', () => {
  strictEqual(isOwlRoute({ name: 'NOWL', longName: '' }), true);
  strictEqual(isOwlRoute({ name: '91', longName: '3rd St/19th Ave Owl' }), true);
  strictEqual(isOwlRoute({ name: '48', longName: 'Quintara' }), false);
});

test('a countdown says its word over Now within a minute, and its minutes after', () => {
  const at = now / 1000 + 5 * 60;
  deepStrictEqual(countdownTo(at, now, 'Arrives in', 'Arriving'), { lead: 'Arrives in', num: '5', unit: 'min' });
  deepStrictEqual(countdownTo(at, now + 4.5 * 60_000, 'Arrives in', 'Arriving'), { lead: 'Arriving', num: 'Now', unit: null });
  strictEqual(untilText(0), 'Now');
  strictEqual(untilText(7), '7\u00a0min');
});

test('a value from the schedule alone reads "~", and its minutes never say less than one', () => {
  deepStrictEqual([approx('6:40\u00a0PM', true), approx('6:40\u00a0PM', false)], ['~6:40\u00a0PM', '6:40\u00a0PM']);
  deepStrictEqual([approxMinutes(0, true), approxMinutes(12, true), approxMinutes(0, false)], ['~1', '~12', '0']);
  deepStrictEqual(countdownTo(now / 1000 + 20, now, 'Off in', 'Getting off', 'scheduled'), { lead: 'Off in', num: '~1', unit: 'min' });
  deepStrictEqual(countdownTo(now / 1000 + 20, now, 'Off in', 'Getting off'), { lead: 'Getting off', num: 'Now', unit: null });
});

test('minutes to a vehicle yet to leave the first stop of its trip read "19+", and never "Now"', () => {
  deepStrictEqual([atLeast(19), atLeast(0), untilText(19, true), untilText(0, true)], ['19+', '1+', '19+\u00a0min', '1+\u00a0min']);
  deepStrictEqual(countdownTo(now / 1000 + 20, now, 'Board in', 'Boarding', 'notStarted'), { lead: 'Board in', num: '1+', unit: 'min' });
});

test("a walk takes the rider's own speed, and at least a minute", () => {
  strictEqual(walkMinutes(300, 1.4), 5);
  strictEqual(walkMinutes(300, 0.7), 9);
  strictEqual(walkMinutes(10, 1.4), 1);
});

test('a vehicle has left once its time passes, unless it has yet to leave the first stop of its trip', () => {
  deepStrictEqual([hasLeft(100, 99_000), hasLeft(100, 101_000), hasLeft(100, 101_000, true)], [false, true, false]);
  // Times from over half an hour ago, as kept offline, no longer hold it.
  deepStrictEqual([stillWaiting(100, (100 + 1799) * 1000, true), stillWaiting(100, (100 + 1800) * 1000, true), hasLeft(100, (100 + 1800) * 1000, true)], [true, false, true]);
});

test('spoken minutes say minute for one', () => {
  deepStrictEqual([minuteCount(1), minuteCount(2)], ['1 minute', '2 minutes']);
});
