import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import type { PinnedTrip, TripResponse } from '../../../shared/api.ts';
import { pinnedEnd, pinnedFor, pinnedPhase, pinnedTransfer } from './pinned.ts';

// BART from Montgomery at 8:00, off at 24th St at 8:08, then the 48 there at 8:17 to Potrero at 8:27.
const trip: PinnedTrip = {
  first: { trip: 'BA:b3', route: 'BA:Yellow', on: { stop: 'BA:901209', at: 800, delay: 0 }, off: { stop: 'BA:901609', at: 808, delay: 0 }, live: true },
  second: { trip: 'SF:m3', route: 'SF:48', on: { stop: 'SF:13477', at: 817, delay: null }, off: { stop: 'SF:13500', at: 827, delay: null }, live: false },
};
const minutes = (pinned: PinnedTrip) => ({ ...pinned, first: { ...pinned.first!, on: { ...pinned.first!.on!, at: 800 * 60 }, off: { ...pinned.first!.off!, at: 808 * 60 } }, second: { ...pinned.second!, on: { ...pinned.second!.on!, at: 817 * 60 }, off: pinned.second!.off && { ...pinned.second!.off, at: 827 * 60 } } });

test('a pinned trip goes from waiting, to riding, to changing, to riding again, to done', () => {
  deepStrictEqual(
    [799, 800, 807, 808, 816, 817, 826, 827].map((at) => pinnedPhase(trip, at)),
    ['wait', 'ride', 'ride', 'change', 'change', 'ride-second', 'ride-second', 'done'],
  );
});

test('a pinned trip with no destination ends once the second vehicle leaves, and one with no first vehicle starts by waiting for the second', () => {
  const noDestination = { ...trip, second: { ...trip.second!, off: null } };
  strictEqual(pinnedPhase(noDestination, 817), 'done');
  strictEqual(pinnedEnd(noDestination), 817);
  strictEqual(pinnedEnd(trip), 827);
  strictEqual(pinnedPhase({ second: trip.second }, 700), 'change');
});

test('a pinned transfer counts whole minutes and goes negative once missed', () => {
  strictEqual(pinnedTransfer(minutes(trip)), 9);
  const late = minutes(trip);
  late.first!.off!.at = 818 * 60;
  strictEqual(pinnedTransfer(late), -1);
  strictEqual(pinnedTransfer({ second: trip.second }), null);
});

test('until the answer for a new pin arrives, the results it was pinned from stand in', () => {
  const data = {
    from: 'BA:901209',
    groups: [
      {
        alight: 'BA:901609',
        board: 'SF:13477',
        departures: [
          {
            trip: 'SF:m3',
            route: 'SF:48',
            at: 817,
            delay: 60,
            live: true,
            destination: 827,
            connections: [{ trip: 'BA:b3', route: 'BA:Yellow', departs: 800, departDelay: 0, arrives: 808, arriveDelay: 0, live: true, transfer: 9 }],
          },
        ],
      },
    ],
  } as unknown as TripResponse;
  const pin = { first: { trip: 'BA:b3', alight: 'BA:901609' }, second: { trip: 'SF:m3', board: 'SF:13477' }, at: 817, ends: 827 };
  deepStrictEqual(pinnedFor(pin, data, 'SF:13500'), {
    first: { trip: 'BA:b3', route: 'BA:Yellow', on: { stop: 'BA:901209', at: 800, delay: 0 }, off: { stop: 'BA:901609', at: 808, delay: 0 }, live: true },
    second: { trip: 'SF:m3', route: 'SF:48', on: { stop: 'SF:13477', at: 817, delay: 60 }, off: { stop: 'SF:13500', at: 827, delay: null }, live: true },
  });
  // The server's answer wins once it is for this pin.
  strictEqual(pinnedFor(pin, { ...data, pinned: trip }, 'SF:13500'), trip);
  // An answer for a pin since replaced does not.
  strictEqual(pinnedFor({ ...pin, second: { ...pin.second, trip: 'SF:m4' } }, { ...data, pinned: trip }, undefined), null);
});
