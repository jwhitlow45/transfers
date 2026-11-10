import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { lengthInside, placeLabels } from './map-labels.ts';

const bounds = { width: 300, height: 200 };
const ask = (key: string, x: number, y: number) => ({ key, x, y, radius: 6, width: 60, height: 20 });

test('the length of a segment inside a box', () => {
  const box = { left: 10, top: 10, width: 20, height: 20 };
  strictEqual(lengthInside(box, [0, 20], [40, 20]), 20);
  strictEqual(lengthInside(box, [15, 15], [25, 15]), 10);
  strictEqual(lengthInside(box, [0, 0], [40, 5]), 0);
  strictEqual(Math.round(lengthInside(box, [20, 0], [20, 15])), 5);
});

test('a label sits under its marker when nothing is in the way', () => {
  deepStrictEqual(placeLabels([ask('a', 150, 100)], [], [], bounds), [{ key: 'a', left: 120, top: 111, align: 'center' }]);
});

test('a label moves off a line running under its marker', () => {
  // The line heads straight down from the marker, so the label goes over it.
  const [label] = placeLabels([ask('a', 150, 100)], [], [[[150, 100], [150, 200]]], bounds);
  deepStrictEqual(label, { key: 'a', left: 120, top: 69, align: 'center' });
});

test('a label keeps off blocked areas and labels placed before it', () => {
  const button = { left: 100, top: 106, width: 100, height: 60 };
  const [first, second] = placeLabels([ask('a', 150, 100), ask('b', 150, 60)], [button], [], bounds);
  // Under is blocked by the button, so the first goes over its marker. The second then cannot go
  // under its own, where the first now is, and goes over too.
  deepStrictEqual(first, { key: 'a', left: 120, top: 69, align: 'center' });
  deepStrictEqual(second, { key: 'b', left: 120, top: 29, align: 'center' });
});

test('a label near the side slides in to stay on the map, and one with no room is left out', () => {
  deepStrictEqual(placeLabels([ask('a', 10, 100)], [], [], bounds), [{ key: 'a', left: 2, top: 111, align: 'center' }]);
  deepStrictEqual(placeLabels([ask('a', 20, 20)], [], [], { width: 50, height: 30 }), []);
});
