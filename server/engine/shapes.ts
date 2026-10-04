import { get } from '../db.ts';
import { decodePolyline, type Point } from '../geo.ts';
import type { Schedule } from '../schedule.ts';

const shapeCache = new WeakMap<Schedule, Map<number, Point[]>>();

// A shape's points, decoded once per schedule.
export function shapePoints(schedule: Schedule, shape: number): Point[] {
  let cache = shapeCache.get(schedule);
  if (!cache) shapeCache.set(schedule, (cache = new Map()));
  let points = cache.get(shape);
  if (!points) {
    const row = get<{ polyline: string }>(schedule.db, 'SELECT polyline FROM shapes WHERE id = ?', shape);
    points = row ? decodePolyline(row.polyline) : [];
    cache.set(shape, points);
  }
  return points;
}

// Places as whole meters east and north of a center, the way the maps draw them.
export function projector(center: Point) {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = 111_320 * Math.cos((center.lat * Math.PI) / 180);
  return (point: Point): [number, number] => [Math.round((point.lon - center.lon) * metersPerDegreeLon), Math.round((point.lat - center.lat) * metersPerDegreeLat)];
}
