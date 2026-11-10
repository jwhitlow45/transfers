import type { Connection, Departure } from '../../../shared/api.ts';
import { approx, atLeast, clock, hasLeft, minuteCount, minutesSince, minutesUntil, walkText } from '../format.ts';
import { connectionTrack } from '../lib/connection-map.ts';
import { pinOf, sameRun } from '../lib/pinned.ts';
import { type CardContext, isTight } from '../lib/results.ts';
import { TimeLink } from '../track.tsx';
import { shortStopName, spokenRoute, statusAt } from '../view.ts';
import { Num } from './Countdown.tsx';
import { Dots } from './Dots.tsx';
import { RouteChip } from './RouteChip.tsx';
import { StopLink } from './StopLink.tsx';
import { PinToggle } from './PinToggle.tsx';
import { PinnedTag, StatusTag } from './StatusTag.tsx';
import { useSettings } from '../settings.tsx';

const HIDDEN = {
  short: { tag: 'Under min', spoken: 'shorter than your minimum' },
  long: { tag: 'Over max', spoken: 'longer than your maximum' },
  soon: { tag: 'Too soon', spoken: 'leaves before you can reach it' },
};

// The map either vehicle of a transfer opens (see connectionTrack). Its departure's band opens it
// too, so on the results either vehicle's time shows both (J, 2026-11-09). Its sheet pins this
// transfer.
export function connectionMap(connection: Connection, departure: Departure, { alight, board, min, walkMeters, secondColor, context }: { alight: string; board: string; min: number; walkMeters: number; secondColor: string; context: CardContext }) {
  const { data, pin } = context;
  const { track, label, offStop } = connectionTrack(connection, departure, { data, alight, board, min, walkMeters, secondColor, destination: context.destination });
  // The same vehicles, stops, and run: trip ids repeat every day.
  const pinned = pin?.first?.trip === connection.trip && pin.first.alight === offStop && pin.second.trip === departure.trip && pin.second.board === board && sameRun(pin.at, departure.at);
  return { ...track, pin: { pinned, label, set: (on: boolean) => context.onPin(on ? pinOf(departure, board, { connection, alight: offStop }) : null) } };
}

// One first vehicle under a departure. The countdown leads, in the number column every row
// shares: when it reaches the From stop. Its time bar is on the map its time opens.
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
  const status = statusAt(connection.departs, context.now, connection.departDelay, connection.live, false, connection.notStarted);
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
  const map = connectionMap(connection, departure, { alight, board, min, walkMeters, secondColor, context });
  const { pinned, label, set: setPinned } = map.pin;
  const spoken =
    `${route ? spokenRoute(route) : 'Vehicle'}, ${left ? (ago < 1 ? 'just left' : `left ${ago} minute${ago === 1 ? '' : 's'} ago`) : now ? 'arriving now' : notStarted ? `arrives in at least ${minuteCount(Math.max(1, minutes))}` : `arrives in ${minutes} minute${minutes === 1 ? '' : 's'}`}, ${clock(connection.departs)}, ${status.label}. ` +
    `${boardAt ? `${boardAt}. ` : ''}Off at ${offAt ?? alightName} ${clock(connection.arrives)}${offScheduled ? ', scheduled' : ''}.${walk ? ` ${walk}.` : ''} ${transferScheduled ? 'Scheduled ' : ''}${connection.transfer} minute transfer${tight ? ', tight' : ''}${hidden ? `, hidden because it is ${hidden.spoken}` : ''}.${pinned ? ' Pinned.' : ''}`;
  return (
    <div role="listitem" class={`tf-row${tight ? ' tf-row--tight' : ''}${hidden ? ' tf-row--hidden' : ''}${pinned ? ' tf-row--pinned' : ''}${left ? ' tf-row--left' : ''}`}>
      <span class="tf-sr">{spoken}</span>
      {/* First, so what follows lies over it and takes no taps but its links' (see styles.css). */}
      <PinToggle pinned={pinned} label={label} onToggle={() => setPinned(!pinned)} />
      {/* A vehicle gone says so in a word, "Left", over how long ago (J, 2026-11-09): "32 min",
          which fits the column, as "Left" above it says it is past. */}
      <Num n={left ? 'Left' : now ? 'Now' : notStarted ? atLeast(minutes) : minutes} unit={left ? (ago < 1 ? 'just now' : `${ago}\u00a0min`) : now ? null : 'min'} />
      {/* The spoken summary says everything shown, so screen readers skip the shown text and
          reach only the links in it. */}
      <div class="tf-rb">
        <div class="tf-rb__main">
          <div class="tf-l1">
            <RouteChip route={route} hidden />
            <TimeLink {...map}>{clock(connection.departs)}</TimeLink>
          </div>
          <Dots
            class="tf-l2"
            tag="div"
            parts={[
              <StatusTag status={status} plain hidden />,
              <>
                {/* Plain, to keep the row simple: the time above opens the same vehicle's map. */}
                <span class="tf-nowrap" aria-hidden="true">
                  off {approx(clock(connection.arrives), offScheduled)}
                </span>
                {/* A vehicle that lets the rider off elsewhere than the group's stop says where, and
                    its own walk from there. The group's heading says the usual ones once. */}
                {offAt && (
                  <>
                    <span aria-hidden="true"> at </span>
                    <StopLink stop={context.data.stops[connection.alight!]}>{offAt}</StopLink>
                  </>
                )}
              </>,
              offAt && walk && (
                <span class="tf-nowrap" aria-hidden="true">
                  {walk}
                </span>
              ),
            ]}
          />
          {boardAt && (
            <div class="tf-l2">
              <StopLink stop={boardStop}>{boardAt}</StopLink>
            </div>
          )}
          {pinned && (
            <div class="tf-l2" aria-hidden="true">
              <PinnedTag />
            </div>
          )}
        </div>
        <div class="tf-end" aria-hidden="true">
          <span class="tf-end__n">{approx(String(connection.transfer), transferScheduled)}&nbsp;min</span>
          <span class="tf-end__u">transfer</span>
          {tight && <span class="tf-tight">Tight</span>}
          {hidden && <span class="tf-hidden-tag">{hidden.tag}</span>}
        </div>
      </div>
    </div>
  );
}
