import type { FirstVehicle, SecondDeparture, TransferPoint, Trip, TripSettings, Minutes } from '../types';

export interface LiveFirst extends FirstVehicle { departs: Minutes; arrives: Minutes; leaveSec: number }
export interface Connection { first: LiveFirst; transfer: number; tight: boolean }
export interface DepartureCard {
  departure: SecondDeparture;
  time: Minutes;              // predicted (or scheduled if scheduledOnly)
  scheduledOnly: boolean;
  canceled: boolean;
  connections: Connection[];
}
export interface PointResult { point: TransferPoint; cards: DepartureCard[]; widenTo: [number, number] | null }

const MAX_CARDS = 3;

export function liveFirsts(trip: Trip, s: TripSettings, nowSec: number): LiveFirst[] {
  return trip.firsts
    .map(f => { const departs = f.scheduled + (f.delay ?? 0); return { ...f, departs, arrives: departs + f.rideMinutes, leaveSec: departs * 60 - nowSec }; })
    .filter(f => f.leaveSec >= 0 && f.leaveSec / 60 >= s.hideUnder && !s.disabledLines[f.line]);
}

/** Next 3 second-leg departures with ≥1 connecting first vehicle; canceled ones stay in sequence. */
export function cardsFor(point: TransferPoint, firsts: LiveFirst[], min: number, max: number, nowSec: number, feedDown: boolean): DepartureCard[] {
  const cards: DepartureCard[] = [];
  for (const d of point.departures) {
    if (cards.filter(c => !c.canceled).length >= MAX_CARDS) break;
    if (d.canceled) { cards.push({ departure: d, time: d.scheduled, scheduledOnly: false, canceled: true, connections: [] }); continue; }
    const scheduledOnly = !!d.scheduledOnly || feedDown;
    const time = scheduledOnly ? d.scheduled : d.scheduled + (d.delay ?? 0);
    if (time * 60 < nowSec) continue;
    const connections = firsts
      .map(first => ({ first, transfer: time - first.arrives, tight: false }))
      .filter(c => c.transfer >= min && c.transfer <= max)
      .map(c => ({ ...c, tight: c.transfer <= min + 1 }));   // tight: within a minute of the minimum
    if (connections.length) cards.push({ departure: d, time, scheduledOnly, canceled: false, connections });
  }
  while (cards.length && cards[cards.length - 1].canceled) cards.pop();
  return cards;
}

/** Smallest symmetric widening of the window that yields a connection. */
export function suggestWiden(point: TransferPoint, firsts: LiveFirst[], s: TripSettings, nowSec: number, feedDown: boolean): [number, number] | null {
  for (let k = 1; k <= 30; k++) {
    const mn = Math.max(0, s.minTransfer - k), mx = s.maxTransfer + k;
    if (cardsFor(point, firsts, mn, mx, nowSec, feedDown).some(c => !c.canceled)) return [mn, mx];
  }
  return null;
}

export function computeTrip(trip: Trip, s: TripSettings, nowSec: number, feedDownAgencies: string[] = []): PointResult[] {
  const firsts = liveFirsts(trip, s, nowSec);
  return trip.points.filter(p => !s.disabledPoints[p.id]).map(point => {
    const feedDown = feedDownAgencies.includes(point.route.agency);
    const cards = cardsFor(point, firsts, s.minTransfer, s.maxTransfer, nowSec, feedDown);
    const widenTo = cards.some(c => !c.canceled) ? null : suggestWiden(point, firsts, s, nowSec, feedDown);
    return { point, cards, widenTo };
  });
}
