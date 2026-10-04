// The most minutes any time setting allows: the transfer window's ends and hiding departures.
export const MAX_MINUTES = 30;

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
  // Hex without the leading #. The page picks text color for contrast itself.
  color: string | null;
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
  mode: Mode;
  // A shared downtown station, where BART and Muni Metro both stop: ["BA", "SF"].
  serves?: AgencyId[];
  // A BART station's own code ("mont"), for its page on bart.gov.
  bart?: string;
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

// A route named exactly in a search for a stop (From cannot be a route), with the stops it makes
// in riding order, one list per direction. A BART line lists its stations once.
export type RouteStops = {
  route: string;
  directions: { id: number; name: string | null; headsign: string; stops: StopSearchResult[] }[];
};

export type SearchResponse = {
  results: (StopSearchResult | RouteSearchResult)[];
  routes: Record<string, Route>;
  along?: RouteStops[];
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
  // Where this vehicle lets the rider off, when it is not the group's alight stop. A group pools
  // first routes that reach its boarding stop from different stops.
  alight?: string;
  hidden?: HiddenReason;
};

// A departure of the second route from the boarding stop.
export type Departure = {
  trip: string;
  route: string;
  // Where this trip goes, when it is not the group's usual destination (a trip that ends early).
  toward?: string;
  at: number;
  delay: number | null;
  live: boolean;
  canceled?: boolean;
  // When it reaches the rider's destination stop, if they set one.
  destination?: number;
  connections: Connection[];
};

export type Group = {
  // walk: the route already stops at or near From, so there is no first vehicle. alight is then
  // From, and departures have no connections.
  kind?: 'walk';
  // Stop keys: where the rider gets off the first vehicle and boards the second.
  alight: string;
  board: string;
  // One route, except at a BART platform, where every line toward the same direction shares a group.
  routes: string[];
  direction: number | null;
  headsign: string;
  walkMeters: number;
  // Present when connections get off at different stops and some walk farther.
  longestWalkMeters?: number;
  // Every route that can carry the rider from the From stop to `alight`, for route filters.
  firstRoutes: string[];
  // Minutes, after defaults.
  window: { min: number; max: number };
  // When nothing connects in the window: the window with the smallest raise of its maximum that
  // would find a connection. The minimum stays, since it is the time the walk takes.
  widen?: { min: number; max: number };
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
  // Names every stop on a line, as Muni does for one elevator outage, so it is a notice about
  // the line rather than about any stop of the trip.
  lineWide?: boolean;
};

// live: predictions are current. stale: the last fetch failed, so predictions are aging.
// schedule: this agency publishes no predictions, so times are scheduled. down: there is no data.
export type FeedStatus = { agency: AgencyId; state: 'live' | 'stale' | 'schedule' | 'down'; updatedAt: number | null };

// Why a trip found nothing.
//   idle: routes that would work are not running for a while. side says whether it is the
//     routes to transfer to or the routes from From. next is when they start again, within
//     three days.
//   destination: nothing from here reaches the destination.
//   unreachable: no route from From comes within a walk of To.
//   filtered: transfers exist, but the rider's route filters hide them all.
// walkable: the stop the rider named, as To or the destination, is itself a short walk from
// From (`stop`, `meters` away in a straight line).
export type Notice =
  | { kind: 'idle'; side: 'to' | 'from'; next: number | null }
  | { kind: 'destination' }
  | { kind: 'unreachable' }
  | { kind: 'filtered' }
  | { kind: 'walkable'; stop: string; meters: number };

export type TripResponse = {
  notice?: Notice;
  generatedAt: number;
  // When the server last got live data from 511, in unix seconds, or null when it has none.
  // How stale a page is counts from here, so it covers both the server and the rider's link.
  dataAt: number | null;
  // At a shared downtown station, the systems (BART "BA", Muni Metro "SF") that give a
  // transfer within the usual walk. Absent when From or To is not a shared station.
  systems: { from?: AgencyId[]; to?: AgencyId[] };
  from: string;
  to: { stop: string } | { route: string };
  groups: Group[];
  routes: Record<string, Route>;
  stops: Record<string, Stop>;
  alerts: Alert[];
  feeds: FeedStatus[];
};

export type NearbyArrival = { trip: string; route: string; at: number; delay: number | null; live: boolean };

export type NearbyStop = {
  stop: string;
  // One route, except at a BART platform, where every line toward the same direction shares a row.
  routes: string[];
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

// Stops after each transfer point, where the rider might ride the second vehicle to.
export type DestinationsResponse = {
  groups: { board: string; routes: string[]; headsign: string; stops: string[] }[];
  routes: Record<string, Route>;
  stops: Record<string, Stop>;
};

export type NearbyResponse = {
  generatedAt: number;
  dataAt: number | null;
  nearby: NearbyStop[];
  routes: Record<string, Route>;
  stops: Record<string, Stop>;
  schematic: Schematic;
  feeds: FeedStatus[];
};

// One vehicle on its way to the rider's stop, for its live map. Places are whole meters east and
// north of the middle of the picture, as on Nearby's map.
export type TrackResponse = {
  generatedAt: number;
  // When 511 last reported where vehicles are, or for an estimate from predictions, when those
  // arrived. Null when neither has.
  dataAt: number | null;
  route: string;
  headsign: string;
  // The stop the rider is watching, and the trip's stops drawn around it, in order.
  target: string;
  path: { stop: string; x: number; y: number }[];
  // Where in path the rider's stop is, and the stop the vehicle is at or heading to, which is
  // null with no position.
  targetIndex: number;
  nextIndex: number | null;
  // Where in path each requested mark is, in the order asked, or null when the trip does not
  // stop there.
  marks: (number | null)[];
  // The route's line through those stops.
  line: [number, number][];
  // Null before the trip starts. `estimate` marks a vehicle that reports no position, as no BART
  // train or ferry does, placed by when it is due at its stops: from live predictions, or from the
  // schedule when the trip has none.
  vehicle: { x: number; y: number; bearing: number | null; at: number | null; estimate?: 'predicted' | 'scheduled' } | null;
  // Why there is no vehicle, when that is known.
  missing?: 'canceled' | 'not-started' | 'ended';
  // Stops the vehicle makes before the rider's: 0 when the rider's is next. Null with no
  // position, or once it has gone past.
  stopsAway: number | null;
  passed: boolean;
  routes: Record<string, Route>;
  stops: Record<string, Stop>;
};
