import type { PinRequest } from './api.ts';

// A pinned trip on a results request, as the page sends it and the server reads it: the vehicle
// to catch and where it is boarded (p2, pb) and when it was due (pt), then, unless the route is
// already at From, the first vehicle and where the rider leaves it (p1, pa) and when it was due
// there (pf).
export function writePin(params: URLSearchParams, pin: PinRequest) {
  params.set('p2', pin.second.trip);
  params.set('pb', pin.second.board);
  params.set('pt', String(pin.at));
  if (pin.first) {
    params.set('p1', pin.first.trip);
    params.set('pa', pin.first.alight);
    if (pin.first.at !== undefined) params.set('pf', String(pin.first.at));
  }
}

// `number` reads a param as a number, as the server checks one.
export function readPin(params: URLSearchParams, number: (name: string) => number | undefined): PinRequest | undefined {
  const [trip, board, firstTrip, alight] = ['p2', 'pb', 'p1', 'pa'].map((name) => params.get(name));
  const at = number('pt');
  const firstAt = number('pf');
  if (!trip || !board || at === undefined) return undefined;
  const first = firstTrip && alight ? { first: { trip: firstTrip, alight, ...(firstAt !== undefined ? { at: firstAt } : {}) } } : {};
  return { second: { trip, board }, at, ...first };
}
