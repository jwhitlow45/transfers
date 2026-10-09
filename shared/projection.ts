// Places as meters east and north of a center, the way the maps draw them: the server places
// stops and vehicles, and the page the rider, from the same center.
export function metersFrom(center: { lat: number; lon: number }, point: { lat: number; lon: number }): [number, number] {
  const metersPerDegree = 111_320;
  return [(point.lon - center.lon) * metersPerDegree * Math.cos((center.lat * Math.PI) / 180), (point.lat - center.lat) * metersPerDegree];
}
