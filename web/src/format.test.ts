import { strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { clockOrDay } from './format.ts';

// Wednesday 2026-10-07 10:00 PM Pacific.
const now = Date.parse('2026-10-08T05:00:00Z');

test('a time later today shows the clock alone', () => {
  strictEqual(clockOrDay(Date.parse('2026-10-08T06:30:00Z') / 1000, now), '11:30 PM');
});

test('a time on another day shows the weekday, by Pacific date', () => {
  strictEqual(clockOrDay(Date.parse('2026-10-08T13:12:00Z') / 1000, now), 'Thu 6:12 AM');
});
