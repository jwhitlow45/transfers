import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { type FeedObject, decodeFeed, encodeFeed } from './feed.ts';
import { buildTripSnapshot, buildVehicleSnapshot, tripKey, withinADay } from './snapshot.ts';

test('a delay a whole day off, as 511 sends for trips after midnight, is taken back to the real one', () => {
  deepStrictEqual([86_478, -86_340, 120, -45, 0].map(withinADay), [78, 60, 120, -45, 0]);
  // The 1 due at 12:27 AM, as the feed sent it, through the real encoder and decoder.
  const at = 1_791_097_627;
  const feed: FeedObject = {
    header: { gtfsRealtimeVersion: '2.0', timestamp: at - 3000 },
    entity: [{ id: '1', tripUpdate: { trip: { tripId: 'SF:12103527', routeId: 'SF:1' }, stopTimeUpdate: [{ stopId: '16294', arrival: { time: at, delay: 86_478 } }] } }],
  };
  const snapshot = buildTripSnapshot(decodeFeed(encodeFeed(feed)), at - 3000, new Set(['SF']));
  deepStrictEqual(snapshot.trips.get(tripKey('SF', '12103527'))?.stops[0], { stopId: '16294', time: at, delay: 78, skipped: false });
});

test('vehicle positions are kept by trip for the agencies asked for, with a standing bearing of 0 left out', () => {
  const at = 1_791_100_000;
  const position = { latitude: 37.78, longitude: -122.41 };
  const feed: FeedObject = {
    header: { gtfsRealtimeVersion: '2.0', timestamp: at },
    entity: [
      { id: '1', vehicle: { trip: { tripId: 'SF:1' }, position: { ...position, bearing: 0 }, stopId: '15405', currentStopSequence: 7, timestamp: at - 20 } },
      { id: '2', vehicle: { trip: { tripId: 'GG:2' }, position: { ...position, bearing: 270 } } },
      // Not asked for, deleted, or with no position: all left out.
      { id: '3', vehicle: { trip: { tripId: 'AC:3' }, position } },
      { id: '4', isDeleted: true, vehicle: { trip: { tripId: 'SF:4' }, position } },
      { id: '5', vehicle: { trip: { tripId: 'SF:5' } } },
    ],
  };
  const snapshot = buildVehicleSnapshot(decodeFeed(encodeFeed(feed)), at, new Set(['SF', 'GG']));
  deepStrictEqual([...snapshot.byTrip.keys()], ['SF:1', 'GG:2']);
  const [sf, gg] = [snapshot.byTrip.get('SF:1')!, snapshot.byTrip.get('GG:2')!];
  deepStrictEqual([sf.bearing, sf.stopId, sf.sequence, sf.at], [null, '15405', 7, at - 20]);
  deepStrictEqual([gg.bearing, gg.stopId, gg.sequence, gg.at], [270, null, null, null]);
  strictEqual(Math.abs(sf.lat - 37.78) < 1e-5 && Math.abs(sf.lon + 122.41) < 1e-5, true);
});
