import { strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { clockOrDay, isOwlHour, isOwlRoute } from './format.ts';

// Wednesday 2026-10-07 10:00 PM Pacific.
const now = Date.parse('2026-10-08T05:00:00Z');

test('a time later today shows the clock alone', () => {
  strictEqual(clockOrDay(Date.parse('2026-10-08T06:30:00Z') / 1000, now), '11:30 PM');
});

test('a time on another day shows the weekday, by Pacific date', () => {
  strictEqual(clockOrDay(Date.parse('2026-10-08T13:12:00Z') / 1000, now), 'Thu 6:12 AM');
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
