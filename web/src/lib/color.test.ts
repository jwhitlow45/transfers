import { ok, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { BUS_PALETTE, SAVED_COLORS, contrast, textOn } from './color.ts';

test('chip text reaches 4.5:1 on every palette color', () => {
  for (const color of [...BUS_PALETTE, ...SAVED_COLORS.map(({ color }) => color), '#0099d8', '#4db848', '#e2231a', '#1d2d3d']) {
    const ratio = contrast(color, textOn(color));
    ok(ratio >= 4.5, `${color} with ${textOn(color)} is ${ratio.toFixed(2)}:1`);
  }
});

test('chip text is white or near black wherever either reaches 4.5:1, whichever is stronger', () => {
  strictEqual(textOn('#2b6fa8'), '#ffffff');
  strictEqual(textOn('#f2c500'), '#111214');
  strictEqual(textOn('#00858a'), '#000000');
});
