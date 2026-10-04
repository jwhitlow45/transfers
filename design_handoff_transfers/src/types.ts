export type Agency = 'BART' | 'Muni' | 'Muni Metro' | 'SamTrans' | 'Golden Gate Transit' | 'Golden Gate Ferry';

/** Minutes since local midnight, Pacific time. */
export type Minutes = number;

export interface Stop {
  id: string;
  name: string;              // "24th St & Mission St"
  agency: Agency;
  code?: string;             // pole number, e.g. "13477"; stations have none
  direction: string;         // "Eastbound, toward 22nd St & Iowa St"
  routes: RouteRef[];
}

export interface RouteRef {
  label: string;             // "48", "J", "BART"
  agency: Agency;
  color: string;             // hex
}

export interface RouteResult {
  id: string;
  name: string;              // "22 Fillmore"
  agency: Agency;
  description: string;       // "Route · Fillmore ↔ UCSF Mission Bay"
  route: RouteRef;
}

/** A first-leg vehicle (train or bus) leaving the From stop. */
export interface FirstVehicle {
  id: string;
  agency: Agency;
  line: string;              // BART line color name ("Yellow") or route ("19 Polk")
  color: string;
  headsign: string;          // "SFO"
  scheduled: Minutes;
  delay: number | null;      // minutes; null = no delay data
  rideMinutes: number;       // From stop → alight stop
}

/** A second-leg departure at the transfer stop. */
export interface SecondDeparture {
  scheduled: Minutes;
  delay?: number | null;
  scheduledOnly?: boolean;   // beyond the live prediction horizon, or feed down
  canceled?: boolean;
}

export interface TransferPoint {
  id: string;
  kicker?: string;           // "Transfer point 1 of 2" when To is a route
  route: RouteRef;
  stop: string;
  code: string;
  toward: string;
  destRideMinutes: number;   // transfer stop → destination stop (0 if none)
  departures: SecondDeparture[];
}

export type AlertSeverity = 'severe' | 'warning' | 'info';
export interface ServiceAlert {
  id: string;
  severity: AlertSeverity;
  kicker: string;            // "Your boarding stop", "Reroute · 22"
  title: string;
  body: string;
  meta: string;
}

export interface Trip {
  id: string;
  name: string;
  fromShort: string;
  via: string;               // worked out by the app
  toLabel: string;
  alightStop: string;
  firstWord: string;         // "train" | "19" — used in empty-state copy
  firsts: FirstVehicle[];
  points: TransferPoint[];
  alerts: ServiceAlert[];
  destinations: { value: string; label: string; short?: string }[];
}

export interface TripSettings {
  minTransfer: number;       // default 3
  maxTransfer: number;       // default 12
  hideUnder: number;         // hide first vehicles arriving at From in < N min
  destination: string;       // 'none' or a destination value
  disabledLines: Record<string, boolean>;
  disabledPoints: Record<string, boolean>;
}

export interface SavedSearch { id: string; name: string; tripId: string; settings: TripSettings }
export interface RecentSearch { id: string; label: string; sub: string; tripId: string }

export type FeedState = 'live' | 'refreshing' | 'loading' | 'offline';
export type StatusKind = 'late' | 'early' | 'ontime' | 'nodata' | 'scheduled' | 'canceled';
