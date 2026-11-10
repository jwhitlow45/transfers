// Where the live map's labels go. Everything here is in screen pixels from the map's top left
// corner, so the text can be HTML over the map, sized by the rider's text size, and still keep
// clear of the drawing under it.

export type Rect = { left: number; top: number; width: number; height: number };
// A label to place beside the marker it names: the marker's middle and radius, and the label's
// measured size.
export type LabelAsk = { key: string; x: number; y: number; radius: number; width: number; height: number };
// `align` is the side of the label its marker is on, for setting its lines toward the marker.
export type PlacedLabel = { key: string; left: number; top: number; align: 'start' | 'center' | 'end' };

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
// How much further from its marker a label may sit, in pixels, when the spots right beside it
// are taken.
const REACHES = [0, 10, 22];
// What a spot costs. Crossing a line costs most, by the pixel, so a label crosses one only with
// nowhere else to go. Then a spot nearer its marker beats one further off, and a better side a
// worse one.
const CROSSING_COST = 10;
const REACH_COST = 9;
const SIDE_COST = 2;

const overlaps = (a: Rect, b: Rect) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

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

// Places each label beside its marker, in the order given, which is their order of importance: a
// label takes the best side where it stays on the map and off every blocked area (the markers
// and the map's buttons) and every label placed before it, crossing as little of the lines as it
// can. A label with no such side is left out, and the list under the map still names its stop.
export function placeLabels(asks: LabelAsk[], blocked: Rect[], lines: (readonly [number, number])[][], bounds: { width: number; height: number }, gap = 5): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  const taken: Rect[] = [];
  // Inside the map's edge by a little, so no letter touches it.
  const edge = 2;
  for (const ask of asks) {
    let best: { rect: Rect; cost: number; align: PlacedLabel['align'] } | null = null;
    const consider = (rect: Rect, align: PlacedLabel['align'], base: number) => {
      if (rect.left < edge || rect.top < edge || rect.left + rect.width > bounds.width - edge || rect.top + rect.height > bounds.height - edge) return;
      if (blocked.some((area) => overlaps(rect, area)) || taken.some((area) => overlaps(rect, area))) return;
      let crossed = 0;
      for (const line of lines) for (let n = 1; n < line.length; n++) crossed += lengthInside(rect, line[n - 1]!, line[n]!);
      const cost = crossed * CROSSING_COST + base;
      if (!best || cost < best.cost) best = { rect, cost, align };
    };
    SIDES.forEach(({ dx, dy }, order) => {
      REACHES.forEach((further, step) => {
        // On a corner, the label starts from the marker's diagonal, not from its box.
        const reach = (dx !== 0 && dy !== 0 ? ask.radius * 0.7 : ask.radius) + gap + further;
        const top = dy === 0 ? ask.y - ask.height / 2 : dy > 0 ? ask.y + reach : ask.y - reach - ask.height;
        const base = order * SIDE_COST + step * REACH_COST;
        if (dx !== 0) return consider({ left: dx > 0 ? ask.x + reach : ask.x - reach - ask.width, top, width: ask.width, height: ask.height }, dx > 0 ? 'start' : 'end', base);
        // Over or under a marker near the map's side, the label slides in to stay whole. It can
        // also hang from the marker to either side, to clear a line running straight on.
        const slid = Math.min(bounds.width - edge - ask.width, Math.max(edge, ask.x - ask.width / 2));
        consider({ left: slid, top, width: ask.width, height: ask.height }, 'center', base);
        consider({ left: ask.x - ask.radius, top, width: ask.width, height: ask.height }, 'start', base + 1);
        consider({ left: ask.x + ask.radius - ask.width, top, width: ask.width, height: ask.height }, 'end', base + 1);
      });
    });
    const chosen = best as { rect: Rect; cost: number; align: PlacedLabel['align'] } | null;
    if (!chosen) continue;
    taken.push(chosen.rect);
    placed.push({ key: ask.key, left: chosen.rect.left, top: chosen.rect.top, align: chosen.align });
  }
  return placed;
}
