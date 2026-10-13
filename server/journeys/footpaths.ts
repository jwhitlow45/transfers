import { walkSeconds } from '../../shared/walk.ts';
import { calibratedMinutes, changeParts, walkBetween } from '../engine/links.ts';
import { DEFAULT_MAX_WALK_METERS, LONGEST_WALK_METERS, STATION_WALK_FACTOR, type WalkSettings } from '../engine/walk.ts';
import { distanceMeters, pointGrid } from '../geo.ts';
import type { Schedule } from '../schedule.ts';
import type { Access } from './raptor.ts';

// Station walks run from entrances, which lie up to about this far from the platforms: 230 m at
// the most in 2026.
const ENTRANCE_METERS = 250;

// A stop's walks to other stops to change vehicles, as every rider shares them, nearest first:
// `reach`, how far each goes against the rider's longest walk, which a station's walks stretch,
// and its time, as the seconds it takes at any pace and the meters walked at the rider's own. In
// typed arrays, as there are close to a million.
export type Footpaths = { stops: Int32Array; reach: Float64Array; seconds: Float64Array; meters: Float64Array };

const found = new WeakMap<Schedule, Map<number, Footpaths>>();

// The stops a rider can walk between to change vehicles, each way, out to the longest walk any
// rider can ask for: the walks, limits and timings a transfer point uses (engine/links.ts), so a
// journey's changes match the transfer results'. Worked out once for each schedule, since it takes
// about a second, too long for a request to wait on.
export function footpathsFor(schedule: Schedule) {
  let paths = found.get(schedule);
  if (!paths) found.set(schedule, (paths = findFootpaths(schedule)));
  return paths;
}

// The walks from a stop that a rider with these settings takes, with the seconds each takes them.
export function walksFor(paths: Footpaths | undefined, { walk = DEFAULT_MAX_WALK_METERS, speed }: WalkSettings): Access[] {
  const walks: Access[] = [];
  if (!paths) return walks;
  for (let index = 0; index < paths.stops.length && paths.reach[index]! <= walk; index++) {
    walks.push({ stop: paths.stops[index]!, seconds: Math.ceil(paths.seconds[index]! + walkSeconds(paths.meters[index]!, speed)) });
  }
  return walks;
}

function findFootpaths(schedule: Schedule) {
  const stops = [...schedule.patternsByStop.keys()].map((id) => schedule.stop(id));
  // A walk between two stations may run from entrances that far from each.
  const furthest = LONGEST_WALK_METERS * STATION_WALK_FACTOR + 2 * ENTRANCE_METERS;
  const around = pointGrid(stops, furthest);
  const paths = new Map<number, Footpaths>();
  for (const stop of stops) {
    const list: { stop: number; reach: number; seconds: number; meters: number }[] = [];
    for (const other of around(stop)) {
      if (other.id === stop.id || distanceMeters(stop, other) > furthest) continue;
      const between = walkBetween(schedule, stop, other);
      // A station's own time between its platforms counts however short a walk the rider takes.
      const reach = between.fixedSeconds !== undefined ? 0 : between.involvesStation ? between.meters / STATION_WALK_FACTOR : between.meters;
      if (reach > LONGEST_WALK_METERS) continue;
      const calibrated = calibratedMinutes(stop, other);
      const { seconds, meters } = calibrated === undefined ? changeParts(between, stop, other) : { seconds: calibrated * 60, meters: 0 };
      list.push({ stop: other.id, reach, seconds, meters });
    }
    if (list.length === 0) continue;
    list.sort((a, b) => a.reach - b.reach);
    const column = (field: 'reach' | 'seconds' | 'meters') => Float64Array.from(list, (path) => path[field]);
    paths.set(stop.id, { stops: Int32Array.from(list, (path) => path.stop), reach: column('reach'), seconds: column('seconds'), meters: column('meters') });
  }
  return paths;
}
