import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import type { Alert, TripResponse } from '../../../shared/api.ts';
import { clock } from '../format.ts';
import { countStopAlerts, laterMinutes, laterSpoken, laterText, summarize } from './summary.ts';

const now = 1_000_000 * 1000;
const at = (minutes: number, live = true) => ({ at: 1_000_000 + minutes * 60, live });
const live = (minutes: number) => ({ minutes, scheduled: false, notStarted: false });

test('later keeps the next two departures after the soonest, once each', () => {
  deepStrictEqual(laterMinutes([at(16), at(4), at(9), at(4), at(9), at(30)], at(4).at, now), [live(9), live(16)]);
});

test('later is empty when nothing follows', () => {
  deepStrictEqual(laterMinutes([at(4), at(4)], at(4).at, now), []);
});

test('a later minute is scheduled only when every departure in it is', () => {
  deepStrictEqual(laterMinutes([at(4), at(9, false), at(9), at(16, false)], at(4).at, now), [live(9), { minutes: 16, scheduled: true, notStarted: false }]);
});

test('a later minute is yet to start only when every vehicle in it is', () => {
  const waiting = (minutes: number) => ({ ...at(minutes), notStarted: true });
  deepStrictEqual(laterMinutes([at(4), waiting(9), at(9), waiting(16)], at(4).at, now), [live(9), { minutes: 16, scheduled: false, notStarted: true }]);
});

const alert = (id: string, relevance: string, stops: string[]) => ({ id, relevance, stops }) as unknown as Alert;

test('stop alerts count at any stop the rider stands at, unless dismissed', () => {
  const alerts = [alert('a', 'stop', ['BA:board']), alert('b', 'stop', ['BA:transfer']), alert('c', 'route', ['BA:transfer']), alert('d', 'stop', ['BA:transfer']), alert('e', 'stop', ['BA:elsewhere'])];
  strictEqual(countStopAlerts(alerts, new Set(['BA:board', 'BA:transfer']), new Set(['d'])), 2);
});

test('later vehicles read "then 8, ~23 min", with a scheduled one and one yet to start marked', () => {
  const later = [live(8), { minutes: 23, scheduled: true, notStarted: false }, { minutes: 0, scheduled: false, notStarted: true }];
  strictEqual(laterText(later), 'then 8, ~23, 1+\u00a0min');
  strictEqual(laterSpoken(later), ' Then in 8 and a scheduled 23 and at least 1 minutes.');
  strictEqual(laterSpoken([]), '');
});

test('the next connection opens one map from either time: the first vehicle, with the second on it', () => {
  const route = (key: string) => ({ key, agency: key.slice(0, 2), name: key.slice(3), longName: '', mode: 'bus', color: '00858a' });
  const stop = (key: string) => ({ key, agency: key.slice(0, 2), code: null, name: key, direction: null, mode: 'bus' });
  const seconds = (minutes: number) => now / 1000 + minutes * 60;
  const data = {
    view: 'transfers',
    from: 'BA:from',
    to: { stop: 'SM:board' },
    routes: { 'BA:1': route('BA:1'), 'SM:2': route('SM:2') },
    stops: { 'BA:from': stop('BA:from'), 'BA:off': stop('BA:off'), 'SM:board': stop('SM:board') },
    alerts: [],
    groups: [
      {
        alight: 'BA:off', board: 'SM:board', routes: ['SM:2'], firstRoutes: ['BA:1'], direction: 0, headsign: 'Colma', walkMeters: 100, window: { min: 3, max: 20 },
        departures: [{ trip: 'SM:b', route: 'SM:2', at: seconds(20), delay: 0, live: true, destination: seconds(30), connections: [{ trip: 'BA:a', route: 'BA:1', departs: seconds(2), departDelay: 0, arrives: seconds(15), arriveDelay: 0, live: true, transfer: 5 }] }],
      },
    ],
  } as unknown as TripResponse;
  const search = { from: 'BA:from', to: 'SM:board', fromLabel: 'From', toLabel: 'Board', dest: 'SM:dest' };
  const next = summarize(search, data, now).next!;
  const track = next.track;
  // As the results' map has them: both routes in the title, and the walk where the rider gets off.
  strictEqual(track.title, 'BART, then the 2');
  strictEqual(next.pinLabel, `the BART at ${clock(seconds(2))} to the 2 at ${clock(seconds(20))}`);
  strictEqual(track.trip, 'BA:a');
  strictEqual(track.stop?.key, 'BA:from');
  deepStrictEqual(track.marks, [{ stop: 'BA:from', kind: 'yours' }, { stop: 'BA:off', kind: 'transfer' }]);
  deepStrictEqual({ ...track.transfer, color: undefined }, { trip: 'SM:b', stop: 'SM:board', color: undefined, minutes: 5, scheduled: false, min: 3, destination: 'SM:dest', walkMeters: 100 });

  // A first vehicle the schedule lacks has no line to draw, so the map follows the second alone.
  const added = structuredClone(data);
  added.groups[0]!.departures[0]!.connections[0]!.added = true;
  const alone = summarize(search, added, now).next!.track;
  deepStrictEqual([alone.trip, alone.stop?.key, alone.title, alone.marks, alone.transfer], ['SM:b', 'SM:board', `2 at ${clock(seconds(20))}`, [{ stop: 'SM:board', kind: 'transfer' }], undefined]);

  // On the trips tab, the stop in To is where the rider is going, as the results' map has it, with
  // no destination sent along.
  const trips = { ...structuredClone(data), view: 'trips', to: { stop: 'SM:end' } } as TripResponse;
  strictEqual(summarize({ ...search, to: 'SM:end', dest: undefined }, trips, now).next!.track.transfer?.destination, 'SM:end');
});
