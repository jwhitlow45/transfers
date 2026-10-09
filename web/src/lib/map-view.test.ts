import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { fingersOn, keepIn, keyView, zoomAbout } from './map-view.ts';

const whole = { left: -100, top: -50, width: 200, height: 100 };

test('a view stays between the whole picture and the closest zoom, inside the picture', () => {
  deepStrictEqual(keepIn({ x: 500, y: 0, zoom: 0.5 }, whole, 4), { x: 0, y: 0, zoom: 1 });
  deepStrictEqual(keepIn({ x: 500, y: -500, zoom: 9 }, whole, 4), { x: 75, y: -37.5, zoom: 4 });
  deepStrictEqual(keepIn({ x: 10, y: 5, zoom: 2 }, whole, 4), { x: 10, y: 5, zoom: 2 });
});

test('zooming about a point on screen keeps the map point under it there, at any factor', () => {
  // 2 screen pixels per map unit at zoom 1, and a tap 40 px right of and 20 px above the middle.
  const view = { x: 0, y: 0, zoom: 1 };
  const offset = { x: 40, y: -20 };
  for (const zoom of [2, 1.5, 3]) {
    const next = zoomAbout(view, offset, 2, zoom);
    const scale = 2 * zoom;
    deepStrictEqual({ x: next.x + offset.x / scale, y: next.y + offset.y / scale }, { x: 20, y: -10 });
  }
});

test("a pinch's fingers count as the map's wherever on it they start, a line or a marker or the background", () => {
  const node = (name: string) => ({ name }) as unknown as Node;
  const [map, line, halo, page] = [node('svg'), node('polyline'), node('circle'), node('body')];
  const inside = new Set([map, line, halo]);
  const svg = { contains: (node: Node | null) => node !== null && inside.has(node) };
  strictEqual(fingersOn(svg, [{ target: line }, { target: halo }]), 2);
  strictEqual(fingersOn(svg, [{ target: map }, { target: line }]), 2);
  strictEqual(fingersOn(svg, [{ target: line }, { target: page }]), 1);
});

test('keys zoom about the middle, move a zoomed map a fifth of what it shows, and leave the page what it would have', () => {
  const keep = (view: { x: number; y: number; zoom: number }) => keepIn(view, whole, 4);
  const press = (key: string, more: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({ key, altKey: false, ctrlKey: false, metaKey: false, ...more });
  const out = { x: 0, y: 0, zoom: 1 };
  deepStrictEqual(keyView(out, press('+'), whole, keep), { x: 0, y: 0, zoom: 2 });
  deepStrictEqual(keyView(out, press('='), whole, keep), { x: 0, y: 0, zoom: 2 });
  // Zoomed out, the arrows scroll the page, and a modified key is the browser's.
  strictEqual(keyView(out, press('ArrowDown'), whole, keep), undefined);
  strictEqual(keyView(out, press('+', { ctrlKey: true }), whole, keep), undefined);
  strictEqual(keyView(out, press('+', { metaKey: true }), whole, keep), undefined);
  strictEqual(keyView(out, press('a'), whole, keep), undefined);
  // At zoom 2 the map shows 100 by 50, so a press moves it 20 or 10, as far as the picture goes.
  const zoomed = { x: 0, y: 0, zoom: 2 };
  deepStrictEqual(keyView(zoomed, press('ArrowRight'), whole, keep), { x: 20, y: 0, zoom: 2 });
  deepStrictEqual(keyView(zoomed, press('ArrowUp'), whole, keep), { x: 0, y: -10, zoom: 2 });
  deepStrictEqual(keyView({ x: 45, y: 0, zoom: 2 }, press('ArrowRight'), whole, keep), { x: 50, y: 0, zoom: 2 });
  // Back out to the whole picture, the map follows the page's frame again, and at the closest zoom
  // plus stays.
  strictEqual(keyView(zoomed, press('-'), whole, keep), null);
  deepStrictEqual(keyView({ x: 0, y: 0, zoom: 4 }, press('+'), whole, keep), { x: 0, y: 0, zoom: 4 });
});
