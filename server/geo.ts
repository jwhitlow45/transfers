const EARTH_RADIUS_METERS = 6_371_000;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export type Point = { lat: number; lon: number };

export function distanceMeters(a: Point, b: Point) {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

// Points by grid cell, for finding those within `meters` of somewhere without measuring to every
// one: they are all in its own cell or the eight around it, as each cell is at least `meters`
// across. A degree of longitude shortens away from the equator, so cells are sized for the
// longitude of the point furthest from it.
export function pointGrid<T extends Point>(points: T[], meters: number) {
  const furthest = Math.max(0, ...points.map(({ lat }) => Math.abs(lat)));
  const size = meters / (((EARTH_RADIUS_METERS * Math.PI) / 180) * Math.cos(toRadians(furthest)));
  const cell = (value: number) => Math.floor(value / size);
  const cells = new Map<string, T[]>();
  for (const point of points) {
    const key = `${cell(point.lat)}:${cell(point.lon)}`;
    let list = cells.get(key);
    if (!list) cells.set(key, (list = []));
    list.push(point);
  }
  // Every point within `meters` of `at`, among others a little further.
  return (at: Point) => {
    const found: T[] = [];
    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLon = -1; dLon <= 1; dLon++) found.push(...(cells.get(`${cell(at.lat) + dLat}:${cell(at.lon) + dLon}`) ?? []));
    }
    return found;
  };
}

// Initial compass bearing from a to b, 0 to 360 with 0 as north.
export function bearingDegrees(a: Point, b: Point) {
  const dLon = toRadians(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(toRadians(b.lat));
  const x = Math.cos(toRadians(a.lat)) * Math.sin(toRadians(b.lat)) - Math.sin(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Averages bearings as unit vectors, so 350 and 10 average to 0 and not 180.
export function meanBearing(bearings: { degrees: number; weight: number }[]) {
  let x = 0;
  let y = 0;
  for (const { degrees, weight } of bearings) {
    x += Math.cos(toRadians(degrees)) * weight;
    y += Math.sin(toRadians(degrees)) * weight;
  }
  if (x === 0 && y === 0) return null;
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const COMPASS = ['Northbound', 'Northeastbound', 'Eastbound', 'Southeastbound', 'Southbound', 'Southwestbound', 'Westbound', 'Northwestbound'];

export function compassLabel(degrees: number) {
  return COMPASS[Math.round(degrees / 45) % 8] ?? null;
}

// Google's encoded polyline format at 5 decimal places: about a meter of precision in a few
// bytes per point, which keeps stored route shapes small.
export function encodePolyline(points: Point[]) {
  let output = '';
  let lastLat = 0;
  let lastLon = 0;
  for (const { lat, lon } of points) {
    const latE5 = Math.round(lat * 1e5);
    const lonE5 = Math.round(lon * 1e5);
    output += encodeSigned(latE5 - lastLat) + encodeSigned(lonE5 - lastLon);
    lastLat = latE5;
    lastLon = lonE5;
  }
  return output;
}

function encodeSigned(value: number) {
  let remaining = value < 0 ? ~(value << 1) : value << 1;
  let output = '';
  while (remaining >= 0x20) {
    output += String.fromCharCode((0x20 | (remaining & 0x1f)) + 63);
    remaining >>= 5;
  }
  return output + String.fromCharCode(remaining + 63);
}

export function decodePolyline(text: string): Point[] {
  const points: Point[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = text.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < text.length) {
    lat += next();
    lon += next();
    points.push({ lat: lat / 1e5, lon: lon / 1e5 });
  }
  return points;
}
