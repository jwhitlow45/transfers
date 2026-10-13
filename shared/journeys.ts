import type { AccessOutage, Alert, FeedStatus, Route, Stop } from './api.ts';

// Trips with any number of vehicles between two stops, from /api/journeys, which the transfer
// results fall back on when no way to a stop takes one change or none (J, 2026-10-12). Times are
// unix seconds, as in api.ts.

// A walk between two stops, by key.
export type WalkLeg = { kind: 'walk'; from: string; to: string; seconds: number };

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

// The next few ways from `from` to `to`, soonest first, with the routes, stops, alerts and feeds
// they use, as the transfer results give theirs. `access` holds the outages at the stations the
// ways use, present unless the rider turned both elevator and escalator outages off, as the
// transfer results' is.
export type JourneysResponse = {
  generatedAt: number;
  dataAt: number | null;
  from: string;
  to: string;
  journeys: Journey[];
  routes: Record<string, Route>;
  stops: Record<string, Stop>;
  alerts: Alert[];
  access?: AccessOutage[];
  feeds: FeedStatus[];
};
