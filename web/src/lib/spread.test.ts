import { deepStrictEqual, ok } from 'node:assert/strict';
import { test } from 'node:test';
import { spread } from './spread.ts';

// Stops around two corners, in meters east and south of the rider (SVG's y points down), with
// the marker sizes the map uses at its widest view there.
const MISSION_24TH = { size: 44.3, clear: 40.9, stops: [{ x: 6, y: -13 }, { x: 198, y: -27 }, { x: -13, y: 2 }, { x: 385, y: -62 }, { x: 376, y: -27 }, { x: -11, y: 26 }, { x: 0, y: -17 }, { x: -6, y: -24 }] };
const VAN_NESS_MARKET = { size: 41.4, clear: 38.2, stops: [{ x: 5, y: 11 }, { x: -1, y: 3 }, { x: -2, y: 16 }, { x: 4, y: 0 }, { x: 4, y: 8 }, { x: -4, y: -4 }] };
// The same corner from a few meters west, where every stop is on one side of the rider.
const VAN_NESS_WEST = { size: 40.4, clear: 37.3, stops: [{ x: -4, y: 11 }, { x: -10, y: 3 }, { x: -11, y: 16 }, { x: -5, y: 0 }, { x: -5, y: 8 }, { x: -12, y: -4 }] };

for (const [name, { size, clear, stops }] of Object.entries({ MISSION_24TH, VAN_NESS_MARKET, VAN_NESS_WEST })) {
  test(`spread keeps every marker clear of the others and the rider, in its stop's place, at ${name}`, () => {
    const placed = spread(stops, size, clear);
    const slack = 1e-6;
    // A stop a few meters off is where the rider stands, or where another stop is, so any side
    // of it will do.
    const near = size / 4;
    placed.forEach((a, i) => {
      const stop = stops[i]!;
      ok(Math.abs(a.x) >= clear - slack || Math.abs(a.y) >= clear - slack, `marker ${i} covers the rider`);
      // Across from its stop would send the rider the wrong way.
      if (Math.hypot(stop.x, stop.y) > near) ok(a.x * stop.x + a.y * stop.y > 0, `marker ${i} is across the rider from its stop`);
      placed.slice(i + 1).forEach((b, k) => {
        const j = i + 1 + k;
        ok(Math.abs(a.x - b.x) >= size - slack || Math.abs(a.y - b.y) >= size - slack, `markers ${i} and ${j} overlap`);
        const [dx, dy] = [stops[j]!.x - stop.x, stops[j]!.y - stop.y];
        if (Math.hypot(dx, dy) > near) ok((b.x - a.x) * dx + (b.y - a.y) * dy > 0, `markers ${i} and ${j} swap places`);
      });
    });
  });
}

test('spread leaves markers that already clear each other and the rider where their stops are', () => {
  const stops = [{ x: 120, y: 0 }, { x: -120, y: 40 }, { x: 0, y: -200 }];
  deepStrictEqual(spread(stops, 40, 40), stops);
});

test('spread parts two stops at one spot up and down', () => {
  const [first, second] = spread([{ x: 100, y: 100 }, { x: 100, y: 100 }], 40, 40);
  deepStrictEqual([first, second], [{ x: 100, y: 80 }, { x: 100, y: 120 }]);
});
