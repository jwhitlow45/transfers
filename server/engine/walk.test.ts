import { strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { defaultMaximum, minimumMinutes, transferSeconds } from './walk.ts';

test('matches the transfers J has made', () => {
  // 24th St Mission's SW plaza to 13477, and Civic Center's 8th St entrance to 13209.
  strictEqual(minimumMinutes(transferSeconds({ exit: 'bart', entry: 'street', meters: 36 })), 3);
  strictEqual(minimumMinutes(transferSeconds({ exit: 'bart', entry: 'street', meters: 37 })), 3);
});

test('bus to bus across the street', () => {
  strictEqual(minimumMinutes(transferSeconds({ exit: 'street', entry: 'street', meters: 39 })), 2);
});

test('same pole bus to bus is at least a minute', () => {
  strictEqual(minimumMinutes(transferSeconds({ exit: 'street', entry: 'street', meters: 0 })), 1);
});

test('a slower walking speed lengthens the walk', () => {
  const brisk = transferSeconds({ exit: 'street', entry: 'street', meters: 300 });
  const slow = transferSeconds({ exit: 'street', entry: 'street', meters: 300, speed: 0.9 });
  strictEqual(minimumMinutes(brisk), 6);
  strictEqual(minimumMinutes(slow), 8);
});

test('the window widens for infrequent routes', () => {
  strictEqual(defaultMaximum(3, 6), 12);
  strictEqual(defaultMaximum(3, null), 12);
  strictEqual(defaultMaximum(3, 30), 33);
});
