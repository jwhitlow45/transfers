import { strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { addDays, parseGtfsTime, serviceDate, serviceDayStart, weekday } from './time.ts';

test('service day starts at local midnight on ordinary days', () => {
  // 2026-10-03 00:00 PDT is 07:00 UTC.
  strictEqual(serviceDayStart(20261003), Date.UTC(2026, 9, 3, 7) / 1000);
  // 2026-12-01 00:00 PST is 08:00 UTC.
  strictEqual(serviceDayStart(20261201), Date.UTC(2026, 11, 1, 8) / 1000);
});

test('service day counts from noon minus 12 hours when clocks change', () => {
  // DST ends 2026-11-01. Noon PST is 20:00 UTC, so the day starts at 08:00 UTC, an hour
  // after local midnight, which keeps 12:00:00 in the feed at local noon.
  strictEqual(serviceDayStart(20261101), Date.UTC(2026, 10, 1, 8) / 1000);
  strictEqual(serviceDayStart(20261101) + 12 * 3600, Date.UTC(2026, 10, 1, 20) / 1000);
});

test('reads times past midnight', () => {
  strictEqual(parseGtfsTime('25:10:00'), 25 * 3600 + 600);
  strictEqual(parseGtfsTime('7:15:00'), 7 * 3600 + 900);
  strictEqual(parseGtfsTime(''), null);
});

test('service dates follow Pacific time', () => {
  // 2026-10-04 06:59 UTC is still 23:59 on 2026-10-03 in San Francisco.
  strictEqual(serviceDate(Date.UTC(2026, 9, 4, 6, 59) / 1000), 20261003);
  strictEqual(addDays(20261231, 1), 20270101);
  strictEqual(addDays(20260301, -1), 20260228);
  strictEqual(weekday(20261003), 6);
});
