import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import type { Alert, Stop, TripResponse } from '../../../shared/api.ts';
import { viewAlerts } from './alerts.ts';

const station = (key: string, name: string, bart?: string): Stop => ({ key, agency: key.startsWith('BA') ? 'BA' : 'SF', code: null, name, direction: null, mode: key.startsWith('BA') ? 'bart' : 'light-rail', ...(bart ? { bart } : {}) });
const notice = (id: string, header: string): Alert => ({ id, relevance: 'agency', agency: 'SF', header, description: null, url: null, effect: null, activeUntil: null, routes: [], stops: [], lineWide: false });

const data = (access: TripResponse['access'], alerts: Alert[] = []): TripResponse => ({
  generatedAt: 0,
  dataAt: 0,
  systems: {},
  from: 'BA:901209',
  to: { stop: 'SF:13477' },
  groups: [],
  routes: {},
  stops: { 'BA:901609': station('BA:901609', '24th Street / Mission', '24th') },
  alerts,
  feeds: [],
  ...(access ? { access } : {}),
});

test("BART's elevator and escalator outages are not notices, which the results tag instead", () => {
  const alerts = viewAlerts(
    data(
      [{ station: 'BA:901609', stops: ['BA:901609'], kind: 'elevator', location: 'Station', reason: 'Modernization', returns: '10/23/2026' }],
      [notice('n1', 'Hardly Strictly Bluegrass')],
    ),
    new Set(),
  );
  deepStrictEqual(
    alerts.map(({ kicker }) => kicker),
    ['Notice · Muni'],
  );
});

test('each setting raises only alerts about what it covers, folded and labeled as station access', () => {
  const alerts = [notice('e', 'Van Ness Platform Elevator Out of Service'), notice('s', 'Powell Escalator Out of Service')];
  const elevators = viewAlerts(data(undefined, alerts), new Set(), { elevators: true, escalators: false });
  deepStrictEqual(
    elevators.map(({ id, severity, kicker, startOpen }) => `${id} ${severity} ${kicker} ${startOpen}`),
    ['e severe Station access · Muni false', 's info Notice · Muni false'],
  );
  const escalators = viewAlerts(data(undefined, alerts), new Set(), { elevators: false, escalators: true });
  strictEqual(escalators[0]?.id, 's');
});
