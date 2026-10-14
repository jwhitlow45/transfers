import type { Connection, Departure, HiddenReason } from '../../shared/api.ts';

// A first-leg vehicle: when it leaves the From stop and reaches the stop where the rider gets off.
export type FirstLeg = {
  trip: string;
  route: string;
  // The stop key where this vehicle lets the rider off. Pooled groups get off at different stops.
  alight?: string;
  // The stop key where it picks the rider up: From, or going to a stop, one on From's corner.
  board?: string;
  departs: number;
  departDelay: number | null;
  arrives: number;
  arriveDelay: number | null;
  live: boolean;
  // A live vehicle whose arrival is the schedule's time alone (see Connection).
  arrivesScheduled?: true;
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
  // A live vehicle whose time at the destination is the schedule's alone (see Departure).
  destinationScheduled?: true;
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
  // Going to a stop: pair each first vehicle with the departure in its window that gets there
  // soonest, which past a pooled local can be a later express.
  soonestThere?: boolean;
  // Going to a stop, the minutes to walk from From to each other stop a first vehicle may pick
  // the rider up at, by stop key, such as across the street, which `hide` comes on top of.
  boardWalk?: ReadonlyMap<string, number>;
};

// Whole minutes rounded down, the same number the rider sees, so a 2:59 wait is "2 min" and
// fails a 3 minute rule.
export const minutesBetween = (from: number, to: number) => Math.floor((to - from) / 60);

// Pairs each first vehicle with the first departure it can make (a later departure is never a
// better match for the same vehicle, unless it gets to a stop the rider is going to sooner, as an
// express does past a local; see soonestThere), keeps the first `count` departures that have a qualifying
// connection, and lists every first vehicle that makes each one. Vehicles and departures that do
// not qualify are dropped before choosing those departures, so they never take a spot.
export function pairConnections(firstLegs: FirstLeg[], secondLegs: SecondLeg[], options: PairingOptions): Departure[] {
  const { now, min, max, hide, count, showHidden } = options;
  const departures = secondLegs.filter(({ canceled }) => !canceled).sort((a, b) => a.at - b.at);
  const qualifying: { departure: SecondLeg; connection: Connection }[] = [];
  const hidden: { departure: SecondLeg; connection: Connection }[] = [];

  for (const vehicle of [...firstLegs].sort((a, b) => a.departs - b.departs)) {
    const minutesAway = minutesBetween(now, vehicle.departs);
    if (vehicle.canceled) continue;
    // A vehicle that has left is one the rider may be on, so it is never too soon.
    const left = vehicle.departs < now;
    const base = {
      trip: vehicle.trip,
      route: vehicle.route,
      departs: vehicle.departs,
      departDelay: vehicle.departDelay,
      arrives: vehicle.arrives,
      arriveDelay: vehicle.arriveDelay,
      live: vehicle.live,
      ...(vehicle.arrivesScheduled ? { arrivesScheduled: true as const } : {}),
      ...(vehicle.alight ? { alight: vehicle.alight } : {}),
      ...(vehicle.board ? { board: vehicle.board } : {}),
    };
    const connect = (departure: SecondLeg, reason?: HiddenReason) => {
      const connection: Connection = { ...base, transfer: minutesBetween(vehicle.arrives, departure.at) };
      if (reason) connection.hidden = reason;
      return { departure, connection };
    };

    const firstIndex = departures.findIndex(({ at }) => minutesBetween(vehicle.arrives, at) >= min);
    let first = departures[firstIndex];
    if (first && options.soonestThere) {
      const there = (departure: SecondLeg) => departure.destination ?? Infinity;
      for (const later of departures.slice(firstIndex + 1)) {
        if (minutesBetween(vehicle.arrives, later.at) > max) break;
        if (there(later) < there(first)) first = later;
      }
    }
    const tooSoon = !left && minutesAway < hide + (options.boardWalk?.get(vehicle.board ?? '') ?? 0);
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
  // A pair whose first vehicle has left is under way: the rider may be on it. It stays while the
  // second vehicle has yet to leave, or with a destination, to get there.
  const underWay = ({ connection }: (typeof qualifying)[number]) => connection.departs < now;
  const ongoing = ({ departure }: (typeof qualifying)[number]) => departure.at >= now || (departure.destination ?? -Infinity) >= now;
  const kept = (pairs: typeof qualifying) => pairs.filter((pair) => !underWay(pair) || ongoing(pair));
  const ahead = (pairs: typeof qualifying) => [...new Set(pairs.filter((pair) => !underWay(pair)).map(({ departure }) => departure))].sort(byTime);
  // The count is of departures the rider can still catch from From. Those under way come on top.
  let shown = ahead(qualifying).slice(0, count);
  const pairs = kept(showHidden ? [...qualifying, ...hidden] : qualifying);
  if (showHidden) {
    const hiddenDepartures = ahead(hidden);
    // Hidden connections appear in place among the departures already shown, or fill the list
    // when nothing qualifies.
    const last = shown.at(-1)?.at;
    const extra = last === undefined ? hiddenDepartures.slice(0, count) : hiddenDepartures.filter(({ at }) => at <= last);
    shown = [...new Set([...shown, ...extra])].sort(byTime);
  }
  // A canceled departure among those the rider can catch is worth knowing about, even with no
  // connections.
  const first = shown[0]?.at;
  const last = shown.at(-1)?.at;
  if (first !== undefined && last !== undefined) {
    shown = [...shown, ...secondLegs.filter(({ canceled, at }) => canceled && at >= first && at <= last)];
  }
  shown = [...new Set([...shown, ...pairs.filter(underWay).map(({ departure }) => departure)])].sort(byTime);

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
    if (departure.destination !== undefined && departure.destination > departure.at) {
      result.destination = departure.destination;
      if (departure.destinationScheduled) result.destinationScheduled = true;
    }
    return result;
  });
}
