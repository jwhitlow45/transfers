import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { decodeEnd, encodeEnd, parseShortTrip, shortTripPath } from '../../../shared/short-links.ts';

test('a trip shortens to a few characters an end, and back', () => {
  strictEqual(shortTripPath('SF:13477', 'SF:13517'), '/s/maed/mafh');
  deepStrictEqual(parseShortTrip('/s/maed/mafh'), { from: 'SF:13477', to: 'SF:13517' });
  for (const key of ['BA:901209', 'route:SF:48', 'route:SF:KBUS', 'GF:ferry.1', 'SM:0042']) strictEqual(decodeEnd(encodeEnd(key)!), key);
});

test('a link that is not a trip opens nothing', () => {
  for (const path of ['/s/maed', '/s/xaed/maed', '/s/m/maed', '/s/M1c/maed', '/t/maed/mafx']) strictEqual(parseShortTrip(path), null);
});
