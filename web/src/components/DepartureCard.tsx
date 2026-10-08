import { useId } from 'preact/hooks';
import type { Departure, Group } from '../../../shared/api.ts';
import { IconChevron, IconPin } from '../icons/ui.tsx';
import { clock, minutesUntil } from '../format.ts';
import { pinOf, sameRun } from '../lib/pinned.ts';
import { type CardContext, hintKey } from '../lib/results.ts';
import { TimeLink } from '../track.tsx';
import { chipLabel, shortStopName, spokenRoute, statusOf } from '../view.ts';
import { Collapse } from './Collapse.tsx';
import { ConnectionRow } from './ConnectionRow.tsx';
import { Departed } from './Departed.tsx';
import { PinToggle } from './PinToggle.tsx';
import { RouteChip } from './RouteChip.tsx';
import { StatusTag } from './StatusTag.tsx';
import { TimeTicks } from './TimeBar.tsx';

// One second-leg departure: a reversed band, then every first vehicle that makes it. The band
// opens and closes the card. Closed, it keeps one line of countdowns for those vehicles.
export function DepartureCard({ departure, group, next, boardName, alightName, noun, walk, allLeft = false, expanded, onToggle, colorOf, context }: {
  departure: Departure;
  group: Group;
  // The next departure still running, for the canceled note.
  next: Departure | undefined;
  boardName: string;
  alightName: string;
  noun: readonly [string, string];
  // A route already at or near From: the card is just the departure, with nothing to open.
  walk: boolean;
  // Every vehicle on the card has left, so it sits among those departed and folds none of its own.
  allLeft?: boolean;
  expanded: boolean;
  onToggle: () => void;
  colorOf: (routeKey: string) => string;
  context: CardContext;
}) {
  const route = context.data.routes[departure.route];
  const color = colorOf(departure.route);
  // One trip can appear in two groups, such as BART's and Muni Metro's at a shared station.
  const panel = useId();
  if (departure.canceled) {
    return (
      <div class="tf-canceled">
        <RouteChip route={route} color={color} />
        <span class="tf-canceled__time">{clock(departure.at)}</span>
        <StatusTag status={statusOf(null, true, true)} />
        <span class="tf-canceled__note">
          Not counted.{next && ` Next ${route ? chipLabel(route) : ''} toward ${group.headsign} at ${clock(next.at)}.`}
        </span>
      </div>
    );
  }
  const status = statusOf(departure.delay, departure.live);
  const minutes = minutesUntil(departure.at, context.now);
  // Left where the rider boards it, on its way to the destination: kept so a rider on it can
  // still pin it.
  const left = departure.at * 1000 < context.now;
  const ago = Math.floor((context.now - departure.at * 1000) / 60_000);
  const away = left ? (ago < 1 ? 'Just left' : `Left ${ago} min ago`) : null;
  // With no first vehicle, the departure itself is the trip to pin, by tapping its band.
  const walkPinned = walk && context.pin !== null && !context.pin.first && context.pin.second.trip === departure.trip && context.pin.second.board === group.board && sameRun(context.pin.at, departure.at);
  const setWalkPinned = (on: boolean) => context.onPin(on ? pinOf(departure, group.board) : null);
  const walkPinLabel = `the ${route ? chipLabel(route) : 'vehicle'} at ${clock(departure.at)}`;
  const destinationName = context.destinationName ?? (walk ? context.toName : null);
  const destination = destinationName && departure.destination ? `${destinationName} ${clock(departure.destination)}` : null;
  const toward = departure.toward ? `To ${departure.toward}` : null;
  const count = departure.connections.length;
  const countdowns = departure.connections.filter(({ departs }) => departs * 1000 >= context.now).map(({ departs }) => Math.max(0, minutesUntil(departs, context.now)));
  const gone = count - countdowns.length;
  const summary = [`${count} ${noun[count === 1 ? 0 : 1]}`, gone > 0 && `${gone} departed`, countdowns.length > 0 && `in ${countdowns.join(', ')}\u00a0min`].filter(Boolean).join(' · ');
  const spoken =
    `${route ? spokenRoute(route) : 'Departure'} at ${clock(departure.at)}, ${status.label}, ` +
    `${away ? away.toLowerCase() : `${minutes} minutes away`}${toward ? `, ${toward.toLowerCase()}` : ''}${destination ? `, reaches ${destination}` : ''}.` +
    (walk ? '' : ` ${count} connecting ${noun[count === 1 ? 0 : 1]}${expanded ? '' : [gone > 0 && `, ${gone} already left`, countdowns.length > 0 && `, leaving in ${countdowns.join(', ')} minutes`].filter(Boolean).join('')}.`);
  // The spoken summary says everything shown, so screen readers skip the shown text and reach
  // only the links in it.
  const band = (
    <>
      <span class="tf-band__main">
        <span class="tf-band__line">
          <RouteChip route={route} size="band" color={color} hidden />
          <span class="tf-band__time">
            <TimeLink
              trip={departure.trip}
              stop={context.data.stops[group.board]}
              title={`${route ? chipLabel(route) : 'Vehicle'} at ${clock(departure.at)}`}
              color={color}
              // A route already at From is boarded there. Otherwise the rider boards it where they
              // transfer, and From shows only if this route passes it too.
              marks={walk ? [{ stop: group.board, kind: 'yours' }] : [{ stop: context.data.from, kind: 'yours' }, { stop: group.board, kind: 'transfer' }]}
              // A band with rows under it pins no one trip, so only a walk card's map can pin.
              {...(walk ? { pin: { pinned: walkPinned, label: walkPinLabel, set: setWalkPinned } } : {})}
            >
              {clock(departure.at)}
            </TimeLink>
          </span>
          <StatusTag status={status} hidden />
        </span>
        <span class="tf-band__sub" aria-hidden="true">
          {[toward, walk ? null : `Arrives at ${boardName}`].filter(Boolean).join(' · ')}
        </span>
        {destination && (
          <span class="tf-band__dest" aria-hidden="true">
            {destination}
          </span>
        )}
      </span>
      <span class="tf-band__right" aria-hidden="true">
        {/* Read top to bottom: "12 min away", "Now arriving", "Just left", "3 min ago". */}
        <span class="tf-band__in">{left ? (ago < 1 ? 'Just' : `${ago}\u00a0min`) : minutes < 1 ? 'Now' : `${minutes}\u00a0min`}</span>
        {walkPinned ? (
          <span class="tf-band__inlabel tf-band__inlabel--pinned">
            <IconPin filled size={13} />
            Pinned
          </span>
        ) : (
          <span class="tf-band__inlabel">{left ? (ago < 1 ? 'left' : 'ago') : minutes < 1 ? 'arriving' : 'away'}</span>
        )}
        {!walk && (
          <span class="tf-band__chev">
            <IconChevron size={18} />
          </span>
        )}
      </span>
    </>
  );
  const row = (connection: (typeof departure.connections)[number]) => (
    <ConnectionRow
      key={connection.trip}
      connection={connection}
      departure={departure}
      alightName={alightName}
      alight={group.alight}
      board={group.board}
      min={group.window.min}
      walkMeters={group.walkMeters}
      secondColor={color}
      context={context}
    />
  );
  if (walk) {
    return (
      <article class={`tf-card tf-card--walk${left ? ' tf-card--left' : ''}`}>
        <h3 class="tf-card__heading">
          <span class={`tf-band${walkPinned ? ' tf-band--pinned' : ''}`}>
            <span class="tf-sr">{spoken}</span>
            <PinToggle pinned={walkPinned} label={walkPinLabel} onToggle={() => setWalkPinned(!walkPinned)} />
            {band}
          </span>
        </h3>
      </article>
    );
  }
  // The toggle is a button stretched under the whole band, rather than the band itself, so the
  // time and stop links in the band are their own targets and not buttons inside a button.
  return (
    <article class={`tf-card${expanded ? '' : ' tf-card--closed'}${left ? ' tf-card--left' : ''}`}>
      <h3 class="tf-card__heading">
        <span class="tf-band">
          <button type="button" class="tf-band__toggle" aria-expanded={expanded} aria-controls={panel} onClick={onToggle}>
            <span class="tf-sr">{spoken}</span>
          </button>
          {band}
        </span>
      </h3>
      {/* The rows and the closed card's one-line summary each slide, so they trade places
          smoothly. */}
      <Collapse open={expanded} id={panel}>
        <TimeTicks scaleMinutes={context.scaleMinutes} />
        {context.pinHint !== null && context.pinHint === hintKey(group, departure.trip) && (
          <p class="tf-pin-hint">
            <IconPin size={14} />
            Tap a connection to pin it to the top
          </p>
        )}
        {gone > 0 && !allLeft ? (
          <>
            <Departed count={gone} place={shortStopName(context.data.stops[context.data.from], context.data.from)}>
              <div role="list" aria-label={`Departed ${noun[gone === 1 ? 0 : 1]}`}>
                {departure.connections.filter(({ departs }) => departs * 1000 < context.now).map(row)}
              </div>
            </Departed>
            <div role="list" aria-label={`Connecting ${noun[1]}`}>
              {departure.connections.filter(({ departs }) => departs * 1000 >= context.now).map(row)}
            </div>
          </>
        ) : (
          <div role="list" aria-label={`Connecting ${noun[1]}`}>
            {departure.connections.map(row)}
          </div>
        )}
      </Collapse>
      <Collapse open={!expanded}>
        <div class="tf-card__summary" aria-hidden="true">
          {summary}
        </div>
      </Collapse>
    </article>
  );
}
