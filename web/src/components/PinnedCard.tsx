import type { ComponentChildren } from 'preact';
import type { PinnedLeg, PinnedStop, PinnedTrip, TripResponse } from '../../../shared/api.ts';
import type { Pin } from '../storage.ts';
import { approx, clock, countdownTo, minutesUntil, walkText } from '../format.ts';
import { IconClose, IconPin } from '../icons/ui.tsx';
import { type PinnedPhase, pinnedPhase, pinnedTransfer } from '../lib/pinned.ts';
import { type Mark, TimeLink } from '../track.tsx';
import { chipLabel, dayLabel, pinLabel, shortStopName, statusOf } from '../view.ts';
import { Countdown } from './Countdown.tsx';
import { RouteChip } from './RouteChip.tsx';
import { Flag, StatusTag } from './StatusTag.tsx';
import { TimeBar } from './TimeBar.tsx';
import { AppLink } from './AppLink.tsx';
import { useSettings } from '../settings.tsx';

// The trip the rider pinned, at the top of its results until they unpin it, drawn as its row is
// once pinned: a countdown to what happens next, each vehicle's live times where the rider gets
// on and off, the transfer between them, and the time bar. Each time opens its vehicle's map,
// watching the stop that matters at this point of the trip.
export function PinnedCard({ pin, pinned, data, destination, colorOf, pct, now, unpinAt, onPin, trip, stale }: {
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
  // On Home, the search it is pinned to, which opens its results, and how old its times are when
  // they are not live.
  trip?: { label: string; href: string };
  stale?: string | null;
}) {
  const { walkSpeed } = useSettings().settings;
  const second = pinned?.second;
  if (!pinned || !second?.on || (pinned.first !== undefined && !pinned.first?.on)) {
    return (
      <PinnedFrame label="Pinned trip" open={trip} stale={stale} onUnpin={() => onPin(null)}>
        <p class="tf-pinned__note">Times for this trip are not available right now.</p>
      </PinnedFrame>
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
  // The pinned connection as the results have it, when they still do.
  const group = pin.first ? data.groups.find(({ board }) => board === pin.second.board) : undefined;
  const connection = group?.departures.flatMap(({ connections }) => connections).find(({ trip }) => trip === pin.first!.trip);
  // The walk between the two vehicles, as the results give it: the row's own when its vehicle lets
  // the rider off at another stop than its group's.
  const walkMeters = connection?.walkMeters ?? group?.walkMeters;
  const walk = pin.first && walkMeters !== undefined ? walkText(walkMeters, walkSpeed) : null;
  // The window's shortest transfer, which the first vehicle's map marks a tight transfer by, as
  // results do. A hidden connection is outside the window already.
  const min = group && !connection?.hidden ? group.window.min : undefined;
  const missed = transfer !== null && transfer < 0;
  // Each vehicle's Scheduled tag says it of the time it is boarded. Getting off, and the transfer
  // between them, say it themselves.
  const transferScheduled = Boolean(first && (!first.live || !second.live));
  const transferText = (minutes: number) => `${approx(String(minutes), transferScheduled)}\u00a0min`;
  const canceled = [first, second].find((leg) => leg?.canceled);
  const status = canceled ? `The ${label(canceled)} at ${clock(canceled.on?.at ?? canceled.off!.at)} is canceled` : statusText(phase, first, second, name, label, now);
  const countdown = countdownOf(phase, first, second, now);
  // The maps' sheets can unpin the trip, and pin it again.
  const sheetPin = { pinned: true, label: pinLabel(...(first ? [[data.routes[first.route], first.on!.at] as const] : []), [data.routes[second.route], second.on!.at]), set: (on: boolean) => onPin(on ? pin : null) };

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
      transfer={{
        trip: second.trip,
        stop: second.on!.stop,
        color: colorOf(second.route),
        ...(transfer !== null ? { minutes: transfer } : {}),
        ...(min !== undefined ? { min } : {}),
        ...(second.off ? { destination: second.off.stop } : {}),
      }}
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
    first?.off && `Off at ${name(first.off)} ${clock(first.off.at)}${first.live ? '' : ', scheduled'}.${walk ? ` ${walk}.` : ''}`,
    transfer !== null && (missed ? `Transfer missed by ${-transfer} minutes${transferScheduled ? ', scheduled' : ''}.` : `${transferScheduled ? 'Scheduled ' : ''}${transfer} minute transfer.`),
    `${label(second)} at ${clock(second.on.at)} from ${name(second.on)}, ${statusOf(second.on.delay, second.live, second.canceled).label}.`,
    second.off && `Arrives at ${name(second.off)} ${clock(second.off.at)}${second.live ? '' : ', scheduled'}.`,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <PinnedFrame
      label="Pinned trip"
      open={trip}
      stale={stale}
      onUnpin={() => onPin(null)}
      tags={
        <>
          {missed && <span class="tf-tight">Missed</span>}
          {canceled && <span class="tf-tight">Canceled</span>}
        </>
      }
    >
      <div class="tf-row tf-pinned__row">
        <span class="tf-sr">{spoken}</span>
        <Countdown {...countdown} />
        <div class="tf-row__main">
          {first && vehicle(first, first.on!, firstLink)}
          {first?.off && (
            <div class="tf-row__off" aria-hidden="true">
              <span class="tf-row__keep">Off {approx(clock(first.off.at), !first.live)}</span> at {name(first.off)}
              {walk && (
                <>
                  &nbsp;· <span class="tf-row__keep">{walk}</span>
                </>
              )}
            </div>
          )}
          {/* The narrowest phones have no room for the transfer's own column, so it sits here,
              between the vehicles, where the rider makes it (see styles.css). */}
          {transfer !== null && (
            <div class="tf-pinned__xfer" aria-hidden="true">
              {missed ? <span class="tf-pinned__missed">Missed by {transferText(-transfer)}</span> : `${transferText(transfer)} transfer`}
            </div>
          )}
          <div class={first ? 'tf-pinned__second' : undefined}>
            {vehicle(second, second.on, secondLink)}
            <div class="tf-row__off" aria-hidden="true">
              at {name(second.on)}
            </div>
            {second.off && (
              <div class="tf-row__off" aria-hidden="true">
                Arrive <span class="tf-pinned__arrive">{approx(clock(second.off.at), !second.live)}</span> at {name(second.off)}
              </div>
            )}
          </div>
        </div>
        <div class="tf-row__xfer" aria-hidden="true">
          {transfer !== null &&
            (missed ? (
              <>
                <div class="tf-row__xfer-min tf-pinned__missed">Missed</div>
                <div class="tf-row__xfer-label">by {transferText(-transfer)}</div>
              </>
            ) : (
              <>
                <div class="tf-row__xfer-min">{transferText(transfer)}</div>
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
    </PinnedFrame>
  );
}

// The countdown column, as a row's, to what happens next: the first vehicle leaving, getting off
// it, the second leaving, and arriving at the destination. Under a minute it says so in words.
// Getting off and arriving are marked when they come from the schedule alone (see approx), as a
// vehicle's tag speaks only for when it is boarded.
function countdownOf(phase: PinnedPhase, first: PinnedLeg | null, second: PinnedLeg, now: number) {
  const until = (stop: PinnedStop, lead: string, soon: string, scheduled = false) => countdownTo(stop.at, now, lead, soon, scheduled);
  switch (phase) {
    case 'wait':
      return until(first!.on!, 'Leaves in', 'Leaving');
    case 'ride':
      return until(first!.off!, 'Off in', 'Getting off', !first!.live);
    case 'change':
      return until(second.on!, 'Board in', 'Boarding');
    case 'ride-second':
      return until(second.off!, 'Arrive in', 'Arriving', !second.live);
    case 'done':
      return { lead: 'Done', num: '✓', unit: null };
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
      return `Off at ${name(first!.off!)} ${due(first!.off!)}${first!.live ? '' : ', scheduled'}`;
    case 'change':
      return `${label(second)} leaves ${name(second.on!)} ${due(second.on!)}`;
    case 'ride-second':
      return `At ${name(second.off!)} ${due(second.off!)}${second.live ? '' : ', scheduled'}`;
    case 'done':
      return second.off ? `Reached ${name(second.off)} ${when(second.off)}` : `${label(second)} left ${name(second.on!)} ${when(second.on!)}`;
  }
}

// What every pinned card shares, a trip's or a stop's arrival's. On Home, a link under the whole
// card opens its page, with what it is pinned to by name. Then come its kicker, any tags, and
// Unpin, and a note when its times are not live.
export function PinnedFrame({ label, open, tags, stale, onUnpin, children }: {
  label: string;
  open?: { label: string; href: string } | undefined;
  tags?: ComponentChildren;
  stale?: string | null | undefined;
  onUnpin: () => void;
  children: ComponentChildren;
}) {
  return (
    <section class={`tf-pinned${open ? ' tf-pinned--opens' : ''}`} aria-label={label}>
      {open && <OpenTrip trip={open} />}
      <div class="tf-pinned__head">
        <span class="tf-kicker tf-pinned__kicker">
          <IconPin filled size={13} />
          Pinned
        </span>
        {open && <span class="tf-pinned__trip">{open.label}</span>}
        {tags}
        <button type="button" class="tf-pinned__unpin" onClick={onUnpin}>
          <IconClose size={16} />
          Unpin
        </button>
      </div>
      {stale && (
        <Flag tone="caution" class="tf-pinned__stale">
          {stale}
        </Flag>
      )}
      {children}
    </section>
  );
}

// A pinned card waiting for its first times.
export const waitingNote = (offline: boolean) => (offline ? 'Times can’t load right now. They show again once the phone is back online.' : 'Getting live predictions…');

// On Home, the whole card opens the trip's results, as a saved card does. A link laid under it,
// so the times and Unpin keep their own taps (see styles.css), as a transfer row's pin toggle does.
export function OpenTrip({ trip }: { trip: { label: string; href: string } }) {
  return <AppLink class="tf-pinned__open" href={trip.href} label={`Open ${trip.label}`} />;
}
