import { strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { endKind, isJourneySearch, isStopToStop } from './ends.ts';

test('an end is a stop, a route, a place, or wherever the rider is', () => {
  strictEqual(endKind('SF:13477'), 'stop');
  strictEqual(endKind('BA:901209'), 'stop');
  strictEqual(endKind('route:SF:22'), 'route');
  strictEqual(endKind('place:node-42'), 'place');
  strictEqual(endKind('@here'), 'here');
});

test('only the trip planner answers for a place or the rider, and two stops get both tabs', () => {
  strictEqual(isJourneySearch({ from: '@here', to: 'SF:13517' }), true);
  strictEqual(isJourneySearch({ from: 'SF:13477', to: 'place:node-42' }), true);
  strictEqual(isJourneySearch({ from: 'SF:13477', to: 'SF:13517' }), false);
  strictEqual(isJourneySearch({ from: 'SF:13477', to: 'route:SF:22' }), false);
  // A stop's arrivals have no To.
  strictEqual(isJourneySearch({ from: 'SF:13477', to: '' }), false);
  strictEqual(isStopToStop({ from: 'SF:13477', to: 'SF:13517' }), true);
  strictEqual(isStopToStop({ from: 'SF:13477', to: 'route:SF:22' }), false);
  strictEqual(isStopToStop({ from: 'SF:13477', to: '' }), false);
});
