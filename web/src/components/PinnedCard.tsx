import type { ComponentChildren } from 'preact';
import type { PinnedLeg, PinnedStop, PinnedTrip, TripResponse } from '../../../shared/api.ts';
import type { Pin } from '../storage.ts';
import { clock, minutesUntil } from '../format.ts';
import { IconClose, IconPin } from '../icons/ui.tsx';
import { type PinnedPhase, pinnedPhase, pinnedTransfer } from '../lib/pinned.ts';
import { type Mark, TimeLink } from '../track.tsx';
import { chipLabel, dayLabel, shortStopName, statusOf } from '../view.ts';
import { RouteChip } from './RouteChip.tsx';
import { StatusTag } from './StatusTag.tsx';
import { TimeBar } from './TimeBar.tsx';

// The trip the rider pinned, at the top of its results until they unpin it, drawn as its row is
// once pinned: a countdown to what happens next, each vehicle's live times where the rider gets
// on and off, the transfer between them, and the time bar. Each time opens its vehicle's map,
// watching the stop that matters at this point of the trip.
export function PinnedCard({ pin, pinned, data, destination, colorOf, pct, now, unpinAt, onPin }: {
  pin: Pin;
  pinned: PinnedTrip | null;
  data: TripResponse;
  // The search's destination stop, when it has one.
  destination: string | undefined;
  colorOf: (routeKey: string) => string;
  // Unix seconds to a place on the results' shared time scale.
  pct: (unixSeconds: number) => number;
  // Milliseconds, on the server's clock.
  now: number;
  // When it unpins itself, with that setting on.
  unpinAt: number | null;
  // Unpins with null, and pins this trip again after its map's sheet unpinned it.
  onPin: (pin: Pin | null) => void;
}) {
  const head = (tags: ComponentChildren) => (
    <div class="tf-pinned__head">
      <span class="tf-kicker tf-pinned__kicker">
        <IconPin filled size={13} />
        Pinned
      </span>
      {tags}
      <button type="button" class="tf-pinned__unpin" onClick={() => onPin(null)}>
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
        <p class="tf-pinned__note">Times for this trip are not available right now.</p>
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
  const countdown = countdownOf(phase, first, second, now);
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
  const vehicle = (leg: PinnedLeg, stop: PinnedStop, link: (stop: PinnedStop) => ComponentChildren) => (
    <>
      <div class="tf-row__line">
        <RouteChip route={data.routes[leg.route]} color={colorOf(leg.route)} hidden />
        {link(stop)}
      </div>
      <StatusTag status={statusOf(stop.delay, leg.live, leg.canceled)} plain hidden />
    </>
  );
  // Everything shown, in one sentence for screen readers, who then reach only the links.
  const spoken = [
    `Pinned trip. ${status}.`,
    first && `${label(first)} at ${clock(first.on!.at)}, ${statusOf(first.on!.delay, first.live, first.canceled).label}.`,
    first?.off && `Off at ${name(first.off)} ${clock(first.off.at)}.`,
    transfer !== null && (missed ? `Transfer missed by ${-transfer} minutes.` : `${transfer} minute transfer.`),
    `${label(second)} at ${clock(second.on.at)} from ${name(second.on)}, ${statusOf(second.on.delay, second.live, second.canceled).label}.`,
    second.off && `Arrives at ${name(second.off)} ${clock(second.off.at)}.`,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <section class="tf-pinned" aria-label="Pinned trip">
      {head(
        <>
          {missed && <span class="tf-tight">Missed</span>}
          {canceled && <span class="tf-tight">Canceled</span>}
        </>,
      )}
      <div class="tf-row tf-pinned__row">
        <span class="tf-sr">{spoken}</span>
        <div aria-hidden="true">
          <div class="tf-row__lead">{countdown.lead}</div>
          <div class="tf-row__num">{countdown.num}</div>
          {countdown.unit && <div class="tf-row__unit">min</div>}
        </div>
        <div class="tf-row__main">
          {first && vehicle(first, first.on!, firstLink)}
          {first?.off && (
            <div class="tf-row__off" aria-hidden="true">
              Off {clock(first.off.at)} at {name(first.off)}
            </div>
          )}
          <div class={first ? 'tf-pinned__second' : undefined}>
            {vehicle(second, second.on, secondLink)}
            <div class="tf-row__off" aria-hidden="true">
              at {name(second.on)}
            </div>
            {second.off && (
              <div class="tf-row__off" aria-hidden="true">
                Arrive <span class="tf-pinned__arrive">{clock(second.off.at)}</span> at {name(second.off)}
              </div>
            )}
          </div>
        </div>
        <div class="tf-row__xfer" aria-hidden="true">
          {transfer !== null &&
            (missed ? (
              <>
                <div class="tf-row__xfer-min tf-pinned__missed">Missed</div>
                <div class="tf-row__xfer-label">by {-transfer} min</div>
              </>
            ) : (
              <>
                <div class="tf-row__xfer-min">{transfer} min</div>
                <div class="tf-row__xfer-label">transfer</div>
              </>
            ))}
        </div>
        {first?.off && (
          <TimeBar
            rideStart={pct(first.on!.at)}
            rideEnd={pct(first.off.at)}
            gapEnd={pct(second.on.at)}
            busEnd={pct(second.off?.at ?? second.on.at + 8 * 60)}
            busColor={colorOf(second.route)}
          />
        )}
      </div>
      {destination && !second.off && (
        <p class="tf-pinned__note">
          This {label(second)} does not stop at {shortStopName(data.stops[destination], 'your destination')}.
        </p>
      )}
      {phase === 'done' && unpinAt !== null && <p class="tf-pinned__note">Unpins at {clock(unpinAt / 1000)}</p>}
    </section>
  );
}

// The countdown column, as a row's, to what happens next: the first vehicle leaving, getting off
// it, the second leaving, and arriving at the destination. Under a minute it says so in words.
function countdownOf(phase: PinnedPhase, first: PinnedLeg | null, second: PinnedLeg, now: number) {
  const until = (stop: PinnedStop, lead: string, soon: string) => {
    const minutes = minutesUntil(stop.at, now);
    return minutes < 1 ? { lead: soon, num: 'Now', unit: false } : { lead, num: String(minutes), unit: true };
  };
  switch (phase) {
    case 'wait':
      return until(first!.on!, 'Leaves in', 'Leaving');
    case 'ride':
      return until(first!.off!, 'Off in', 'Getting off');
    case 'change':
      return until(second.on!, 'Board in', 'Boarding');
    case 'ride-second':
      return until(second.off!, 'Arrive in', 'Arriving');
    case 'done':
      return { lead: 'Done', num: '✓', unit: false };
  }
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
