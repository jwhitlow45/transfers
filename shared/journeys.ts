import type { AccessOutage, Alert, FeedStatus, Route, Stop } from './api.ts';

// Trips with any number of vehicles, from a stop or where the rider is to a stop (J, 2026-10-12),
// from /api/journeys. Times are unix seconds, as in api.ts.

// Where a trip starts or ends, as a request names it: a stop by its key, or a point on the map by
// "@lat,lon", such as where the phone says the rider is.
export const pointEnd = (lat: number, lon: number) => `@${lat.toFixed(4)},${lon.toFixed(4)}`;

// Where a trip starts or ends, as an answer gives it: a stop, by key, or a point the rider walks
// from or to, with its name.
export type JourneyEnd = { kind: 'stop'; stop: string } | { kind: 'point'; name: string; lat: number; lon: number };

// A walk between two stops by key, or from or to the point the trip starts or ends at (null).
export type WalkLeg = { kind: 'walk'; from: string | null; to: string | null; seconds: number };

// A ride: the trip, where it is boarded and left, and when, live where the feed predicts it.
// `stops` counts the stops it makes on the way, not counting where the rider boards. `toward` is
// where it heads, as every page names a direction. A canceled trip is never planned on.
export type RideLeg = {
  kind: 'ride';
  trip: string;
  route: string;
  toward: string;
  from: string;
  to: string;
  departs: number;
  arrives: number;
  departDelay: number | null;
  arriveDelay: number | null;
  live: boolean;
  stops: number;
};

export type JourneyLeg = WalkLeg | RideLeg;

// `leaves` is when the rider sets off, so as to make the first vehicle without waiting. `rides`
// counts the vehicles, so a trip on foot has none.
export type Journey = { leaves: number; arrives: number; rides: number; legs: JourneyLeg[] };

// Why there are no ways at all, when it is not that nothing runs: no stop is within walking range
// of where the trip starts or ends.
export type JourneysNotice = { kind: 'far'; end: 'from' | 'to' };

// The next few ways from `from` to `to`, soonest first, with the routes, stops, alerts and feeds
// they use, as the transfer results give theirs. `access` is present when the request asks for
// step-free travel or escalator outages, as the transfer results' is: the outages at the stations
// the ways use.
export type JourneysResponse = {
  generatedAt: number;
  dataAt: number | null;
  from: JourneyEnd;
  to: JourneyEnd;
  journeys: Journey[];
  routes: Record<string, Route>;
  stops: Record<string, Stop>;
  alerts: Alert[];
  access?: AccessOutage[];
  notice?: JourneysNotice;
  feeds: FeedStatus[];
};
