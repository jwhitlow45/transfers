import { calibratedMinutes, changeSeconds, walkBetween } from '../engine/links.ts';
import { DEFAULT_MAX_WALK_METERS, STATION_WALK_FACTOR, type WalkSettings } from '../engine/walk.ts';
import { pointGrid } from '../geo.ts';
import type { Schedule } from '../schedule.ts';
import type { Access } from './raptor.ts';

// Station walks run from entrances, which lie up to about this far from the platforms: 230 m at
// the most in 2026.
const ENTRANCE_METERS = 250;
// Riders who change their walking speed or longest walk are few, so a few sets of footpaths cover
// everyone at once.
const KEPT_SETTINGS = 4;

const found = new WeakMap<Schedule, Map<string, Map<number, Access[]>>>();

// The stops a rider can walk between to change vehicles, each way, with how long that takes: the
// walks, limits and timings a transfer point uses (engine/links.ts), so a journey's changes match
// the transfer results'. Kept while the schedule is the current one.
export function footpathsFor(schedule: Schedule, settings: WalkSettings = {}) {
  let bySettings = found.get(schedule);
  if (!bySettings) found.set(schedule, (bySettings = new Map()));
  const key = `${settings.walk ?? ''}|${settings.speed ?? ''}`;
  const known = bySettings.get(key);
  if (known) return known;
  const paths = findFootpaths(schedule, settings);
  bySettings.set(key, paths);
  if (bySettings.size > KEPT_SETTINGS) bySettings.delete(bySettings.keys().next().value!);
  return paths;
}

function findFootpaths(schedule: Schedule, { walk = DEFAULT_MAX_WALK_METERS, speed }: WalkSettings) {
  const stops = [...schedule.patternsByStop.keys()].map((id) => schedule.stop(id));
  // A walk between two stations may run from entrances that far from each.
  const around = pointGrid(stops, walk * STATION_WALK_FACTOR + 2 * ENTRANCE_METERS);
  const paths = new Map<number, Access[]>();
  for (const stop of stops) {
    const list: Access[] = [];
    for (const other of around(stop)) {
      if (other.id === stop.id) continue;
      const between = walkBetween(schedule, stop, other);
      if (between.fixedSeconds === undefined && between.meters > (between.involvesStation ? walk * STATION_WALK_FACTOR : walk)) continue;
      const calibrated = calibratedMinutes(stop, other);
      list.push({ stop: other.id, seconds: calibrated === undefined ? Math.ceil(changeSeconds(between, stop, other, speed)) : calibrated * 60 });
    }
    if (list.length > 0) paths.set(stop.id, list);
  }
  return paths;
}
