import type { Connection, Departure, HiddenReason } from '../../shared/api.ts';

// A first-leg vehicle: when it leaves the From stop and reaches the stop where the rider gets off.
export type FirstLeg = {
  trip: string;
  route: string;
  // The stop key where this vehicle lets the rider off. Pooled groups get off at different stops.
  alight?: string;
  departs: number;
  departDelay: number | null;
  arrives: number;
  arriveDelay: number | null;
  live: boolean;
  canceled: boolean;
};

// A second-leg vehicle reaching the boarding stop.
export type SecondLeg = {
  trip: string;
  route: string;
  toward?: string;
  at: number;
  delay: number | null;
  live: boolean;
  canceled: boolean;
  destination?: number;
};

export type PairingOptions = {
  now: number;
  // Minutes.
  min: number;
  max: number;
  // Hide first vehicles leaving sooner than this many minutes.
  hide: number;
  // How many second-leg departures to show.
  count: number;
  showHidden: boolean;
};

// Whole minutes rounded down, the same number the rider sees, so a 2:59 wait is "2 min" and
// fails a 3 minute rule.
export const minutesBetween = (from: number, to: number) => Math.floor((to - from) / 60);

// Pairs each first vehicle with the first departure it can make (a later departure is never a
// better match for the same vehicle), keeps the first `count` departures that have a qualifying
// connection, and lists every first vehicle that makes each one. Vehicles and departures that do
// not qualify are dropped before choosing those departures, so they never take a spot.
export function pairConnections(firstLegs: FirstLeg[], secondLegs: SecondLeg[], options: PairingOptions): Departure[] {
  const { now, min, max, hide, count, showHidden } = options;
  const departures = secondLegs.filter(({ canceled }) => !canceled).sort((a, b) => a.at - b.at);
  const qualifying: { departure: SecondLeg; connection: Connection }[] = [];
  const hidden: { departure: SecondLeg; connection: Connection }[] = [];

  for (const vehicle of [...firstLegs].sort((a, b) => a.departs - b.departs)) {
    const minutesAway = minutesBetween(now, vehicle.departs);
    if (vehicle.canceled || minutesAway < 0) continue;
    const base = {
      trip: vehicle.trip,
      route: vehicle.route,
      departs: vehicle.departs,
      departDelay: vehicle.departDelay,
      arrives: vehicle.arrives,
      arriveDelay: vehicle.arriveDelay,
      live: vehicle.live,
      ...(vehicle.alight ? { alight: vehicle.alight } : {}),
    };
    const connect = (departure: SecondLeg, reason?: HiddenReason) => {
      const connection: Connection = { ...base, transfer: minutesBetween(vehicle.arrives, departure.at) };
      if (reason) connection.hidden = reason;
      return { departure, connection };
    };

    const firstIndex = departures.findIndex(({ at }) => minutesBetween(vehicle.arrives, at) >= min);
    const first = departures[firstIndex];
    const tooSoon = minutesAway < hide;
    if (first) {
      const transfer = minutesBetween(vehicle.arrives, first.at);
      if (tooSoon) hidden.push(connect(first, 'soon'));
      else if (transfer > max) hidden.push(connect(first, 'long'));
      else qualifying.push(connect(first));
    }
    // The departure just before the first one it can make, reached with less than the minimum.
    const previous = firstIndex === -1 ? departures.at(-1) : departures[firstIndex - 1];
    if (!tooSoon && previous && minutesBetween(vehicle.arrives, previous.at) >= 0) hidden.push(connect(previous, 'short'));
  }

  const byTime = (a: SecondLeg, b: SecondLeg) => a.at - b.at;
  let shown = [...new Set(qualifying.map(({ departure }) => departure))].sort(byTime).slice(0, count);
  const pairs = showHidden ? [...qualifying, ...hidden] : qualifying;
  if (showHidden) {
    const hiddenDepartures = [...new Set(hidden.map(({ departure }) => departure))].sort(byTime);
    // Hidden connections appear in place among the departures already shown, or fill the list
    // when nothing qualifies.
    const last = shown.at(-1)?.at;
    const extra = last === undefined ? hiddenDepartures.slice(0, count) : hiddenDepartures.filter(({ at }) => at <= last);
    shown = [...new Set([...shown, ...extra])].sort(byTime);
  }
  // A canceled departure among those shown is worth knowing about, even with no connections.
  const first = shown[0]?.at;
  const last = shown.at(-1)?.at;
  if (first !== undefined && last !== undefined) {
    shown = [...shown, ...secondLegs.filter(({ canceled, at }) => canceled && at >= first && at <= last)].sort(byTime);
  }

  return shown.map((departure) => {
    const result: Departure = {
      trip: departure.trip,
      route: departure.route,
      ...(departure.toward ? { toward: departure.toward } : {}),
      at: departure.at,
      delay: departure.delay,
      live: departure.live,
      connections: pairs
        .filter((pair) => pair.departure === departure)
        .map(({ connection }) => connection)
        .sort((a, b) => a.departs - b.departs || a.arrives - b.arrives),
    };
    if (departure.canceled) result.canceled = true;
    if (departure.destination !== undefined && departure.destination > departure.at) result.destination = departure.destination;
    return result;
  });
}
