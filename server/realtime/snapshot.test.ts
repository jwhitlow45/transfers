import { deepStrictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { type FeedObject, decodeFeed, encodeFeed } from './feed.ts';
import { buildTripSnapshot, tripKey, withinADay } from './snapshot.ts';

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
