import { deepStrictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { chainSteps, nameGroups } from './wrap.ts';

test('a name keeps its last two words together, and a joining mark on the word before it', () => {
  deepStrictEqual(nameGroups('25th St & Dakota St'), ['25th', 'St &', 'Dakota St']);
  deepStrictEqual(nameGroups('22nd St + Iowa St'), ['22nd', 'St +', 'Iowa St']);
  deepStrictEqual(nameGroups('San Francisco International Airport'), ['San', 'Francisco', 'International Airport']);
  deepStrictEqual(nameGroups('Bayview District - Hudson & Newhall'), ['Bayview', 'District -', 'Hudson & Newhall']);
  deepStrictEqual(nameGroups('Daly City'), ['Daly City']);
  deepStrictEqual(nameGroups('Colma'), ['Colma']);
  deepStrictEqual(nameGroups(''), []);
});

test('a no-break space joins what it joins, and a mark that leads a name stands alone', () => {
  deepStrictEqual(nameGroups('off at Daly City BART 11:44 PM'), ['off', 'at', 'Daly', 'City', 'BART 11:44 PM']);
  deepStrictEqual(nameGroups('& Sons'), ['& Sons']);
  deepStrictEqual(nameGroups('+ Iowa St extra'), ['+', 'Iowa', 'St extra']);
});

test('each arrow of a chain goes with the step after it', () => {
  deepStrictEqual(chainSteps('Montgomery St → Daly City → 120'), ['Montgomery St', '→ Daly City', '→ 120']);
  deepStrictEqual(chainSteps('25th St & Dakota St'), ['25th St & Dakota St']);
});
