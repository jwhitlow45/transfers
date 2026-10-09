import { deepStrictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { failureOf } from './failure.ts';

test("a stop or route no longer in the schedule is said plainly, and any other refusal in the server's words", () => {
  deepStrictEqual(failureOf(null, 'Results'), null);
  const missing = "This stop or route isn't in the schedule anymore";
  deepStrictEqual(failureOf('No stop SF:999', 'Arrivals'), { text: missing, short: 'Not found', full: missing });
  deepStrictEqual(failureOf('Send from and to', 'Results'), { text: 'Send from and to', short: 'Error', full: 'Results could not load: Send from and to' });
});
