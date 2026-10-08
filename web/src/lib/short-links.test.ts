import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { chipLabel, stopLabel } from '../../../shared/labels.ts';
import { decodeEnd, encodeEnd, parseShortTrip, shortTripPath } from '../../../shared/short-links.ts';

test('a trip shortens to a few characters an end, and back', () => {
  strictEqual(shortTripPath('SF:13477', 'SF:13517'), '/s/maed.mafh');
  deepStrictEqual(parseShortTrip('/s/maed.mafh'), { from: 'SF:13477', to: 'SF:13517' });
  // An id with a dot of its own keeps it escaped, so the ends still part at the one dot.
  deepStrictEqual(parseShortTrip(shortTripPath('GF:ferry.1', 'SF:13517')!), { from: 'GF:ferry.1', to: 'SF:13517' });
  for (const key of ['BA:901209', 'route:SF:48', 'route:SF:KBUS', 'GF:ferry.1', 'SM:0042']) strictEqual(decodeEnd(encodeEnd(key)!), key);
});

test('a link that is not a trip opens nothing', () => {
  for (const path of ['/s/maed', '/s/xaed/maed', '/s/m/maed', '/s/M1c/maed', '/t/maed/mafx']) strictEqual(parseShortTrip(path), null);
});

test('a short link names its ends as the app does', () => {
  strictEqual(stopLabel({ agency: 'SF', name: '24th St & Mission St', code: '13477' }), '24th St & Mission St (13477)');
  strictEqual(stopLabel({ agency: 'BA', name: '24th Street / Mission', code: null }), '24th St Mission');
  strictEqual(chipLabel({ agency: 'BA', name: 'Yellow' }), 'BART');
  strictEqual(chipLabel({ agency: 'SF', name: '48' }), '48');
});
