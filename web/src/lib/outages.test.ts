import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import type { AccessOutage, Group } from '../../../shared/api.ts';
import { groupStops, outageLabel, outagesByStation, returnDate } from './outages.ts';

const outage = (station: string, kind: AccessOutage['kind'], location: string, stops = [station]): AccessOutage => ({ station, stops, kind, location, reason: null, returns: null });

test('outages come together by station, each kind once, in the order the trip lists them', () => {
  const byStation = outagesByStation([outage('BA:24th', 'escalator', 'Platform'), outage('BA:mont', 'elevator', 'Street'), outage('BA:24th', 'elevator', 'Concourse'), outage('BA:24th', 'escalator', 'Street')]);
  deepStrictEqual(
    byStation.map(({ station, kinds, outages }) => [station, kinds, outages.length]),
    [
      ['BA:24th', ['elevator', 'escalator'], 3],
      ['BA:mont', ['elevator'], 1],
    ],
  );
  strictEqual(outageLabel(byStation[0]!.kinds, '24th St Mission'), 'Elevator and escalator out at 24th St Mission');
});

test('a transfer point takes the outages at its own stops, and where its rows get off instead', () => {
  const group = { alight: 'BA:24th', board: 'SF:13477', departures: [{ connections: [{ alight: 'BA:16th' }, {}] }] } as unknown as Group;
  const stops = groupStops(group);
  deepStrictEqual([...stops].sort(), ['BA:16th', 'BA:24th', 'SF:13477']);
  deepStrictEqual(
    outagesByStation([outage('BA:mont', 'elevator', 'Street'), outage('BA:16th', 'escalator', 'Platform')], stops).map(({ station }) => station),
    ['BA:16th'],
  );
});

test("BART's return date reads as a day in California, and anything else as none", () => {
  strictEqual(returnDate('10/23/2026'), 'Oct 23');
  strictEqual(returnDate(null), null);
  strictEqual(returnDate('soon'), null);
});
