// Where the live map's labels go, and how a long name is set in one. Everything here is in screen
// pixels from the map's top left corner, so the text can be HTML over the map, sized by the
// rider's text size, and still keep clear of the drawing under it.

export type Rect = { left: number; top: number; width: number; height: number };
export type Circle = { x: number; y: number; radius: number };
// A drawn line: its points, and half its width as drawn.
export type Line = { points: readonly (readonly [number, number])[]; half: number };
// A size a label can take. `bare` is one without the stop's name, only what the rider does there.
export type LabelSize = { width: number; height: number; bare?: boolean };
// A label to place beside the marker it names: the marker's middle and radius, and the sizes the
// label can take, fullest first. `leader` lets it stand a little off its marker on a short line
// when no spot beside the marker is free. `must` is a label the map never goes without.
export type LabelAsk = { key: string; x: number; y: number; radius: number; sizes: LabelSize[]; leader?: boolean; must?: boolean };
// `align` is the side of the label its marker is on, for setting its lines toward the marker.
// `size` is which of the ask's sizes fit. `leader` is the line from the marker to the label.
export type PlacedLabel = { key: string; left: number; top: number; align: 'start' | 'center' | 'end'; size: number; leader?: [number, number, number, number] };
// What the labels keep clear of: the map's buttons, the markers no label names, and the lines.
export type Scene = { blocked: Rect[]; stops: Circle[]; lines: Line[]; bounds: { width: number; height: number } };

// The least room between a label and anything else on the map: another label, a marker's ring, a
// line's edge, a button.
export const CLEAR = 4;
// A label sits that far from its own marker too, or a few steps further when that spot is taken,
// and never more than the marker's own width further. Past that it would read as
// some other stop's.
const REACH_STEPS = 6;
// How much of a label's width or height lies before its marker's middle, as it slides along the
// marker's side.
const SLIDES = [0.5, 0.35, 0.65, 0.2, 0.8, 0, 1];
// On a leader line, a label stands this far from its marker, nearest first.
const LEADER_REACHES = [24, 30, 36, 44];
// The sides a label tries, best first: under its marker as a caption reads, then over it, then
// beside it, then the corners.
const SIDES: { dx: -1 | 0 | 1; dy: -1 | 0 | 1 }[] = [
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: -1 },
];
// What a spot costs: a better side beats a worse one, a spot nearer the marker one further off,
// and a label set square on its marker one slid along it. Crossing a line is only ever allowed to
// a label the map never goes without, and costs most, by the pixel.
const SIDE_COST = 2;
const REACH_COST = 3;
const SLIDE_COST = 1;
const CROSSING_COST = 10;

const overlaps = (a: Rect, b: Rect) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
const grown = (rect: Rect, by: number): Rect => ({ left: rect.left - by, top: rect.top - by, width: rect.width + by * 2, height: rect.height + by * 2 });
// From a box to the edge of a circle, 0 or less where they touch.
export const gapTo = (rect: Rect, circle: Circle) =>
  Math.hypot(Math.max(rect.left - circle.x, 0, circle.x - rect.left - rect.width), Math.max(rect.top - circle.y, 0, circle.y - rect.top - rect.height)) - circle.radius;

// How much of the segment from `a` to `b` lies inside `rect`, in pixels (Liang and Barsky's
// clipping).
export function lengthInside(rect: Rect, a: readonly [number, number], b: readonly [number, number]) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  let [enter, leave] = [0, 1];
  const edges: [number, number][] = [
    [-dx, a[0] - rect.left],
    [dx, rect.left + rect.width - a[0]],
    [-dy, a[1] - rect.top],
    [dy, rect.top + rect.height - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return 0;
      continue;
    }
    const t = q / p;
    if (p < 0) enter = Math.max(enter, t);
    else leave = Math.min(leave, t);
  }
  return enter < leave ? (leave - enter) * Math.hypot(dx, dy) : 0;
}

// From a box to the segment from `a` to `b`, 0 where they touch. The two are nearest at a corner
// of the box or an end of the segment.
export function gapToSegment(rect: Rect, a: readonly [number, number], b: readonly [number, number]) {
  if (lengthInside(rect, a, b) > 0) return 0;
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const span = dx * dx + dy * dy;
  const fromCorner = (x: number, y: number) => {
    const t = span === 0 ? 0 : Math.min(1, Math.max(0, ((x - a[0]) * dx + (y - a[1]) * dy) / span));
    return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t);
  };
  const [right, bottom] = [rect.left + rect.width, rect.top + rect.height];
  return Math.min(
    fromCorner(rect.left, rect.top),
    fromCorner(right, rect.top),
    fromCorner(rect.left, bottom),
    fromCorner(right, bottom),
    gapTo(rect, { x: a[0], y: a[1], radius: 0 }),
    gapTo(rect, { x: b[0], y: b[1], radius: 0 }),
  );
}

// Whether any line's edge comes within the clear room around `rect`.
const crowded = (rect: Rect, lines: Line[]) =>
  lines.some(({ points, half }) => {
    const room = half + CLEAR;
    for (let n = 1; n < points.length; n++) {
      const [a, b] = [points[n - 1]!, points[n]!];
      // Most of a line is nowhere near.
      if (Math.max(a[0], b[0]) < rect.left - room || Math.min(a[0], b[0]) > rect.left + rect.width + room || Math.max(a[1], b[1]) < rect.top - room || Math.min(a[1], b[1]) > rect.top + rect.height + room) continue;
      if (gapToSegment(rect, a, b) < room) return true;
    }
    return false;
  });
// How much of the lines' middles runs under `rect`.
const covered = (rect: Rect, lines: Line[]) => {
  let length = 0;
  for (const { points } of lines) for (let n = 1; n < points.length; n++) length += lengthInside(rect, points[n - 1]!, points[n]!);
  return length;
};

type Spot = { rect: Rect; align: PlacedLabel['align']; cost: number };

// The spots around a marker at `reach` from its edge, each kept whole on the map by sliding in
// from the map's edge. A spot slid in may have moved off its marker or onto it: the caller checks
// how far each one ended up.
function spotsAt(ask: LabelAsk, size: LabelSize, reach: number, bounds: Scene['bounds']): Spot[] {
  const { width, height } = size;
  const spots: Spot[] = [];
  const [maxLeft, maxTop] = [bounds.width - CLEAR - width, bounds.height - CLEAR - height];
  const add = (left: number, top: number, align: Spot['align'], cost: number) =>
    spots.push({ rect: { left: Math.min(maxLeft, Math.max(CLEAR, left)), top: Math.min(maxTop, Math.max(CLEAR, top)), width, height }, align, cost });
  SIDES.forEach(({ dx, dy }, order) => {
    const base = order * SIDE_COST;
    if (dx !== 0 && dy !== 0) {
      // On a corner, the label starts from the marker's diagonal, not from its box.
      const out = (ask.radius + reach) * Math.SQRT1_2;
      add(dx > 0 ? ask.x + out : ask.x - out - width, dy > 0 ? ask.y + out : ask.y - out - height, dx > 0 ? 'start' : 'end', base);
      return;
    }
    const out = ask.radius + reach;
    // Square on the marker first, then slid along its side, to clear a line running straight on
    // or to sit in the fork of two.
    for (const part of SLIDES) {
      const slide = Math.abs(part - 0.5) * 4 * SLIDE_COST;
      if (dx === 0) {
        // Its lines are set toward the marker from where it ends up, slid in or not.
        const left = Math.min(maxLeft, Math.max(CLEAR, ask.x - width * part));
        const before = (ask.x - left) / width;
        add(left, dy > 0 ? ask.y + out : ask.y - out - height, before < 0.3 ? 'start' : before > 0.7 ? 'end' : 'center', base + slide);
      } else add(dx > 0 ? ask.x + out : ask.x - out - width, ask.y - height * part, dx > 0 ? 'start' : 'end', base + slide);
    }
  });
  return spots;
}

type Leader = [number, number, number, number];
// The straight line from a marker's edge to the nearest point of its label, a little short of it.
function leaderTo(ask: LabelAsk, rect: Rect): Leader {
  const [x, y] = [Math.min(rect.left + rect.width, Math.max(rect.left, ask.x)), Math.min(rect.top + rect.height, Math.max(rect.top, ask.y))];
  const length = Math.hypot(x - ask.x, y - ask.y) || 1;
  const [ux, uy] = [(x - ask.x) / length, (y - ask.y) / length];
  return [ask.x + ux * ask.radius, ask.y + uy * ask.radius, x - ux * 2, y - uy * 2];
}

// Places each label beside its marker, in the order given, which is their order of importance.
// A label goes within a marker's width of its own marker, nearer to it than to any other marker,
// on the map, and clear of every marker, line, button and label placed before it. When its
// fullest size has no such spot it tries its shorter ones. Then a label with `leader` stands a
// little further off on a line to its marker. Then it goes without its name, and one with `must`
// may cross a line, and sit as near another marker as its own, as a last resort. Any other is left out, and the list under the map still
// names its stop.
export function placeLabels(asks: LabelAsk[], scene: Scene): PlacedLabel[] {
  const { blocked, stops, lines, bounds } = scene;
  const placed: PlacedLabel[] = [];
  const taken: Rect[] = [];
  const leaders: Line[] = [];
  const walls = blocked.map((area) => grown(area, CLEAR));
  for (const ask of asks) {
    // A marker panned or pinched off the map has no label, as there is nothing to see it name.
    if (ask.x < 0 || ask.y < 0 || ask.x > bounds.width || ask.y > bounds.height) continue;
    // Every marker but its own. One drawn over its own marker, as a vehicle at the stop, is part
    // of the same spot on the map, so the label only has to keep off it.
    const others = [...asks.filter((other) => other !== ask), ...stops].map((other) => ({ x: other.x, y: other.y, radius: other.radius, joined: Math.hypot(other.x - ask.x, other.y - ask.y) < Math.max(other.radius, ask.radius) }));
    const own = { x: ask.x, y: ask.y, radius: ask.radius };
    // Whether a spot is on the map and clear of the buttons, the labels placed and their leaders.
    const free = (rect: Rect) => {
      if (rect.left < CLEAR || rect.top < CLEAR || rect.left + rect.width > bounds.width - CLEAR || rect.top + rect.height > bounds.height - CLEAR) return false;
      const room = grown(rect, CLEAR);
      return !walls.some((area) => overlaps(rect, area)) && !taken.some((area) => overlaps(room, area)) && !crowded(rect, leaders);
    };
    const beside = (size: LabelSize, sizeIndex: number, crossing: boolean): PlacedLabel | null => {
      let best: Spot | null = null;
      // No further off than the marker is wide.
      for (let step = 0; step <= REACH_STEPS; step++) {
        for (const spot of spotsAt(ask, size, CLEAR + (step / REACH_STEPS) * ask.radius * 2, bounds)) {
          const away = gapTo(spot.rect, own);
          if (away < CLEAR - 0.01 || away > CLEAR + ask.radius * 2 + 0.01 || !free(spot.rect)) continue;
          // As a last resort it need only keep off the other markers, as nowhere is nearer its own.
          if (others.some((other) => gapTo(spot.rect, other) < (other.joined || crossing ? CLEAR : Math.max(CLEAR, away + 1)))) continue;
          if (!crossing && crowded(spot.rect, lines)) continue;
          const cost = spot.cost + step * REACH_COST + (crossing ? covered(spot.rect, lines) * CROSSING_COST : 0);
          if (!best || cost < best.cost) best = { ...spot, cost };
        }
      }
      const chosen = best as Spot | null;
      return chosen && { key: ask.key, left: chosen.rect.left, top: chosen.rect.top, align: chosen.align, size: sizeIndex };
    };
    // On a leader, the nearest reach with room wins, and at that reach the fullest size.
    const led = (sizes: (readonly [LabelSize, number])[]): PlacedLabel | null => {
      for (const reach of LEADER_REACHES) {
        for (const [size, sizeIndex] of sizes) {
          let best: (Spot & { leader: Leader }) | null = null;
          for (const spot of spotsAt(ask, size, reach, bounds)) {
            if (gapTo(spot.rect, own) < reach - 0.01 || !free(spot.rect) || crowded(spot.rect, lines)) continue;
            if (others.some((other) => gapTo(spot.rect, other) < CLEAR * 2)) continue;
            const leader = leaderTo(ask, spot.rect);
            const [from, to] = [[leader[0], leader[1]] as const, [leader[2], leader[3]] as const];
            // The line runs to its own label only, through no other marker, label or button.
            if (others.some((other) => !other.joined && lengthInside(grown({ left: other.x, top: other.y, width: 0, height: 0 }, other.radius + 2), from, to) > 0)) continue;
            if (taken.some((area) => lengthInside(grown(area, 2), from, to) > 0) || walls.some((area) => lengthInside(area, from, to) > 0)) continue;
            if (!best || spot.cost < best.cost) best = { ...spot, leader };
          }
          const chosen = best as (Spot & { leader: Leader }) | null;
          if (chosen) return { key: ask.key, left: chosen.rect.left, top: chosen.rect.top, align: chosen.align, size: sizeIndex, leader: chosen.leader };
        }
      }
      return null;
    };
    // With its name first, beside the marker and then on a leader. Only then without its name.
    let found: PlacedLabel | null = null;
    for (const bare of [false, true]) {
      const sizes = ask.sizes.map((size, n) => [size, n] as const).filter(([size]) => Boolean(size.bare) === bare);
      for (const [size, n] of sizes) found ??= beside(size, n, false);
      if (ask.leader && sizes.length > 0) found ??= led(sizes);
    }
    const shortest = ask.sizes.length - 1;
    if (!found && ask.must && shortest >= 0) found = beside(ask.sizes[shortest]!, shortest, true);
    if (!found) continue;
    taken.push({ left: found.left, top: found.top, ...ask.sizes[found.size]! });
    if (found.leader) leaders.push({ points: [[found.leader[0], found.leader[1]], [found.leader[2], found.leader[3]]], half: 1 });
    placed.push(found);
  }
  return placed;
}

// A name set for a label: its lines, and the width of the widest.
export type NameFit = { lines: string[]; width: number };

// Cut to fit `max` with an ellipsis, which never follows a space or a joining mark left hanging.
function cut(text: string, max: number, measure: (text: string) => number) {
  const at = (length: number) => `${text.slice(0, length).replace(/[\s&/,(-]+$/, '')}…`;
  let [low, high] = [1, text.length];
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measure(at(middle)) <= max) low = middle;
    else high = middle - 1;
  }
  return at(low);
}
// A last line of one word this short reads as left behind.
const ORPHAN = 3;

// Sets a stop's name in at most `maxLines` lines no wider than `max`. A name too long for that
// always ends in an ellipsis, as its row under the map has all of it. Two lines break where they
// come out most alike in width. Where the only break would leave a short word alone on the last
// line, the name takes one line instead, when it fits in `wide`.
export function fitName(name: string, max: number, wide: number, maxLines: 1 | 2, measure: (text: string) => number): NameFit {
  const fit = (lines: string[]): NameFit => ({ lines, width: Math.max(...lines.map(measure)) });
  const whole = measure(name);
  if (whole <= max) return fit([name]);
  if (maxLines === 1) return fit([cut(name, max, measure)]);
  const words = name.split(' ');
  let best: NameFit | null = null;
  let firstTakes = 0;
  for (let n = 1; n < words.length; n++) {
    const [first, second] = [words.slice(0, n).join(' '), words.slice(n).join(' ')];
    const [a, b] = [measure(first), measure(second)];
    if (a > max) break;
    firstTakes = n;
    if (b <= max && (!best || Math.max(a, b) < best.width)) best = { lines: [first, second], width: Math.max(a, b) };
  }
  if (best) {
    const last = best.lines[1]!;
    return !last.includes(' ') && last.length <= ORPHAN && whole <= wide ? fit([name]) : best;
  }
  // No break fits both lines. One long word is cut on a single line. Otherwise the first line
  // takes all the words it can, and the rest is cut.
  if (firstTakes === 0) return fit([cut(name, max, measure)]);
  return fit([words.slice(0, firstTakes).join(' '), cut(words.slice(firstTakes).join(' '), max, measure)]);
}
