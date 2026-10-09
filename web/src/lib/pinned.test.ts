import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { clock } from '../format.ts';
import type { Connection, Departure, PinnedTrip, TripResponse } from '../../../shared/api.ts';
import { pinOf, pinToastText, pinnedEnd, pinnedFor, pinnedNow, pinnedPhase, pinnedTransfer, samePin, steadyPinned } from './pinned.ts';

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
  const { ends: _, ...asked } = pin;
  strictEqual(pinnedFor(pin, { ...data, pinned: trip, pin: asked }, 'SF:13500'), trip);
  // An answer for a pin since replaced does not.
  strictEqual(pinnedFor({ ...pin, second: { ...pin.second, trip: 'SF:m4' } }, { ...data, pinned: trip, pin: asked }, undefined), null);
});

test("an answer for the same vehicles on another day's run, or at another stop, is not this pin's, however little of the trip it knows", () => {
  const pin = { first: { trip: 'BA:b3', alight: 'BA:901609', at: 808 }, second: { trip: 'SF:m3', board: 'SF:13477' }, at: 817, ends: 827 };
  const { ends: _, ...asked } = pin;
  const data = { from: 'BA:901209', groups: [], pinned: trip, pin: asked } as unknown as TripResponse;
  strictEqual(pinnedFor(pin, data, undefined), trip);
  strictEqual(pinnedFor({ ...pin, at: 817 + 86_400 }, data, undefined), null);
  strictEqual(pinnedFor({ ...pin, second: { ...pin.second, board: 'SF:13478' } }, data, undefined), null);
  strictEqual(pinnedFor({ ...pin, first: { ...pin.first, alight: 'BA:901601' } }, data, undefined), null);
  // Feed-only vehicles that have passed the rider's stops leave no times to tell the run by.
  const passed = { ...data, pinned: { first: null, second: { ...trip.second!, on: null } } };
  strictEqual(pinnedFor({ ...pin, at: 817 + 86_400 }, passed, undefined), null);
  // Nor is an answer that names no pin, as from before the server named them.
  strictEqual(pinnedFor(pin, { ...data, pin: undefined }, undefined), null);
  strictEqual(samePin(pin, { ...pin, at: 817 + 86_400 }), false);
  strictEqual(samePin(pin, { ...pin, ends: 900 }), true);
});

test('a pin names each vehicle by when it was scheduled where the rider changes, which stays put as predictions move', () => {
  const departure = { trip: 'SF:m3', route: 'SF:48', at: 1000, delay: 480, live: true, destination: 1600, connections: [] } as unknown as Departure;
  const connection = { trip: 'BA:b3', route: 'BA:Yellow', departs: 400, departDelay: 60, arrives: 900, arriveDelay: 60, live: true, transfer: 1 } as Connection;
  deepStrictEqual(pinOf(departure, 'SF:13477', { connection, alight: 'BA:901609' }), {
    first: { trip: 'BA:b3', alight: 'BA:901609', at: 840 },
    second: { trip: 'SF:m3', board: 'SF:13477' },
    at: 520,
    ends: 1600,
  });
  deepStrictEqual(pinOf({ ...departure, delay: null, destination: undefined }, 'SF:13477'), { second: { trip: 'SF:m3', board: 'SF:13477' }, at: 1000, ends: 1000 });
});

test('a trip the schedule lacks keeps a stop the feed dropped once passed, and its arrival only while it is still the destination', () => {
  const pin = { second: { trip: 'BA:extra', board: 'BA:901201' }, at: 800, ends: 830 };
  const before = { second: { trip: 'BA:extra', route: 'BA:Yellow', on: { stop: 'BA:901201', at: 800, delay: 0 }, off: { stop: 'BA:901601', at: 830, delay: 0 }, live: true, added: true } };
  const boarded = { second: { ...before.second, on: null } };
  deepStrictEqual(steadyPinned(boarded, before, pin, 'BA:901601'), before);
  // A new destination does not take the old one's arrival.
  strictEqual(steadyPinned({ second: { ...boarded.second, off: null } }, before, pin, 'BA:902101').second?.off, null);
  // Gone from the feed once it ends, it stays as last seen.
  deepStrictEqual(steadyPinned({ second: null }, before, pin, 'BA:901601'), before);
  // A scheduled trip's stop the feed says it skips is not filled in.
  const scheduled = { second: { ...before.second, added: undefined } };
  strictEqual(steadyPinned({ second: { ...scheduled.second, on: null } }, scheduled, pin, 'BA:901601').second?.on, null);
});

test('an answer for a trip whose added first vehicle has ended still moves the second, and keeps the first as last seen', () => {
  const pin = { first: { trip: 'BA:extra', alight: 'BA:901609', at: 808 }, second: { trip: 'SF:m3', board: 'SF:13477' }, at: 817, ends: 827 };
  const { ends: _, ...asked } = pin;
  const last = { ...trip, first: { ...trip.first!, trip: 'BA:extra', added: true } };
  const later = { ...trip.second!, off: { ...trip.second!.off!, at: 840 } };
  const data = { from: 'BA:901209', to: { stop: 'SF:13477' }, groups: [], pinned: { first: null, second: later }, pin: asked } as unknown as TripResponse;
  deepStrictEqual(pinnedNow({ ...pin, last }, data, 'SF:13500'), { pinned: { first: last.first, second: later }, fresh: true });
  // A new destination, with both vehicles gone from the feed, does not take the old one's arrival.
  const ended = { ...data, pinned: { first: null, second: null } };
  const lastAdded = { ...last, second: { ...trip.second!, added: true } };
  strictEqual(pinnedNow({ ...pin, last: lastAdded }, ended, 'SF:13600').pinned?.second?.off, null);
});

test("a trip pinned from the results before the server's first answer keeps those times once the feed drops the stop", () => {
  const pin = { second: { trip: 'BA:extra', board: 'BA:901201' }, at: 800, ends: 830 };
  const { ends: _, ...asked } = pin;
  // Taken from the results, which do not say the trip is added.
  const last = { second: { trip: 'BA:extra', route: 'BA:Yellow', on: { stop: 'BA:901201', at: 800, delay: 0 }, off: null, live: true } };
  const boarded = { trip: 'BA:extra', route: 'BA:Yellow', on: null, off: null, live: true, added: true };
  const data = { from: 'BA:901201', to: { route: 'BA:Yellow' }, groups: [], pinned: { second: boarded }, pin: asked } as unknown as TripResponse;
  deepStrictEqual(pinnedNow({ ...pin, last }, data, undefined).pinned?.second?.on, last.second.on);
});

test('pinning says so, and in place of what was pinned before, a trip by its first vehicle and an arrival by its own', () => {
  const routes = { 'BA:Yellow': { key: 'BA:Yellow', agency: 'BA', name: 'Yellow' }, 'SF:48': { key: 'SF:48', agency: 'SF', name: '48' } } as unknown as TripResponse['routes'];
  const pinnedTrip = { second: { trip: 'SF:m3', board: 'SF:13477' }, at: 817, ends: 827, last: trip };
  const arrival = { second: { trip: 'SF:m4', board: 'SF:13477' }, at: 900, ends: 960, arrival: { route: 'SF:48', headsign: 'Potrero' } };
  strictEqual(pinToastText(null, pinnedTrip, routes), 'Pinned to the top');
  strictEqual(pinToastText(pinnedTrip, pinnedTrip, routes), 'Pinned to the top');
  strictEqual(pinToastText(pinnedTrip, null, routes), 'Unpinned');
  strictEqual(pinToastText(pinnedTrip, arrival, routes, true), `Ding ding! Pinned in place of the BART at ${clock(800)}`);
  strictEqual(pinToastText(arrival, pinnedTrip, routes), `Pinned in place of the 48 at ${clock(960)}`);
  // Without the routes, it says what kind of pin it was.
  strictEqual(pinToastText(arrival, pinnedTrip, undefined), 'Pinned in place of the arrival pinned before');
  strictEqual(pinToastText(pinnedTrip, arrival, undefined), 'Pinned in place of the trip pinned before');
});
