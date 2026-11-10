import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { chainSteps, joinPairs } from './wrap.ts';

const NB = '\u00a0';
// Shown with "_" for a no-break space.
const shown = (text: string) => joinPairs(text).replaceAll(NB, '_');

test('a street keeps its kind, and "&" and "+" stay with the word before them', () => {
  strictEqual(shown('25th St & Dakota St'), '25th_St_& Dakota_St');
  strictEqual(shown('22nd St + Iowa St'), '22nd_St_+ Iowa_St');
  strictEqual(shown('24th St & Potrero Ave'), '24th_St_& Potrero_Ave');
  strictEqual(shown('395 Hickey Blvd & Kaiser Medical Offices Driveway'), '395 Hickey_Blvd_& Kaiser Medical Offices Driveway');
  strictEqual(shown('John Daly Blvd, Skyline Dr.'), 'John Daly_Blvd, Skyline_Dr.');
});

test('other words of a name stay apart, as a pair must be short', () => {
  strictEqual(shown('San Francisco International Airport'), 'San Francisco International Airport');
  strictEqual(shown('Daly City BART'), 'Daly City BART');
  // A word that only starts like a street's kind is no pair.
  strictEqual(shown('Bay Street Station'), 'Bay Street Station');
  strictEqual(shown('St Francis Circle'), 'St Francis Circle');
});

test('a number stays with its unit', () => {
  strictEqual(shown('About 1 stop before Montgomery St'), 'About 1_stop before Montgomery_St');
  strictEqual(shown('Live times 5 min old'), 'Live times 5_min old');
  strictEqual(shown('~17 min transfer'), '~17_min transfer');
  strictEqual(shown('Stop 13507'), 'Stop 13507');
  strictEqual(shown('40 m away'), '40_m away');
  strictEqual(shown('The 48 is rerouted'), 'The 48 is rerouted');
});

test('what is joined already stays as it is, and nothing is lost', () => {
  strictEqual(joinPairs(`off 11:57${NB}PM`), `off 11:57${NB}PM`);
  strictEqual(joinPairs(''), '');
  strictEqual(joinPairs('Colma'), 'Colma');
  strictEqual(joinPairs('a  b'), 'a  b');
});

test('each arrow of a chain goes with the step after it', () => {
  deepStrictEqual(chainSteps('Montgomery St → Daly City → 120'), ['Montgomery St', `→${NB}Daly City`, `→${NB}120`]);
  deepStrictEqual(chainSteps('25th St & Dakota St'), ['25th St & Dakota St']);
});
