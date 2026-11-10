import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { CLEAR, type LabelAsk, type Line, type Scene, fitName, gapTo, gapToSegment, lengthInside, placeLabels } from './map-labels.ts';

const bounds = { width: 300, height: 200 };
const scene = (over: Partial<Scene> = {}): Scene => ({ blocked: [], stops: [], lines: [], bounds, ...over });
const ask = (key: string, x: number, y: number, more: Partial<LabelAsk> = {}): LabelAsk => ({ key, x, y, radius: 6, sizes: [{ width: 60, height: 20 }], ...more });
const boxOf = (placed: { left: number; top: number; size: number }, from: LabelAsk) => ({ left: placed.left, top: placed.top, ...from.sizes[placed.size]! });
// Lines through the marker at (150, 100), each drawn 4 wide.
const across: Line = { points: [[0, 100], [300, 100]], half: 2 };
const diagonals: Line[] = [
  { points: [[50, 0], [250, 200]], half: 2 },
  { points: [[250, 0], [50, 200]], half: 2 },
];

test('the length of a segment inside a box', () => {
  const box = { left: 10, top: 10, width: 20, height: 20 };
  strictEqual(lengthInside(box, [0, 20], [40, 20]), 20);
  strictEqual(lengthInside(box, [15, 15], [25, 15]), 10);
  strictEqual(lengthInside(box, [0, 0], [40, 5]), 0);
  strictEqual(Math.round(lengthInside(box, [20, 0], [20, 15])), 5);
});

test('the gap from a box to a segment and to a circle', () => {
  const box = { left: 10, top: 10, width: 20, height: 20 };
  strictEqual(gapToSegment(box, [0, 20], [40, 20]), 0);
  strictEqual(gapToSegment(box, [0, 35], [40, 35]), 5);
  // Nearest at the box's corner.
  strictEqual(Math.round(gapToSegment(box, [30, 50], [50, 30]) * 100), Math.round(Math.hypot(10, 10) * 100));
  // Nearest at the segment's end.
  strictEqual(gapToSegment(box, [20, 40], [20, 60]), 10);
  strictEqual(gapTo(box, { x: 20, y: 40, radius: 4 }), 6);
});

test('a label sits under its marker, a clear gap from it, when nothing is in the way', () => {
  deepStrictEqual(placeLabels([ask('a', 150, 100)], scene()), [{ key: 'a', left: 120, top: 110, align: 'center', size: 0 }]);
});

test('a label keeps clear of a line running under its marker', () => {
  // The line heads straight down from the marker, so the label goes over it.
  const [label] = placeLabels([ask('a', 150, 100)], scene({ lines: [{ points: [[150, 100], [150, 200]], half: 2 }] }));
  deepStrictEqual(label, { key: 'a', left: 120, top: 70, align: 'center', size: 0 });
});

test('a label keeps a clear gap from buttons, lines, other markers and labels placed before it', () => {
  const button = { left: 100, top: 112, width: 100, height: 60 };
  const asks = [ask('a', 150, 100), ask('b', 150, 60)];
  const stops = [{ x: 200, y: 80, radius: 3 }];
  const line: Line = { points: [[0, 20], [300, 20]], half: 3 };
  const [first, second] = placeLabels(asks, scene({ blocked: [button], stops, lines: [line] }));
  ok(first && second);
  const [a, b] = [boxOf(first, asks[0]!), boxOf(second, asks[1]!)];
  for (const box of [a, b]) {
    ok(box.top + box.height <= button.top - CLEAR || box.left >= button.left + button.width + CLEAR || box.left + box.width <= button.left - CLEAR);
    ok(gapTo(box, stops[0]!) >= CLEAR);
    ok(gapToSegment(box, [0, 20], [300, 20]) >= line.half + CLEAR);
  }
  ok(gapTo(a, asks[1]!) >= CLEAR && gapTo(b, asks[0]!) >= CLEAR);
  ok(a.left >= b.left + b.width + CLEAR || b.left >= a.left + a.width + CLEAR || a.top >= b.top + b.height + CLEAR || b.top >= a.top + a.height + CLEAR);
});

test('a label near the side slides in to stay on the map, and one with no room is left out', () => {
  deepStrictEqual(placeLabels([ask('a', 10, 100)], scene()), [{ key: 'a', left: 4, top: 110, align: 'start', size: 0 }]);
  deepStrictEqual(placeLabels([ask('a', 20, 20)], scene({ bounds: { width: 50, height: 30 } })), []);
});

test('a label never sits nearer another marker than its own', () => {
  // Under its marker the label would clear the stop below by the gap asked, but sit as near to
  // it as to its own marker, so it goes over instead.
  const stops = [{ x: 150, y: 138.5, radius: 4 }];
  const [label] = placeLabels([ask('a', 150, 100)], scene({ stops }));
  strictEqual(label?.top, 70);
  // A marker drawn over its own, as a vehicle at the stop, only has to be kept off.
  const asks = [ask('a', 150, 100), ask('bus', 153, 100, { radius: 12 })];
  const [stop] = placeLabels(asks, scene());
  ok(stop && gapTo(boxOf(stop, asks[0]!), asks[1]!) >= CLEAR);
});

test('a label stays within a marker width of its marker, or is left out', () => {
  // Lines fan out from the marker, with no room between them until well away from it.
  const lines = [across, ...diagonals];
  deepStrictEqual(placeLabels([ask('a', 150, 100)], scene({ lines })), []);
});

test('a label with no room beside its marker stands off it on a short leader', () => {
  const lines = [across, ...diagonals];
  const from = ask('a', 150, 100, { leader: true });
  const [label] = placeLabels([from], scene({ lines }));
  ok(label?.leader);
  const away = gapTo(boxOf(label, from), from);
  ok(away >= 24 && away <= 44, `${away}`);
  for (const { points, half } of lines) ok(gapToSegment(boxOf(label, from), points[0]!, points[1]!) >= half + CLEAR);
  // The leader starts at the marker's edge and stops short of the label.
  const [x1, y1, x2, y2] = label.leader;
  strictEqual(Math.round(Math.hypot(x1 - 150, y1 - 100)), 6);
  ok(Math.hypot(x2 - x1, y2 - y1) < away);
});

test('a label takes a shorter size before a leader, and goes without its name only after one', () => {
  const lines = [across, ...diagonals];
  // The short size fits between the lines beside the marker. The full one does not.
  const short = ask('a', 150, 100, { leader: true, sizes: [{ width: 60, height: 20 }, { width: 10, height: 10 }] });
  const [beside] = placeLabels([short], scene({ lines }));
  strictEqual(beside?.size, 1);
  strictEqual(beside?.leader, undefined);
  // The same small size, but without the stop's name: the named one on a leader comes first.
  const bare = ask('a', 150, 100, { leader: true, sizes: [{ width: 60, height: 20 }, { width: 10, height: 10, bare: true }] });
  const [named] = placeLabels([bare], scene({ lines }));
  strictEqual(named?.size, 0);
  ok(named?.leader);
  // With no leader allowed, it goes without its name.
  const [unnamed] = placeLabels([{ ...bare, leader: false }], scene({ lines }));
  strictEqual(unnamed?.size, 1);
});

test('the label the map never goes without crosses a line when it has to', () => {
  const lines = [across, ...diagonals];
  const from = ask('a', 150, 100, { must: true });
  const [label] = placeLabels([from], scene({ lines }));
  ok(label);
  ok(gapTo(boxOf(label, from), from) <= CLEAR + from.radius * 2);
  // Then it may sit as near another marker as its own, but never on one.
  const stops = [{ x: 150, y: 138.5, radius: 4 }, { x: 150, y: 61.5, radius: 4 }, { x: 188, y: 100, radius: 4 }, { x: 112, y: 100, radius: 4 }];
  const [crowded] = placeLabels([from], scene({ lines, stops }));
  ok(crowded);
  for (const stop of stops) ok(gapTo(boxOf(crowded, from), stop) >= CLEAR);
});

test('with room for one label, the one asked first gets it', () => {
  // A strip with its right half under a button: each label fits only between the two markers.
  const strip = scene({ bounds: { width: 200, height: 60 }, blocked: [{ left: 108, top: 0, width: 92, height: 60 }] });
  const [a, b] = [ask('a', 100, 30), ask('b', 18, 30)];
  deepStrictEqual(placeLabels([a, b], strip).map(({ key }) => key), ['a']);
  deepStrictEqual(placeLabels([b, a], strip).map(({ key }) => key), ['b']);
});

test('a marker off the map gets no label, even on a leader', () => {
  deepStrictEqual(placeLabels([ask('a', 150, -8, { leader: true, must: true })], scene()), []);
});

// Every letter 10 wide, and the ellipsis too.
const measure = (text: string) => text.length * 10;

test('a name that fits takes one line', () => {
  deepStrictEqual(fitName('Daly City', 100, 150, 2, measure), { lines: ['Daly City'], width: 90 });
});

test('two lines break where they come out most alike', () => {
  deepStrictEqual(fitName('Powell St Station East', 150, 200, 2, measure).lines, ['Powell St', 'Station East']);
  deepStrictEqual(fitName('San Francisco International', 160, 200, 2, measure).lines, ['San Francisco', 'International']);
});

test('a short last word is not left alone when the name fits one wider line', () => {
  deepStrictEqual(fitName('Montgomery St', 120, 140, 2, measure).lines, ['Montgomery St']);
  // With no room for that, the break stays.
  deepStrictEqual(fitName('Montgomery St', 120, 125, 2, measure).lines, ['Montgomery', 'St']);
});

test('a name cut short always ends in an ellipsis', () => {
  const long = 'Frida Khalo & Ocean Ave/City College Welcome Center';
  const two = fitName(long, 190, 250, 2, measure);
  deepStrictEqual(two.lines, ['Frida Khalo & Ocean', 'Ave/City College W…']);
  ok(two.width <= 190);
  // One line, with no space or joining mark left before the ellipsis.
  deepStrictEqual(fitName(long, 140, 250, 1, measure).lines, ['Frida Khalo…']);
  deepStrictEqual(fitName(long, 200, 250, 1, measure).lines, ['Frida Khalo & Ocean…']);
  // One long word.
  deepStrictEqual(fitName('Pneumonoultramicroscopic', 100, 150, 2, measure).lines, ['Pneumonou…']);
});
