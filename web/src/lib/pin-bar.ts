import type { Mode, PinnedLeg, PinnedStop, PinnedTrip, Route } from '../../../shared/api.ts';
import { approx, clock, countdownTo, minuteCount, minutesUntil } from '../format.ts';
import type { Mark, Transfer } from '../track.tsx';
import { dayLabel, vehicleAt } from '../view.ts';
import { type PinnedPhase, scheduledAt } from './pinned.ts';

// What the app's pin bar works out from a pin, apart from drawing it: which pin it shows, the word
// for the moment, its countdown, the steps left, and the map it opens.

// A pin as the bar ranks it: when the rider next acts on it, in unix seconds, or null when its
// times are away, and whether it has ended.
export type RankedPin = { id: string; at: number | null; ended: boolean };

// The pin the bar shows: the most urgent, the one the rider acts on soonest, until they tap a tab.
// Then it keeps that choice until that pin ends or is unpinned (J, 2026-11-09). An ended pin, or
// one with no times, shows only when nothing else is pinned, or when its tab is tapped, so its
// panel and Unpin can be reached. `chosen` is the tapped pin and whether it had ended by then. It
// comes back null once it no longer holds, for the bar to forget it. (The bar forgets it too once
// another pin replaces it on the same search.)
export type ChosenPin = { id: string; ended: boolean };
export function shownPin<C extends ChosenPin>(pins: RankedPin[], chosen: C | null): { id: string | null; chosen: C | null } {
  const kept = chosen && pins.find(({ id, ended }) => id === chosen.id && (!ended || chosen.ended));
  if (kept) return { id: kept.id, chosen };
  const rank = ({ at, ended }: RankedPin) => (ended ? Infinity : (at ?? Number.MAX_VALUE));
  // The earliest of them, and of two as urgent, the one pinned first, as they are listed.
  const first = pins.reduce<RankedPin | null>((best, pin) => (best === null || rank(pin) < rank(best) ? pin : best), null);
  return { id: first?.id ?? null, chosen: null };
}

// What a rider calls the vehicle they change to, for the bar's "bus leaves in".
const VEHICLES: Record<Mode, string> = { bus: 'bus', trolleybus: 'bus', 'light-rail': 'train', streetcar: 'streetcar', 'cable-car': 'cable car', bart: 'train', ferry: 'ferry' };
export const vehicleWord = (route: Route | undefined) => (route ? VEHICLES[route.mode] : 'vehicle');

// The words that name the bar's countdown, after "Pinned · To Mom's ·", which follow the moment
// (J, 2026-11-09): leaves in, get off in, bus leaves in, arrive in. `soon` is a countdown that
// reads "Now", which takes no "in". `transfers` is false for a ride with no first vehicle, whose
// one vehicle needs no naming. `reaches` is whether the trip ends at a stop the rider gets off at.
export function pinVerb(phase: PinnedPhase, { soon = false, transfers = true, vehicle = 'vehicle', reaches = true }: { soon?: boolean; transfers?: boolean; vehicle?: string; reaches?: boolean } = {}) {
  switch (phase) {
    case 'wait':
      return soon ? 'leaving' : 'leaves in';
    case 'ride':
      return soon ? 'get off' : 'get off in';
    case 'change':
      return `${transfers ? `${vehicle} ` : ''}${soon ? 'leaving' : 'leaves in'}`;
    case 'ride-second':
      return soon ? 'arriving' : 'arrive in';
    case 'done':
      return reaches ? 'arrived' : 'left';
  }
}

// The bar's countdown, as a row's number column, to what happens next: the first vehicle leaving,
// getting off it, the second leaving, and arriving. Under a minute it reads "Now". Getting off and
// arriving are marked when they come from the schedule alone (see approx), as a vehicle's tag
// speaks only for when it is boarded, and boarding a vehicle yet to leave the first stop of its
// trip comes then at the soonest (see atLeast). `at` is when that is, for ranking pins.
export function tripCountdown(phase: PinnedPhase, first: PinnedLeg | null, second: PinnedLeg, now: number): { num: string; unit: string | null; at: number | null } {
  const until = (stop: PinnedStop, mark: 'scheduled' | 'notStarted' | null) => {
    const { num, unit } = countdownTo(stop.at, now, '', '', mark);
    return { num, unit, at: stop.at };
  };
  const boarding = (leg: PinnedLeg) => (leg.notStarted ? 'notStarted' : null);
  const getting = (leg: PinnedLeg, stop: PinnedStop) => (scheduledAt(leg, stop) ? 'scheduled' : null);
  switch (phase) {
    case 'wait':
      return until(first!.on!, boarding(first!));
    case 'ride':
      return until(first!.off!, getting(first!, first!.off!));
    case 'change':
      return until(second.on!, boarding(second));
    case 'ride-second':
      return until(second.off!, getting(second, second.off!));
    case 'done':
      return { num: '✓', unit: null, at: null };
  }
}

// The vehicle and stop the bar's row is about at each point of the trip: the first vehicle where
// it is boarded, then where the rider gets off it, the second where it is boarded, then where the
// rider gets off that. `boards` is whether the rider is yet to board it there, so its lateness is
// the thing to say.
export function pinFocus(phase: PinnedPhase, first: PinnedLeg | null, second: PinnedLeg): { leg: PinnedLeg; stop: PinnedStop; boards: boolean } {
  if (phase === 'wait') return { leg: first!, stop: first!.on!, boards: true };
  if (phase === 'ride') return { leg: first!, stop: first!.off!, boards: false };
  if (phase === 'change') return { leg: second, stop: second.on!, boards: true };
  return second.off ? { leg: second, stop: second.off, boards: false } : { leg: second, stop: second.on!, boards: false };
}

// The steps the open bar lists under its row, in the order the rider makes them: getting off the
// first vehicle, boarding the second, and arriving. The bar's own row is boarding the first, and
// a step drops out once the rider is past it, but the one they are on stays, with what the row has
// no room for, such as the walk and the stop's alert.
export type PinStep = 'off' | 'board' | 'arrive';
export function restOfTrip(phase: PinnedPhase, pinned: { first?: PinnedLeg | null; second: PinnedLeg }): PinStep[] {
  const steps: PinStep[] = [];
  if (pinned.first?.off && (phase === 'wait' || phase === 'ride')) steps.push('off');
  if (phase === 'wait' || phase === 'ride' || phase === 'change') steps.push('board');
  if (pinned.second.off) steps.push('arrive');
  return steps;
}

// The stops whose alerts the bar counts and its open panel shows: those the rider has yet to stand
// at, where they board the first vehicle, get off it, and board the second. `boarding` are the ones
// with no step of their own in the panel, and `changing` those of the step that boards the second.
export function alertStops(phase: PinnedPhase, { first, second }: { first?: PinnedLeg | null; second: PinnedLeg }): { boarding: string[]; changing: string[] } {
  const boarding = phase === 'wait' && first?.on ? [first.on.stop] : [];
  const off = (phase === 'wait' || phase === 'ride') && first?.off ? [first.off.stop] : [];
  const on = phase !== 'ride-second' && phase !== 'done' && second.on ? [second.on.stop] : [];
  return { boarding: boarding.filter((stop) => !off.includes(stop) && !on.includes(stop)), changing: [...new Set([...off, ...on])] };
}

// Whole minutes from boarding the first vehicle, or the only one, to arriving, and whether either
// end is the schedule's alone, which marks them (see approx). Null with no stop to arrive at.
export function tripMinutes(pinned: PinnedTrip): { minutes: number; scheduled: boolean } | null {
  const leg = pinned.first ?? pinned.second;
  const start = leg?.on;
  const end = pinned.second?.off;
  if (!leg || !start || !end || !pinned.second) return null;
  return { minutes: Math.max(0, Math.floor((end.at - start.at) / 60)), scheduled: !leg.live || scheduledAt(pinned.second, end) };
}
export const tripMinutesText = ({ minutes, scheduled }: { minutes: number; scheduled: boolean }) => `${approx(String(minutes), scheduled)}\u00a0min trip`;

// What the pinned trip is doing now, in words, for the bar's spoken summary and for saying a new
// step. A time from the schedule alone is never "now", as its countdown shows "~1 min" (see
// approx), nor is a vehicle yet to leave the first stop of its trip (see atLeast).
export function tripStatusText(phase: PinnedPhase, first: PinnedLeg | null, second: PinnedLeg, name: (stop: PinnedStop) => string, label: (leg: PinnedLeg) => string, now: number) {
  const due = (stop: PinnedStop, scheduled = false, notStarted = false) => {
    const minutes = minutesUntil(stop.at, now);
    if (scheduled) return `in ${minuteCount(Math.max(1, minutes))}, scheduled`;
    if (notStarted) return `in at least ${minuteCount(Math.max(1, minutes))}, as it has not left the start of its route`;
    return minutes < 1 ? 'now' : `in ${minuteCount(minutes)}`;
  };
  // A trip left pinned past its day says which day it was.
  const when = (stop: PinnedStop) => {
    const day = dayLabel(stop.at * 1000, now);
    return `${day === 'Today' ? '' : day === 'Yesterday' ? 'yesterday ' : `on ${day} `}at ${clock(stop.at)}`;
  };
  switch (phase) {
    case 'wait':
      return `${label(first!)} leaves ${name(first!.on!)} ${due(first!.on!, false, first!.notStarted)}`;
    case 'ride':
      return `Get off at ${name(first!.off!)} ${due(first!.off!, scheduledAt(first!, first!.off!))}`;
    case 'change':
      return `${label(second)} leaves ${name(second.on!)} ${due(second.on!, false, second.notStarted)}`;
    case 'ride-second':
      return `Arrive at ${name(second.off!)} ${due(second.off!, scheduledAt(second, second.off!))}`;
    case 'done':
      return second.off ? `Reached ${name(second.off)} ${when(second.off)}` : `${label(second)} left ${name(second.on!)} ${when(second.on!)}`;
  }
}

// The map the bar opens (J, 2026-11-09). Until the rider is on the second vehicle, the first
// vehicle's, with the second drawn on to the destination: it watches where the rider boards until
// it leaves, then where they get off. Once they ride the second, that vehicle's own map, watching
// where they get off it. With no first vehicle, or one the schedule lacks (`added`) and so has no
// line to draw, the second's own map all along, watching where it is boarded until it leaves.
// `stop` is the stop watched, by key.
export type PinMap = { trip: string; stop: string; title: string; color?: string; marks: Mark[]; transfer?: Transfer };
export function pinMap(
  phase: PinnedPhase,
  { first, second }: { first: PinnedLeg | null; second: PinnedLeg },
  { routes, colorOf, transfer }: { routes: Record<string, Route>; colorOf?: (routeKey: string) => string; transfer?: Pick<Transfer, 'minutes' | 'scheduled' | 'min' | 'walkMeters'> },
): PinMap {
  const color = (leg: PinnedLeg) => (colorOf ? { color: colorOf(leg.route) } : {});
  const onSecond = phase === 'ride-second' || phase === 'done';
  if (first?.on && !first.added && !onSecond) {
    return {
      trip: first.trip,
      stop: phase === 'wait' ? first.on.stop : (first.off?.stop ?? first.on.stop),
      title: vehicleAt(routes[first.route], first.on.at),
      ...color(first),
      marks: [{ stop: first.on.stop, kind: 'yours' }, ...(first.off ? [{ stop: first.off.stop, kind: 'transfer' as const }] : [])],
      transfer: { trip: second.trip, stop: second.on!.stop, ...color(second), ...transfer, ...(second.off ? { destination: second.off.stop } : {}) },
    };
  }
  return {
    trip: second.trip,
    stop: onSecond ? (second.off?.stop ?? second.on!.stop) : second.on!.stop,
    title: vehicleAt(routes[second.route], second.on!.at),
    ...color(second),
    marks: [{ stop: second.on!.stop, kind: 'yours' }, ...(second.off ? [{ stop: second.off.stop, kind: 'destination' as const }] : [])],
  };
}
