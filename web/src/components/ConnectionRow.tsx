import type { Connection, Departure } from '../../../shared/api.ts';
import { approx, atLeast, clock, hasLeft, minuteCount, minutesSince, minutesUntil, walkText } from '../format.ts';
import { pinOf, sameRun } from '../lib/pinned.ts';
import { type CardContext, isTight } from '../lib/results.ts';
import { IconPin } from '../icons/ui.tsx';
import { TimeLink } from '../track.tsx';
import { pinLabel, shortStopName, spokenRoute, statusOf, vehicleAt } from '../view.ts';
import { Countdown } from './Countdown.tsx';
import { RouteChip } from './RouteChip.tsx';
import { StopLink } from './StopLink.tsx';
import { PinToggle } from './PinToggle.tsx';
import { StatusTag } from './StatusTag.tsx';
import { TimeBar } from './TimeBar.tsx';
import { useSettings } from '../settings.tsx';

const HIDDEN = {
  short: { tag: 'Under min', spoken: 'shorter than your minimum' },
  long: { tag: 'Over max', spoken: 'longer than your maximum' },
  soon: { tag: 'Too soon', spoken: 'leaves before you can reach it' },
};

// The map either vehicle of a transfer opens: the first, with where the rider gets on and where they
// get off to transfer marked, and the second drawn on the same map, on to the destination. Its
// departure's band opens it too, so on the results either vehicle's time shows both (J,
// 2026-11-09). Its sheet pins this transfer. A first vehicle the schedule lacks has no line to
// draw, so the map follows the second alone, to where the rider boards it.
export function connectionMap(connection: Connection, departure: Departure, { alight, board, min, secondColor, context }: { alight: string; board: string; min: number; secondColor: string; context: CardContext }) {
  const { data, pin } = context;
  const route = data.routes[connection.route];
  const offStop = connection.alight ?? alight;
  const transferScheduled = !connection.live || Boolean(connection.arrivesScheduled) || !departure.live;
  const destination = departure.destination !== undefined ? context.destination : undefined;
  // The same vehicles, stops, and run: trip ids repeat every day.
  const pinned = pin?.first?.trip === connection.trip && pin.first.alight === offStop && pin.second.trip === departure.trip && pin.second.board === board && sameRun(pin.at, departure.at);
  const pinAction = {
    pinned,
    label: pinLabel([route, connection.departs], [data.routes[departure.route], departure.at]),
    set: (on: boolean) => context.onPin(on ? pinOf(departure, board, { connection, alight: offStop }) : null),
  };
  if (connection.added) {
    return {
      trip: departure.trip,
      stop: data.stops[board],
      title: vehicleAt(data.routes[departure.route], departure.at),
      color: secondColor,
      marks: [{ stop: board, kind: 'transfer' as const }],
      pin: pinAction,
    };
  }
  return {
    trip: connection.trip,
    stop: (connection.board ? data.stops[connection.board] : undefined) ?? data.stops[data.from],
    title: vehicleAt(route, connection.departs),
    marks: [
      { stop: connection.board ?? data.from, kind: 'yours' as const },
      { stop: offStop, kind: 'transfer' as const },
    ],
    transfer: { trip: departure.trip, stop: board, color: secondColor, minutes: connection.transfer, scheduled: transferScheduled, ...(connection.hidden ? {} : { min }), ...(destination ? { destination } : {}) },
    pin: pinAction,
  };
}

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
  const left = hasLeft(connection.departs, context.now, connection.notStarted);
  const ago = minutesSince(connection.departs, context.now);
  // A vehicle yet to leave the first stop of its trip cannot be arriving now (see atLeast).
  const notStarted = !left && connection.notStarted === true;
  const now = !left && minutes < 1 && !notStarted;
  const status = statusOf(connection.departDelay, connection.live, false, connection.notStarted);
  // Where the rider gets off, and so the transfer, can be the schedule's even on a live vehicle.
  const offScheduled = !connection.live || Boolean(connection.arrivesScheduled);
  const transferScheduled = offScheduled || !departure.live;
  const tight = isTight(connection, min);
  const hidden = connection.hidden ? HIDDEN[connection.hidden] : null;
  // A pooled group's vehicles can let the rider off at different stops. The group names its
  // usual one, and a row says its own when it differs.
  const offAt = connection.alight ? shortStopName(context.data.stops[connection.alight], '') : null;
  // Going to a stop, a vehicle that picks the rider up on From's corner says where: by name, or
  // where that is From's own too, as across the street, by its stop number and direction.
  const boardStop = connection.board ? context.data.stops[connection.board] : undefined;
  const fromStop = context.data.stops[context.data.from];
  const boardAt = !boardStop
    ? null
    : boardStop.name === fromStop?.name && boardStop.code
      ? `Board at stop ${boardStop.code}${boardStop.direction ? `, ${boardStop.direction.toLowerCase()}` : ''}`
      : `Board at ${shortStopName(boardStop, '')}`;
  // The walk to the second vehicle, said where the rider gets off (J, 2026-10-08). None at its stop.
  const walk = walkText(connection.walkMeters ?? walkMeters, useSettings().settings.walkSpeed);
  const spoken =
    `${route ? spokenRoute(route) : 'Vehicle'}, ${left ? (ago < 1 ? 'just left' : `left ${ago} minute${ago === 1 ? '' : 's'} ago`) : now ? 'arriving now' : notStarted ? `arrives in at least ${minuteCount(Math.max(1, minutes))}` : `arrives in ${minutes} minute${minutes === 1 ? '' : 's'}`}, ${clock(connection.departs)}, ${status.label}. ` +
    `${boardAt ? `${boardAt}. ` : ''}Off at ${offAt ?? alightName} ${clock(connection.arrives)}${offScheduled ? ', scheduled' : ''}.${walk ? ` ${walk}.` : ''} ${transferScheduled ? 'Scheduled ' : ''}${connection.transfer} minute transfer${tight ? ', tight' : ''}${hidden ? `, hidden because it is ${hidden.spoken}` : ''}.`;
  const secondEnd = departure.destination ?? departure.at + 8 * 60;
  const map = connectionMap(connection, departure, { alight, board, min, secondColor, context });
  const { pinned, label, set: setPinned } = map.pin;
  return (
    <div role="listitem" class={`tf-row${tight ? ' tf-row--tight' : ''}${hidden ? ' tf-row--hidden' : ''}${pinned ? ' tf-row--pinned' : ''}${left ? ' tf-row--left' : ''}`}>
      <span class="tf-sr">{spoken}</span>
      {/* First, so what follows lies over it and takes no taps but its links' (see styles.css). */}
      <PinToggle pinned={pinned} label={label} onToggle={() => setPinned(!pinned)} />
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
        num={left ? (ago < 1 ? 'Now' : ago) : now ? 'Now' : notStarted ? atLeast(minutes) : minutes}
        unit={left ? (ago >= 1 ? 'min ago' : null) : now ? null : 'min'}
      />
      {/* The spoken summary says everything shown, so screen readers skip the shown text and
          reach only the links in it. */}
      <div class="tf-row__main">
        <div class="tf-row__line">
          <RouteChip route={route} hidden />
          <TimeLink {...map}>{clock(connection.departs)}</TimeLink>
        </div>
        <StatusTag status={status} plain hidden />
        {boardAt && (
          <div class="tf-row__off">
            <StopLink stop={boardStop}>{boardAt}</StopLink>
          </div>
        )}
        <div class="tf-row__off">
          {/* Plain, to keep the row simple: the time above opens the same vehicle's map. */}
          <span class="tf-row__keep" aria-hidden="true">
            Off {approx(clock(connection.arrives), offScheduled)}
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
        <div class="tf-row__xfer-min">{approx(String(connection.transfer), transferScheduled)}&nbsp;min</div>
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
