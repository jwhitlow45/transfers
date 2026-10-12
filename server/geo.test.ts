import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { bearingDegrees, compassLabel, decodePolyline, distanceMeters, encodePolyline, meanBearing, pointGrid } from './geo.ts';

test('distance between 24th St Mission and Muni stop 13477', () => {
  const meters = distanceMeters({ lat: 37.75194137, lon: -122.4188268 }, { lat: 37.752178, lon: -122.41855 });
  ok(Math.abs(meters - 36) < 1, `got ${meters}`);
});

test('a point grid finds every point within its distance, wherever the cells fall', () => {
  // Points every 50 m or so east and north of the Mission, and some checked against them all.
  const points = Array.from({ length: 400 }, (_, n) => ({ lat: 37.75 + Math.floor(n / 20) * 0.00045, lon: -122.42 + (n % 20) * 0.00057 }));
  const around = pointGrid(points, 300);
  for (const at of [points[0]!, points[210]!, { lat: 37.7531, lon: -122.4123 }, { lat: 37.749, lon: -122.421 }]) {
    const within = (list: typeof points) => new Set(list.filter((point) => distanceMeters(point, at) <= 300));
    deepStrictEqual(within(around(at)), within(points));
  }
});

test('bearings and compass labels', () => {
  strictEqual(compassLabel(bearingDegrees({ lat: 37.75, lon: -122.42 }, { lat: 37.75, lon: -122.41 })), 'Eastbound');
  strictEqual(compassLabel(358), 'Northbound');
  const mean = meanBearing([{ degrees: 350, weight: 1 }, { degrees: 10, weight: 1 }]);
  ok(mean !== null && (mean < 0.001 || mean > 359.999), `got ${mean}`);
});

test('polyline round trip', () => {
  // The example from Google's documentation.
  const points = [{ lat: 38.5, lon: -120.2 }, { lat: 40.7, lon: -120.95 }, { lat: 43.252, lon: -126.453 }];
  strictEqual(encodePolyline(points), '_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  deepStrictEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), points);
});
