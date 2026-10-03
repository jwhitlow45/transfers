// The JSON the server sends. Times are unix seconds and delays are seconds, so the browser keeps
// countdowns ticking between refreshes. Routes and stops appear once in lookup tables and are
// referenced by key elsewhere, which keeps each refresh small.

export type AgencyId = 'SF' | 'BA' | 'SM' | 'GG' | 'GF';
export type Mode = 'bus' | 'trolleybus' | 'light-rail' | 'streetcar' | 'cable-car' | 'bart' | 'ferry';

export type Route = {
  // "SF:48"
  key: string;
  agency: AgencyId;
  // "48", or the line color for BART, such as "Yellow"
  name: string;
  longName: string;
  mode: Mode;
  // Hex without the leading #
  color: string | null;
  textColor: string | null;
};

export type Stop = {
  // "SF:13477". A BART station is keyed by the station, such as "BA:901209".
  key: string;
  agency: AgencyId;
  // The number printed on the stop sign, when it has one.
  code: string | null;
  name: string;
  // "Eastbound"
  direction: string | null;
  lat: number;
  lon: number;
  mode: Mode;
};

export type StopSearchResult = Stop & {
  type: 'stop';
  routes: string[];
  // Headsigns of the vehicles that board here, such as "22nd St + Iowa St".
  toward: string[];
};

export type RouteSearchResult = {
  type: 'route';
  route: string;
  directions: { id: number; name: string | null; headsign: string }[];
};

export type SearchResponse = {
  results: (StopSearchResult | RouteSearchResult)[];
  routes: Record<string, Route>;
};

// Why a connection the rider asked to see was filtered out.
//   short: the transfer is under the minimum.
//   long: the transfer is over the maximum.
//   soon: the first vehicle leaves sooner than the rider can reach it.
export type HiddenReason = 'short' | 'long' | 'soon';

// A first vehicle that makes a departure of the second route.
export type Connection = {
  trip: string;
  route: string;
  // At the From stop.
  departs: number;
  departDelay: number | null;
  // Where the rider gets off.
  arrives: number;
  arriveDelay: number | null;
  live: boolean;
  // Whole minutes from arriving to the second vehicle reaching the boarding stop, rounded down.
  transfer: number;
  hidden?: HiddenReason;
};

// A departure of the second route from the boarding stop.
export type Departure = {
  trip: string;
  route: string;
  at: number;
  delay: number | null;
  live: boolean;
  canceled?: boolean;
  // When it reaches the rider's destination stop, if they set one.
  destination?: number;
  connections: Connection[];
};

export type Group = {
  // Stop keys: where the rider gets off the first vehicle and boards the second.
  alight: string;
  board: string;
  // One route, except at a BART platform, where every line toward the same direction shares a group.
  routes: string[];
  direction: number | null;
  headsign: string;
  walkMeters: number;
  // Minutes, after defaults.
  window: { min: number; max: number };
  departures: Departure[];
};

// stop: names a stop in the trip. route: affects a route in the trip as a whole. agency: affects the whole agency.
export type AlertRelevance = 'stop' | 'route' | 'agency';

export type Alert = {
  id: string;
  relevance: AlertRelevance;
  agency: AgencyId;
  header: string;
  description: string | null;
  url: string | null;
  effect: string | null;
  activeUntil: number | null;
  routes: string[];
  stops: string[];
};

// live: predictions are current. stale: the last fetch failed, so predictions are aging.
// schedule: this agency publishes no predictions, so times are scheduled. down: no data.
export type FeedStatus = { agency: AgencyId; state: 'live' | 'stale' | 'schedule' | 'down'; updatedAt: number | null };

export type TripResponse = {
  generatedAt: number;
  from: string;
  to: { stop: string } | { route: string };
  groups: Group[];
  routes: Record<string, Route>;
  stops: Record<string, Stop>;
  alerts: Alert[];
  feeds: FeedStatus[];
};

export type NearbyArrival = { trip: string; at: number; delay: number | null; live: boolean };

export type NearbyStop = {
  stop: string;
  route: string;
  direction: number | null;
  headsign: string;
  meters: number;
  arrivals: NearbyArrival[];
};

// The schematic map: positions in meters east (x) and north (y) of the rider.
export type Schematic = {
  stops: { stop: string; x: number; y: number }[];
  lines: { route: string; points: [number, number][] }[];
};

export type NearbyResponse = {
  generatedAt: number;
  nearby: NearbyStop[];
  routes: Record<string, Route>;
  stops: Record<string, Stop>;
  schematic: Schematic;
  feeds: FeedStatus[];
};
