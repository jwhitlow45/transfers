type Point = { x: number; y: number };

// Where to draw lettered markers so none hides another or the rider. Stops at one corner sit
// closer together than their markers are wide, so overlapping markers are pushed apart. Every
// push follows where the stops really are: two markers part along the line between their stops,
// and the rider, who stays at the origin, pushes a marker out toward its stop's side. So the
// markers keep the stops' arrangement, and none lands across the rider from its stop, which
// would send the rider the wrong way. The map joins each moved marker to where its stop is.
//
// `size` is the distance two markers' centers keep apart along either axis, and `clear` the
// distance a marker's center keeps from the rider along either axis.
export function spread(stops: Point[], size: number, clear: number): Point[] {
  const placed = stops.map(({ x, y }) => ({ x, y }));
  for (let round = 0; round < 100; round++) {
    let moved = false;
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const [a, b] = [placed[i]!, placed[j]!];
        // Two stops at one spot part up and down, in list order.
        const [ux, uy] = direction(stops[j]!.x - stops[i]!.x, stops[j]!.y - stops[i]!.y, [0, 1]);
        const push = exit(b.x - a.x, b.y - a.y, ux, uy, size);
        if (push <= 1e-6) continue;
        moved = true;
        a.x -= (ux * push) / 2;
        a.y -= (uy * push) / 2;
        b.x += (ux * push) / 2;
        b.y += (uy * push) / 2;
      }
      const point = placed[i]!;
      // A stop right where the rider stands goes above them.
      const [ux, uy] = direction(stops[i]!.x, stops[i]!.y, [0, -1]);
      const push = exit(point.x, point.y, ux, uy, clear);
      if (push <= 1e-6) continue;
      moved = true;
      point.x += ux * push;
      point.y += uy * push;
    }
    if (!moved) break;
  }
  return placed;
}

function direction(dx: number, dy: number, otherwise: [number, number]): [number, number] {
  const length = Math.hypot(dx, dy);
  return length > 1e-9 ? [dx / length, dy / length] : otherwise;
}

// How far to move a point at (dx, dy) along (ux, uy) for it to leave the square of half-width
// `gap` around the origin, or 0 when it is outside already.
function exit(dx: number, dy: number, ux: number, uy: number, gap: number) {
  if (Math.abs(dx) >= gap || Math.abs(dy) >= gap) return 0;
  const along = (d: number, u: number) => (u === 0 ? Infinity : (Math.sign(u) * gap - d) / u);
  return Math.min(along(dx, ux), along(dy, uy));
}
