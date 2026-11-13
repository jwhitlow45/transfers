import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import type { PinnedLeg, PinnedTrip, Route } from '../../../shared/api.ts';
import { clock } from '../format.ts';
import { alertStops, pinFocus, pinMap, pinVerb, restOfTrip, shownPin, tripCountdown, tripMinutes, tripMinutesText, tripStatusText, vehicleWord } from './pin-bar.ts';
import { type PinnedPhase, pinnedPhase } from './pinned.ts';

const PHASES: PinnedPhase[] = ['wait', 'ride', 'change', 'ride-second', 'done'];
const at = (minute: number) => minute * 60;
// BART from Montgomery at minute 10, off at Daly City at 23, then the 120 there at 28 to Colma at 42.
const first: PinnedLeg = { trip: 'BA:b0', route: 'BA:Yellow', on: { stop: 'montgomery', at: at(10), delay: 0 }, off: { stop: 'daly-city', at: at(23), delay: 0 }, live: true };
const second: PinnedLeg = { trip: 'SM:a2', route: 'SM:120', on: { stop: 'daly-city-bart', at: at(28), delay: 120 }, off: { stop: 'colma', at: at(42), delay: null }, live: true };
const trip = { first, second };
const route = (key: string, name: string, mode: Route['mode']): Route => ({ key, agency: key.slice(0, 2) as Route['agency'], name, longName: name, mode, color: null });
const routes = { 'BA:Yellow': route('BA:Yellow', 'Yellow', 'bart'), 'SM:120': route('SM:120', '120', 'bus') };

test('the bar shows the most urgent pin, then the one the rider tapped until that pin ends', () => {
  const pins = [
    { id: 'trip', at: 600, ended: false },
    { id: 'stop', at: 300, ended: false },
  ];
  deepStrictEqual(shownPin(pins, null), { id: 'stop', chosen: null });
  // A tap holds, though the other is sooner.
  const tapped = { id: 'trip', ended: false };
  deepStrictEqual(shownPin(pins, tapped), { id: 'trip', chosen: tapped });
  // Until that pin ends, when the choice is forgotten and urgency decides again.
  const ended = [{ id: 'trip', at: null, ended: true }, pins[1]!];
  deepStrictEqual(shownPin(ended, tapped), { id: 'stop', chosen: null });
  // Or is unpinned.
  deepStrictEqual(shownPin([pins[1]!], tapped), { id: 'stop', chosen: null });
  // A pin tapped once it had ended shows, so its Unpin can be reached, until it is unpinned.
  const tappedEnded = { id: 'trip', ended: true };
  deepStrictEqual(shownPin(ended, tappedEnded), { id: 'trip', chosen: tappedEnded });
  deepStrictEqual(shownPin([pins[1]!], tappedEnded), { id: 'stop', chosen: null });
});

test('an ended pin, or one with no times yet, shows only when nothing else is pinned, and equals keep their order', () => {
  deepStrictEqual(shownPin([{ id: 'done', at: 100, ended: true }, { id: 'waiting', at: null, ended: false }, { id: 'coming', at: 900, ended: false }], null).id, 'coming');
  deepStrictEqual(shownPin([{ id: 'done', at: 100, ended: true }, { id: 'waiting', at: null, ended: false }], null).id, 'waiting');
  deepStrictEqual(shownPin([{ id: 'done', at: 100, ended: true }], null).id, 'done');
  deepStrictEqual(shownPin([{ id: 'a', at: 300, ended: false }, { id: 'b', at: 300, ended: false }], null).id, 'a');
  deepStrictEqual(shownPin([], { id: 'gone', ended: false }), { id: null, chosen: null });
});

test('the words naming the countdown follow the moment', () => {
  deepStrictEqual(PHASES.map((phase) => pinVerb(phase, { vehicle: 'bus' })), ['leaves in', 'get off in', 'bus leaves in', 'arrive in', 'arrived']);
  // A countdown that reads "Now" takes no "in".
  deepStrictEqual(PHASES.map((phase) => pinVerb(phase, { vehicle: 'train', soon: true })), ['leaving', 'get off', 'train leaving', 'arriving', 'arrived']);
  // A ride with no first vehicle has one vehicle, which needs no naming, and with no stop to get off at, it ends as it leaves.
  strictEqual(pinVerb('change', { transfers: false, vehicle: 'bus' }), 'leaves in');
  strictEqual(pinVerb('done', { reaches: false }), 'left');
  deepStrictEqual([routes['SM:120'], routes['BA:Yellow'], route('SF:PH', 'PH', 'cable-car'), undefined].map(vehicleWord), ['bus', 'train', 'cable car', 'vehicle']);
});

test('the countdown runs to boarding, getting off, boarding again and arriving, marked as its row marks it', () => {
  const now = at(8) * 1000;
  deepStrictEqual(tripCountdown('wait', first, second, now), { num: '2', unit: 'min', at: at(10) });
  deepStrictEqual(tripCountdown('ride', first, second, now), { num: '15', unit: 'min', at: at(23) });
  deepStrictEqual(tripCountdown('change', first, second, now), { num: '20', unit: 'min', at: at(28) });
  deepStrictEqual(tripCountdown('ride-second', first, second, now), { num: '34', unit: 'min', at: at(42) });
  deepStrictEqual(tripCountdown('done', first, second, now), { num: '✓', unit: null, at: null });
  strictEqual(tripCountdown('wait', first, second, at(10) * 1000 - 20_000).num, 'Now');
  // A vehicle yet to leave the first stop of its trip comes then at the soonest, and a stop timed by the schedule alone is marked.
  strictEqual(tripCountdown('change', first, { ...second, notStarted: true }, now).num, '20+');
  strictEqual(tripCountdown('ride', { ...first, off: { ...first.off!, scheduled: true } }, second, now).num, '~15');
  strictEqual(tripCountdown('ride-second', first, { ...second, live: false }, now).num, '~34');
});

test('the row is about the vehicle and stop that matter now', () => {
  deepStrictEqual(PHASES.map((phase) => { const { leg, stop, boards } = pinFocus(phase, first, second); return [leg.trip, stop.stop, boards]; }), [
    ['BA:b0', 'montgomery', true],
    ['BA:b0', 'daly-city', false],
    ['SM:a2', 'daly-city-bart', true],
    ['SM:a2', 'colma', false],
    ['SM:a2', 'colma', false],
  ]);
  // With no stop to get off at, the trip ends where the second vehicle is boarded.
  strictEqual(pinFocus('done', first, { ...second, off: null }).stop.stop, 'daly-city-bart');
});

test('the open panel lists the steps left, and keeps the one the rider is on', () => {
  deepStrictEqual(PHASES.map((phase) => restOfTrip(phase, trip)), [['off', 'board', 'arrive'], ['off', 'board', 'arrive'], ['board', 'arrive'], ['arrive'], ['arrive']]);
  // A ride with no first vehicle has no getting off, and one with no destination no arriving.
  deepStrictEqual(restOfTrip('change', { second }), ['board', 'arrive']);
  deepStrictEqual(restOfTrip('wait', { first, second: { ...second, off: null } }), ['off', 'board']);
  deepStrictEqual(restOfTrip('done', { first, second: { ...second, off: null } }), []);
});

test("alerts count at the stops the rider has yet to stand at, each under the step it belongs to", () => {
  deepStrictEqual(alertStops('wait', trip), { boarding: ['montgomery'], changing: ['daly-city', 'daly-city-bart'] });
  deepStrictEqual(alertStops('ride', trip), { boarding: [], changing: ['daly-city', 'daly-city-bart'] });
  deepStrictEqual(alertStops('change', trip), { boarding: [], changing: ['daly-city-bart'] });
  deepStrictEqual(alertStops('ride-second', trip), { boarding: [], changing: [] });
  deepStrictEqual(alertStops('change', { second }), { boarding: [], changing: ['daly-city-bart'] });
});

test('a trip takes the minutes from boarding to arriving, marked when either end is the schedule’s alone', () => {
  deepStrictEqual(tripMinutes(trip), { minutes: 32, scheduled: false });
  strictEqual(tripMinutesText(tripMinutes(trip)!), '32\u00a0min trip');
  strictEqual(tripMinutesText(tripMinutes({ first, second: { ...second, off: { ...second.off!, scheduled: true } } })!), '~32\u00a0min trip');
  strictEqual(tripMinutesText(tripMinutes({ first: { ...first, live: false }, second })!), '~32\u00a0min trip');
  deepStrictEqual(tripMinutes({ second }), { minutes: 14, scheduled: false });
  strictEqual(tripMinutes({ first, second: { ...second, off: null } }), null);
  strictEqual(tripMinutes({ first, second: null } as PinnedTrip), null);
});

test('the spoken status says what happens next, and never "now" of a scheduled time or a vehicle yet to start', () => {
  const name = ({ stop }: { stop: string }) => stop;
  const label = (leg: PinnedLeg) => (leg === first || leg.trip === first.trip ? 'BART' : '120');
  const now = at(8) * 1000;
  deepStrictEqual(PHASES.slice(0, 4).map((phase) => tripStatusText(phase, first, second, name, label, now)), [
    'BART leaves montgomery in 2 minutes',
    'Get off at daly-city in 15 minutes',
    '120 leaves daly-city-bart in 20 minutes',
    'Arrive at colma in 34 minutes',
  ]);
  strictEqual(tripStatusText('wait', first, second, name, label, at(10) * 1000 - 20_000), 'BART leaves montgomery now');
  strictEqual(tripStatusText('wait', { ...first, notStarted: true }, second, name, label, at(10) * 1000 - 20_000), 'BART leaves montgomery in at least 1 minute, as it has not left the start of its route');
  strictEqual(tripStatusText('ride', { ...first, off: { ...first.off!, scheduled: true } }, second, name, label, at(23) * 1000 - 20_000), 'Get off at daly-city in 1 minute, scheduled');
  strictEqual(tripStatusText('done', first, second, name, label, at(43) * 1000), `Reached colma at ${clock(at(42))}`);
  strictEqual(tripStatusText('done', first, { ...second, off: null }, name, label, at(29) * 1000), `120 left daly-city-bart at ${clock(at(28))}`);
});

test('the bar opens the two-vehicle map until the rider is on the second vehicle, then that vehicle’s own', () => {
  const maps = PHASES.map((phase) => pinMap(phase, trip, { routes, transfer: { minutes: 5, scheduled: false, min: 3 } }));
  // Waiting, the first vehicle's map watches where the rider boards. Riding and changing, where they get off.
  deepStrictEqual(maps.slice(0, 3).map(({ trip, stop }) => [trip, stop]), [['BA:b0', 'montgomery'], ['BA:b0', 'daly-city'], ['BA:b0', 'daly-city']]);
  for (const map of maps.slice(0, 3)) {
    deepStrictEqual(map.transfer, { trip: 'SM:a2', stop: 'daly-city-bart', minutes: 5, scheduled: false, min: 3, destination: 'colma' });
    deepStrictEqual(map.marks, [{ stop: 'montgomery', kind: 'yours' }, { stop: 'daly-city', kind: 'transfer' }]);
    strictEqual(map.title, `BART at ${clock(at(10))}`);
  }
  // On the second vehicle, and once done, its own map, watching where the rider gets off it.
  for (const map of maps.slice(3)) {
    deepStrictEqual([map.trip, map.stop, map.transfer], ['SM:a2', 'colma', undefined]);
    deepStrictEqual(map.marks, [{ stop: 'daly-city-bart', kind: 'yours' }, { stop: 'colma', kind: 'destination' }]);
    strictEqual(map.title, `120 at ${clock(at(28))}`);
  }
});

test('a first vehicle the schedule lacks, or none, opens the second vehicle’s own map all along', () => {
  const added = { first: { ...first, added: true }, second };
  deepStrictEqual(PHASES.map((phase) => { const { trip, stop, transfer } = pinMap(phase, added, { routes }); return [trip, stop, transfer]; }), [
    ['SM:a2', 'daly-city-bart', undefined],
    ['SM:a2', 'daly-city-bart', undefined],
    ['SM:a2', 'daly-city-bart', undefined],
    ['SM:a2', 'colma', undefined],
    ['SM:a2', 'colma', undefined],
  ]);
  deepStrictEqual((['change', 'ride-second'] as const).map((phase) => pinMap(phase, { first: null, second }, { routes }).stop), ['daly-city-bart', 'colma']);
  // With no destination, the second vehicle's map keeps watching where it is boarded.
  strictEqual(pinMap('done', { first, second: { ...second, off: null } }, { routes }).stop, 'daly-city-bart');
  // Each vehicle takes its color on the page.
  const colored = pinMap('wait', trip, { routes, colorOf: (key) => `#${key}` });
  deepStrictEqual([colored.color, colored.transfer?.color], ['#BA:Yellow', '#SM:120']);
});

test('the map follows the phase the trip is in by its times', () => {
  const phaseAt = (minute: number) => pinnedPhase(trip, at(minute));
  deepStrictEqual([9, 12, 25, 30, 43].map((minute) => pinMap(phaseAt(minute), trip, { routes }).trip), ['BA:b0', 'BA:b0', 'BA:b0', 'SM:a2', 'SM:a2']);
});
