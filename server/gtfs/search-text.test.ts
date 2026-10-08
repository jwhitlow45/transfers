import { strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { searchQuery, searchText } from './search-text.ts';

test('names and queries share short forms, whatever the agency spells out', () => {
  strictEqual(searchText('24th Street / Mission'), '24th st mission');
  strictEqual(searchText('24th St & Mission St'), '24th st mission st');
});

test('a corner said as riders say it matches the names, which join streets with "&"', () => {
  strictEqual(searchQuery('24th and Mission'), '"24th" "mission"*');
  strictEqual(searchQuery('Van Ness at Market'), '"van" "ness" "market"*');
  // Typed alone, a connector is still a word to look for.
  strictEqual(searchQuery('at'), '"at"*');
  strictEqual(searchQuery('  '), null);
});
