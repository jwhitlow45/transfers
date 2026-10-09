import type { Connection, Departure } from '../../../shared/api.ts';
import { clock, minutesUntil, walkText } from '../format.ts';
import { pinOf, sameRun } from '../lib/pinned.ts';
import { type CardContext, isTight } from '../lib/results.ts';
import { IconPin } from '../icons/ui.tsx';
import { TimeLink } from '../track.tsx';
import { chipLabel, shortStopName, spokenRoute, statusOf } from '../view.ts';
import { Countdown } from './Countdown.tsx';
import { RouteChip } from './RouteChip.tsx';
import { StopLink } from './StopLink.tsx';
import { PinToggle } from './PinToggle.tsx';
import { StatusTag } from './StatusTag.tsx';
import { TimeBar } from './TimeBar.tsx';

const HIDDEN = {
  short: { tag: 'Under min', spoken: 'shorter than your minimum' },
  long: { tag: 'Over max', spoken: 'longer than your maximum' },
  soon: { tag: 'Too soon', spoken: 'leaves before you can reach it' },
};

// One first vehicle under a departure. The countdown leads: when it reaches the From stop.
export function ConnectionRow({ connection, departure, alightName, alight, board, min, walkMeters, secondColor, context }: {
  connection: Connection;
  departure: Departure;
  alightName: string;
  // The group's stop keys for where riders get off, unless this vehicle names its own, and where
  // they board the second vehicle.
  alight: string;
  board: string;
  min: number;
  // The group's walk from its stop, which a vehicle letting the rider off elsewhere has its own of.
  walkMeters: number;
  secondColor: string;
  context: CardContext;
}) {
  const route = context.data.routes[connection.route];
  const minutes = minutesUntil(connection.departs, context.now);
  // Left From already: kept so a rider on it can still pin it.
  const left = connection.departs * 1000 < context.now;
  const ago = Math.floor((context.now - connection.departs * 1000) / 60_000);
  const now = !left && minutes < 1;
  const status = statusOf(connection.departDelay, connection.live);
  const tight = isTight(connection, min);
  const hidden = connection.hidden ? HIDDEN[connection.hidden] : null;
  // A pooled group's vehicles can let the rider off at different stops. The group names its
  // usual one, and a row says its own when it differs.
  const offAt = connection.alight ? shortStopName(context.data.stops[connection.alight], '') : null;
  // The walk to the second vehicle, said where the rider gets off (J, 2026-10-08). None at its stop.
  // A non-breaking space keeps the minutes with their unit.
  const walk = walkText(connection.walkMeters ?? walkMeters)?.replace(' min', '\u00a0min');
  const spoken =
    `${route ? spokenRoute(route) : 'Vehicle'}, ${left ? (ago < 1 ? 'just left' : `left ${ago} minute${ago === 1 ? '' : 's'} ago`) : now ? 'arriving now' : `arrives in ${minutes} minute${minutes === 1 ? '' : 's'}`}, ${clock(connection.departs)}, ${status.label}. ` +
    `Off at ${offAt ?? alightName} ${clock(connection.arrives)}.${walk ? ` ${walk}.` : ''} ${connection.transfer} minute transfer${tight ? ', tight' : ''}${hidden ? `, hidden because it is ${hidden.spoken}` : ''}.`;
  const secondEnd = departure.destination ?? departure.at + 8 * 60;
  // The vehicle's time opens its map with where the rider gets on and where they get off to
  // transfer marked.
  const offStop = connection.alight ?? alight;
  const marks = [
    { stop: context.data.from, kind: 'yours' as const },
    { stop: offStop, kind: 'transfer' as const },
  ];
  // The second vehicle this one connects to, drawn on the same map, on to the destination.
  const destination = departure.destination !== undefined ? context.destination : undefined;
  const transfer = { trip: departure.trip, stop: board, color: secondColor, minutes: connection.transfer, ...(hidden ? {} : { min }), ...(destination ? { destination } : {}) };
  const { pin } = context;
  // The same vehicles, stops, and run: trip ids repeat every day.
  const pinned = pin?.first?.trip === connection.trip && pin.first.alight === offStop && pin.second.trip === departure.trip && pin.second.board === board && sameRun(pin.at, departure.at);
  const setPinned = (on: boolean) =>
    context.onPin(on ? pinOf(departure, board, { connection, alight: offStop }) : null);
  const secondRoute = context.data.routes[departure.route];
  const pinLabel = `${route ? chipLabel(route) : 'vehicle'} at ${clock(connection.departs)} to the ${secondRoute ? chipLabel(secondRoute) : 'vehicle'} at ${clock(departure.at)}`;
  return (
    <div role="listitem" class={`tf-row${tight ? ' tf-row--tight' : ''}${hidden ? ' tf-row--hidden' : ''}${pinned ? ' tf-row--pinned' : ''}${left ? ' tf-row--left' : ''}`}>
      <span class="tf-sr">{spoken}</span>
      {/* First, so what follows lies over it and takes no taps but its links' (see styles.css). */}
      <PinToggle pinned={pinned} label={pinLabel} onToggle={() => setPinned(!pinned)} />
      {/* Pinned says so in words where the countdown's kicker was. */}
      <Countdown
        lead={
          pinned ? (
            <>
              <IconPin filled size={13} />
              Pinned
            </>
          ) : left ? (
            'Left'
          ) : now ? (
            'Arriving'
          ) : (
            'Arrives in'
          )
        }
        num={left ? (ago < 1 ? 'Now' : ago) : now ? 'Now' : minutes}
        unit={left ? (ago >= 1 ? 'min ago' : null) : now ? null : 'min'}
      />
      {/* The spoken summary says everything shown, so screen readers skip the shown text and
          reach only the links in it. */}
      <div class="tf-row__main">
        <div class="tf-row__line">
          <RouteChip route={route} hidden />
          <TimeLink
            trip={connection.trip}
            stop={context.data.stops[context.data.from]}
            title={`${route ? chipLabel(route) : 'Vehicle'} at ${clock(connection.departs)}`}
            marks={marks}
            transfer={transfer}
            pin={{ pinned, label: pinLabel, set: setPinned }}
          >
            {clock(connection.departs)}
          </TimeLink>
        </div>
        <StatusTag status={status} plain hidden />
        <div class="tf-row__off">
          {/* Plain, to keep the row simple: the time above opens the same vehicle's map. */}
          <span class="tf-row__keep" aria-hidden="true">
            Off {clock(connection.arrives)}
          </span>
          {offAt && (
            <>
              <span aria-hidden="true"> at </span>
              <StopLink stop={context.data.stops[connection.alight!]}>{offAt}</StopLink>
            </>
          )}
          {/* Should the walk wrap, it moves whole, and the dot stays at the end of the line before. */}
          {walk && (
            <span aria-hidden="true">
              &nbsp;· <span class="tf-row__keep">{walk}</span>
            </span>
          )}
        </div>
      </div>
      <div class="tf-row__xfer" aria-hidden="true">
        <div class="tf-row__xfer-min">{connection.transfer}&nbsp;min</div>
        <div class="tf-row__xfer-label">transfer</div>
        {tight && <div class="tf-tight">TIGHT</div>}
        {hidden && <div class="tf-hidden-tag">{hidden.tag}</div>}
      </div>
      <TimeBar
        rideStart={context.pct(connection.departs)}
        rideEnd={context.pct(connection.arrives)}
        gapEnd={context.pct(departure.at)}
        busEnd={context.pct(secondEnd)}
        busColor={secondColor}
      />
    </div>
  );
}
