import { distanceMeters } from '../geo.ts';
import type { Schedule, StopRow } from '../schedule.ts';

// Short corner names, such as "26th & De Haro" for "26th St & De Haro St", for a line that would
// otherwise wrap (J, 2026-10-13). A short name is given only where it cannot be read as another
// stop's.

// The street types a short name drops, each with the abbreviation it stands for. Minor types
// (Ln, Ct, Pl, Ter, Cir) are kept, as such a street is often named for a bigger one nearby, and
// "Dolores Ter" would read as Dolores St. So are types that are part of the name, such as
// "Great Hwy" and "Lincoln Way".
const DROPPED_TYPES: Record<string, string> = {
  St: 'St',
  Street: 'St',
  Ave: 'Ave',
  'Ave.': 'Ave',
  Avenue: 'Ave',
  Blvd: 'Blvd',
  Boulevard: 'Blvd',
  Dr: 'Dr',
  Drive: 'Dr',
  Rd: 'Rd',
  Road: 'Rd',
};

// Two stops nearer than this that read alike once shortened are one corner the agencies spelled
// two ways, such as "Masonic St" and "Masonic Ave". Farther apart, they are different corners,
// such as SamTrans's two El Camino Real & Oak stops, 5 km apart.
const SAME_CORNER_METERS = 200;

type Street = { name: string; type: string | null };

// A street's name, and its type when a short name drops it: "De Haro St" is De Haro, a St.
// "B St" and "East Rd" stay whole, as a lone letter reads as no street at all and a lone compass
// point as a direction.
function splitStreet(street: string): Street {
  const words = street.split(' ');
  const type = DROPPED_TYPES[words.at(-1)!];
  const name = words.slice(0, -1).join(' ');
  const bare = name.replace(/^[NSEW] /, '');
  return type && bare.length > 1 && !/^(North|South|East|West)$/.test(bare) ? { name, type } : { name: street, type: null };
}

// Names that say more than two streets: a landmark after a hyphen or slash ("Edison St-Hillsdale
// Shopping Ctr"), a stop between two corners ("Fremont St btwn Folsom St & Howard St"), or where
// at the corner a stop is ("University Ave Farside", "Pacific Manor School Rear Entrance"). Words
// that also name streets, such as Gate and School ("Golden Gate Ave", "School St"), are left to
// the hyphen, which comes before every landmark that uses them.
const MORE_THAN_STREETS = /[/()-]|\b(btwn|between|farside|nearside|entrance)\b/i;

// The two streets a corner stop is named for, "26th St & De Haro St" or SamTrans's "Broadway at
// Maple St". Null for any other name: stations, addresses, and corners with more said, such as
// "Grant Ave/Chinatown".
function cornerOf(name: string): { streets: [Street, Street]; joint: string } | null {
  // Some names have doubled spaces, or none around the &: "Addison  St", "Potrero Ave&15th St".
  const match = name.trim().replace(/\s+/g, ' ').replace(/ ?& ?/g, ' & ').match(/^(.+?) (&|at) (.+)$/);
  if (!match || MORE_THAN_STREETS.test(name) || match[3]!.includes(' & ')) return null;
  return { streets: [splitStreet(match[1]!), splitStreet(match[3]!)], joint: match[2]! };
}

// Names compared as the same corner whatever order the streets come in, or how a type is spelled.
const cornerKey = (streets: string[]) => streets.map((street) => street.toLowerCase()).sort().join(' & ');

type Named = Pick<StopRow, 'id' | 'name' | 'lat' | 'lon'>;

// Each corner stop's short name, unless a stop more than SAME_CORNER_METERS away is named for
// other streets but would read the same, short or as named. Stops with nothing to drop count too,
// as "Broadway & Charter" elsewhere would be read for "Broadway & Charter St" shortened.
export function shortCornerNames(stops: Iterable<Named>): Map<number, string> {
  const alike = new Map<string, { stop: Named; full: string; short: string | null }[]>();
  for (const stop of stops) {
    const corner = cornerOf(stop.name);
    if (!corner) continue;
    const key = cornerKey(corner.streets.map(({ name }) => name));
    const full = cornerKey(corner.streets.map(({ name, type }) => (type ? `${name} ${type}` : name)));
    const short = corner.streets.some(({ type }) => type) ? corner.streets.map(({ name }) => name).join(` ${corner.joint} `) : null;
    let group = alike.get(key);
    if (!group) alike.set(key, (group = []));
    group.push({ stop, full, short });
  }
  const names = new Map<number, string>();
  for (const group of alike.values()) {
    const clash = group.some((a) => group.some((b) => a.full !== b.full && distanceMeters(a.stop, b.stop) > SAME_CORNER_METERS));
    if (clash) continue;
    for (const { stop, short } of group) if (short) names.set(stop.id, short);
  }
  return names;
}

const cache = new WeakMap<Schedule, Map<number, string>>();

// A stop's short name, worked out for the whole region the first time one is asked for.
export function shortCornerName(schedule: Schedule, stop: StopRow): string | null {
  let names = cache.get(schedule);
  if (!names) cache.set(schedule, (names = shortCornerNames(schedule.stops.values())));
  return names.get(stop.id) ?? null;
}
