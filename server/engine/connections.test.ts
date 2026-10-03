import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { type FirstLeg, type PairingOptions, type SecondLeg, pairConnections } from './connections.ts';

const NOW = 1_800_000_000;
const minutes = (n: number) => NOW + n * 60;

function train(trip: string, departs: number, arrives: number, extra: Partial<FirstLeg> = {}): FirstLeg {
  return { trip, route: 'BA:Yellow-S', departs, departDelay: null, arrives, arriveDelay: null, live: true, canceled: false, ...extra };
}

function bus(trip: string, at: number, extra: Partial<SecondLeg> = {}): SecondLeg {
  return { trip, route: 'SF:48', at, delay: 0, live: true, canceled: false, ...extra };
}

const options: PairingOptions = { now: NOW, min: 3, max: 12, hide: 3, count: 3, showHidden: false };

const summary = (departures: ReturnType<typeof pairConnections>) =>
  departures.map(({ trip, connections }) => [trip, connections.map((c) => `${c.trip}:${c.transfer}${c.hidden ? `:${c.hidden}` : ''}`)]);

test('pairs each train with the first bus it can make', () => {
  const result = pairConnections([train('t1', minutes(4), minutes(12))], [bus('b1', minutes(16)), bus('b2', minutes(20))], options);
  deepStrictEqual(summary(result), [['b1', ['t1:4']]]);
});

test('rounds down, so a 2:59 transfer fails a 3 minute rule', () => {
  const result = pairConnections([train('t1', minutes(4), minutes(12))], [bus('b1', minutes(12) + 179), bus('b2', minutes(20))], options);
  deepStrictEqual(summary(result), [['b2', ['t1:8']]]);
});

test('hides trains leaving sooner than the rider can reach them', () => {
  const result = pairConnections([train('t1', minutes(2) + 59, minutes(10))], [bus('b1', minutes(15))], options);
  deepStrictEqual(summary(result), []);
});

test('drops transfers over the maximum', () => {
  const result = pairConnections([train('t1', minutes(4), minutes(12))], [bus('b1', minutes(25))], options);
  deepStrictEqual(summary(result), []);
});

test('lists every train that makes a bus, in train order', () => {
  const trains = [train('t2', minutes(13), minutes(21)), train('t1', minutes(10), minutes(18))];
  const result = pairConnections(trains, [bus('b1', minutes(29))], options);
  deepStrictEqual(summary(result), [['b1', ['t1:11', 't2:8']]]);
});

test('a bus with no qualifying train does not take one of the 3 spots', () => {
  const trains = [train('t1', minutes(4), minutes(12)), train('t2', minutes(20), minutes(28)), train('t3', minutes(30), minutes(38)), train('t4', minutes(40), minutes(48))];
  const buses = [bus('b1', minutes(16)), bus('b-unreachable', minutes(17)), bus('b2', minutes(32)), bus('b3', minutes(42)), bus('b4', minutes(52))];
  const result = pairConnections(trains, buses, options);
  deepStrictEqual(summary(result), [['b1', ['t1:4']], ['b2', ['t2:4']], ['b3', ['t3:4']]]);
});

test('canceled buses never connect but show in place', () => {
  const buses = [bus('b1', minutes(16), { canceled: true }), bus('b2', minutes(20))];
  const result = pairConnections([train('t1', minutes(4), minutes(12))], buses, options);
  deepStrictEqual(summary(result), [['b2', ['t1:8']]]);
  const later = pairConnections([train('t1', minutes(4), minutes(12)), train('t2', minutes(20), minutes(28))], [...buses, bus('b3', minutes(32))], options);
  deepStrictEqual(summary(later), [['b2', ['t1:8']], ['b3', ['t2:4']]]);
  const inPlace = pairConnections(
    [train('t1', minutes(4), minutes(12)), train('t2', minutes(20), minutes(28))],
    [bus('b1', minutes(16)), bus('b-gone', minutes(25), { canceled: true }), bus('b3', minutes(32))],
    options,
  );
  deepStrictEqual(inPlace.map(({ trip, canceled }) => [trip, canceled ?? false]), [['b1', false], ['b-gone', true], ['b3', false]]);
});

test('reveals hidden connections in place when asked', () => {
  const trains = [train('soon', minutes(1), minutes(9)), train('t1', minutes(4), minutes(12))];
  const buses = [bus('b-tight', minutes(14)), bus('b1', minutes(16))];
  const result = pairConnections(trains, buses, { ...options, showHidden: true });
  deepStrictEqual(summary(result), [['b-tight', ['soon:5:soon', 't1:2:short']], ['b1', ['t1:4']]]);
});

test('fills with hidden connections when nothing qualifies', () => {
  const result = pairConnections([train('t1', minutes(4), minutes(12))], [bus('b1', minutes(30))], { ...options, showHidden: true });
  deepStrictEqual(summary(result), [['b1', ['t1:18:long']]]);
});

test('shows destination arrival only when it comes after boarding', () => {
  const buses = [bus('b1', minutes(16), { destination: minutes(28) }), bus('b2', minutes(20), { destination: minutes(10) })];
  const trains = [train('t1', minutes(4), minutes(12)), train('t2', minutes(8), minutes(16))];
  const result = pairConnections(trains, buses, options);
  strictEqual(result[0]?.destination, minutes(28));
  strictEqual(result[1]?.destination, undefined);
});
