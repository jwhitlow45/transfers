import { deepStrictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { csvRecords, csvRows } from './csv.ts';

test('reads quoted fields with commas, doubled quotes, and CRLF', () => {
  const text = '﻿a,b,c\r\n"x, y","say ""hi""",3\r\nplain,,last\n';
  deepStrictEqual([...csvRows(text)], [
    ['a', 'b', 'c'],
    ['x, y', 'say "hi"', '3'],
    ['plain', '', 'last'],
  ]);
});

test('keeps stray text after a closing quote', () => {
  deepStrictEqual([...csvRows('"SFIA" Entrance,2\n')], [['SFIA Entrance', '2']]);
});

test('skips blank lines and handles a missing final newline', () => {
  deepStrictEqual([...csvRows('a,b\n\n1,2')], [['a', 'b'], ['1', '2']]);
});

test('maps records by column name and fills missing columns', () => {
  const records = [...csvRecords('stop_id,stop_name\n 13477 ,24th St & Mission St\n', ['stop_id', 'stop_name', 'stop_code'])];
  deepStrictEqual(records, [{ stop_id: '13477', stop_name: '24th St & Mission St', stop_code: '' }]);
});
