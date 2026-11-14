import { deepStrictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { textScale } from './text-size.ts';

test("the root font follows iOS's body text as a share of its default size, from it up to twice it", () => {
  // xSmall, Medium, Large (the default), xxxLarge, then two of the larger accessibility sizes.
  deepStrictEqual([14, 16, 17, 23, 33, 53].map((px) => Math.round(textScale(px) * 100)), [100, 100, 100, 135, 194, 200]);
});
