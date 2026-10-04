import { strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { bartStationCode } from './bart-stations.ts';

test('a BART station takes the code of the station within a short walk, and a place far from one has none', () => {
  // Montgomery Street's platform in 511's feed, and Civic Center's station point.
  strictEqual(bartStationCode({ lat: 37.789213, lon: -122.401642 }), 'mont');
  strictEqual(bartStationCode({ lat: 37.779732, lon: -122.414123 }), 'civc');
  // Golden Gate Park, nowhere near BART.
  strictEqual(bartStationCode({ lat: 37.7694, lon: -122.4862 }), null);
});
