import type { ComponentChildren } from 'preact';
import type { PinnedLeg, PinnedStop, PinnedTrip, TripResponse } from '../../../shared/api.ts';
import type { Pin } from '../storage.ts';
import { clock, minutesUntil } from '../format.ts';
import { IconClose, IconPin, IconTransfer } from '../icons/ui.tsx';
import { type PinnedPhase, pinnedPhase, pinnedTransfer } from '../lib/pinned.ts';
import { type Mark, TimeLink } from '../track.tsx';
import { chipLabel, dayLabel, shortStopName, statusOf } from '../view.ts';
import { RouteChip } from './RouteChip.tsx';
import { StatusTag } from './StatusTag.tsx';

// The trip the rider pinned, at the top of its results until they unpin it: what happens next,
// then each vehicle's times where they get on and off, live, with the transfer between. Each time
// opens its vehicle's map, watching the stop that matters at this point of the trip.
export function PinnedCard({ pin, pinned, data, destination, colorOf, now, unpinAt, onPin }: {
  pin: Pin;
  pinned: PinnedTrip | null;
  data: TripResponse;
  // The search's destination stop, when it has one.
  destination: string | undefined;
  colorOf: (routeKey: string) => string;
  // Milliseconds, on the server's clock.
  now: number;
  // When it unpins itself, with that setting on.
  unpinAt: number | null;
  // Unpins with null, and pins this trip again after its map's sheet unpinned it.
  onPin: (pin: Pin | null) => void;
}) {
  const onUnpin = () => onPin(null);
  const head = (tags: ComponentChildren) => (
    <div class="tf-pinned__head">
      <span class="tf-kicker tf-pinned__kicker">
        <IconPin filled size={14} />
        Pinned
      </span>
      {tags}
      <button type="button" class="tf-pinned__unpin" onClick={onUnpin}>
        <IconClose size={16} />
        Unpin
      </button>
    </div>
  );
  const second = pinned?.second;
  if (!pinned || !second?.on || (pinned.first !== undefined && !pinned.first?.on)) {
    return (
      <section class="tf-pinned" aria-label="Pinned trip">
        {head(null)}
        <p class="tf-pinned__status">Times for this trip are not available right now.</p>
      </section>
    );
  }
  const first = pinned.first ?? null;
  const name = (stop: PinnedStop) => shortStopName(data.stops[stop.stop], stop.stop);
  const label = (leg: PinnedLeg) => {
    const route = data.routes[leg.route];
    return route ? chipLabel(route) : 'Vehicle';
  };
  const phase = pinnedPhase(pinned, now / 1000);
  const transfer = pinnedTransfer(pinned);
  const missed = transfer !== null && transfer < 0;
  const canceled = [first, second].find((leg) => leg?.canceled);
  const status = canceled ? `The ${label(canceled)} at ${clock(canceled.on?.at ?? canceled.off!.at)} is canceled` : statusText(phase, first, second, name, label, now);
  const past = (stop: PinnedStop | null | undefined) => stop !== null && stop !== undefined && stop.at * 1000 <= now;
  // The maps' sheets can unpin the trip, and pin it again.
  const sheetPin = { pinned: true, label: `the ${first ? `${label(first)} at ${clock(first.on!.at)} to the ` : ''}${label(second)} at ${clock(second.on!.at)}`, set: (on: boolean) => onPin(on ? pin : null) };

  // The first vehicle's map watches From until it leaves, then where the rider gets off, with the
  // second vehicle drawn on to the destination. The second's watches where it is boarded until
  // it leaves, then the destination.
  const firstLink = (stop: PinnedStop) => (
    <TimeLink
      trip={first!.trip}
      stop={data.stops[phase === 'wait' ? first!.on!.stop : (first!.off?.stop ?? first!.on!.stop)]}
      title={`${label(first!)} at ${clock(first!.on!.at)}`}
      color={colorOf(first!.route)}
      marks={[{ stop: first!.on!.stop, kind: 'yours' }, ...(first!.off ? [{ stop: first!.off.stop, kind: 'transfer' as const }] : [])]}
      transfer={{ trip: second.trip, stop: second.on!.stop, color: colorOf(second.route), ...(transfer !== null ? { minutes: transfer } : {}), ...(second.off ? { destination: second.off.stop } : {}) }}
      pin={sheetPin}
    >
      {clock(stop.at)}
    </TimeLink>
  );
  const secondMarks: Mark[] = [{ stop: second.on.stop, kind: first ? 'transfer' : 'yours' }, ...(second.off ? [{ stop: second.off.stop, kind: 'destination' as const }] : [])];
  const secondLink = (stop: PinnedStop) => (
    <TimeLink
      trip={second.trip}
      stop={data.stops[phase === 'ride-second' || phase === 'done' ? (second.off?.stop ?? second.on!.stop) : second.on!.stop]}
      title={`${label(second)} at ${clock(second.on!.at)}`}
      color={colorOf(second.route)}
      marks={secondMarks}
      pin={sheetPin}
    >
      {clock(stop.at)}
    </TimeLink>
  );
  const step = (key: string, chip: ComponentChildren, stop: PinnedStop, link: (stop: PinnedStop) => ComponentChildren, what: string, leg: PinnedLeg | null) => [
    <span key={`${key}-chip`} class="tf-pinned__chip">
      {chip}
    </span>,
    <div key={key} class={`tf-pinned__step${past(stop) ? ' tf-pinned__step--past' : ''}`}>
      <span class="tf-pinned__time">{link(stop)}</span>
      {leg && <StatusTag status={statusOf(stop.delay, leg.live, leg.canceled)} plain />}
      <span class="tf-pinned__what">{what}</span>
    </div>,
  ];
  const routeChip = (leg: PinnedLeg) => <RouteChip route={data.routes[leg.route]} size="sm" color={colorOf(leg.route)} />;
  return (
    <section class="tf-pinned" aria-label="Pinned trip">
      {head(
        <>
          {missed && <span class="tf-tight">Transfer missed</span>}
          {canceled && <span class="tf-tight">Canceled</span>}
        </>,
      )}
      {/* Not a live region: it counts down each minute, which would interrupt a screen reader. */}
      <p class="tf-pinned__status">{status}</p>
      <div class="tf-pinned__steps">
        {first && step('first-on', routeChip(first), first.on!, firstLink, `from ${name(first.on!)}`, first)}
        {first?.off && step('first-off', null, first.off, firstLink, `off at ${name(first.off)}`, null)}
        {first && transfer !== null && [
          <span key="xfer-chip" />,
          <div key="xfer" class={`tf-pinned__xfer${missed ? ' tf-pinned__xfer--missed' : ''}`}>
            <IconTransfer />
            {missed ? `Transfer missed by ${-transfer} min` : `${transfer} min transfer`}
          </div>,
        ]}
        {step('second-on', routeChip(second), second.on, secondLink, `from ${name(second.on)}`, second)}
        {second.off && step('second-off', null, second.off, secondLink, `arrive at ${name(second.off)}`, null)}
      </div>
      {destination && !second.off && (
        <p class="tf-pinned__note">
          This {label(second)} does not stop at {shortStopName(data.stops[destination], 'your destination')}.
        </p>
      )}
      {phase === 'done' && unpinAt !== null && <p class="tf-pinned__unpins">Unpins at {clock(unpinAt / 1000)}</p>}
    </section>
  );
}

function statusText(phase: PinnedPhase, first: PinnedLeg | null, second: PinnedLeg, name: (stop: PinnedStop) => string, label: (leg: PinnedLeg) => string, now: number) {
  const due = (stop: PinnedStop) => {
    const minutes = minutesUntil(stop.at, now);
    return minutes < 1 ? 'now' : `in ${minutes} min`;
  };
  // A trip left pinned past its day says which day it was.
  const when = (stop: PinnedStop) => {
    const day = dayLabel(stop.at * 1000, now);
    return `${day === 'Today' ? '' : day === 'Yesterday' ? 'yesterday ' : `on ${day} `}at ${clock(stop.at)}`;
  };
  switch (phase) {
    case 'wait':
      return `${label(first!)} leaves ${name(first!.on!)} ${due(first!.on!)}`;
    case 'ride':
      return `Off at ${name(first!.off!)} ${due(first!.off!)}`;
    case 'change':
      return `${label(second)} leaves ${name(second.on!)} ${due(second.on!)}`;
    case 'ride-second':
      return `At ${name(second.off!)} ${due(second.off!)}`;
    case 'done':
      return second.off ? `Reached ${name(second.off)} ${when(second.off)}` : `${label(second)} left ${name(second.on!)} ${when(second.on!)}`;
  }
}
