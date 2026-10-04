import { useId } from 'preact/hooks';
import type { Departure, Group } from '../../../shared/api.ts';
import { IconChevron } from '../icons/ui.tsx';
import { clock, minutesUntil } from '../format.ts';
import type { CardContext } from '../lib/results.ts';
import { TimeLink } from '../track.tsx';
import { chipLabel, spokenRoute, statusOf } from '../view.ts';
import { Collapse } from './Collapse.tsx';
import { ConnectionRow } from './ConnectionRow.tsx';
import { RouteChip } from './RouteChip.tsx';
import { StatusTag } from './StatusTag.tsx';
import { StopLink } from './StopLink.tsx';
import { TimeTicks } from './TimeBar.tsx';

// One second-leg departure: a reversed band, then every first vehicle that makes it. The band
// opens and closes the card. Closed, it keeps one line of countdowns for those vehicles.
export function DepartureCard({ departure, group, next, boardName, alightName, noun, walk, expanded, onToggle, colorOf, context }: {
  departure: Departure;
  group: Group;
  // The next departure still running, for the canceled note.
  next: Departure | undefined;
  boardName: string;
  alightName: string;
  noun: readonly [string, string];
  // A route already at or near From: the card is just the departure, with nothing to open.
  walk: boolean;
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
  const destinationName = context.destinationName ?? (walk ? context.toName : null);
  const destinationStop = context.destinationName ? context.destinationStop : walk ? context.toStop : undefined;
  const destination = destinationName && departure.destination ? `${destinationName} ${clock(departure.destination)}` : null;
  const toward = departure.toward ? `To ${departure.toward}` : null;
  const count = departure.connections.length;
  const countdowns = departure.connections.map(({ departs }) => Math.max(0, minutesUntil(departs, context.now)));
  const summary = `${count} ${noun[count === 1 ? 0 : 1]} · in ${countdowns.join(', ')} min`;
  const spoken =
    `${route ? spokenRoute(route) : 'Departure'} at ${clock(departure.at)}, ${status.label}, ` +
    `${minutes} minutes away${toward ? `, ${toward.toLowerCase()}` : ''}${destination ? `, reaches ${destination}` : ''}.` +
    (walk ? '' : ` ${count} connecting ${noun[count === 1 ? 0 : 1]}${expanded ? '' : `, leaving in ${countdowns.join(', ')} minutes`}.`);
  // The spoken summary says everything shown, so screen readers skip the shown text and reach
  // only the links in it.
  const band = (
    <>
      <span class="tf-band__main">
        <span class="tf-band__line">
          <RouteChip route={route} size="band" color={color} hidden />
          <span class="tf-band__time">
            <TimeLink trip={departure.trip} stop={context.data.stops[group.board]} title={`${route ? chipLabel(route) : 'Vehicle'} at ${clock(departure.at)}`} color={color}>
              {clock(departure.at)}
            </TimeLink>
          </span>
          <StatusTag status={status} hidden />
        </span>
        <span class="tf-band__sub" aria-hidden="true">
          {[toward, walk ? null : `Arrives at ${boardName}`].filter(Boolean).join(' · ')}
        </span>
        {destination && (
          <span class="tf-band__dest">
            <StopLink stop={destinationStop}>{destinationName}</StopLink>
            <span aria-hidden="true"> {clock(departure.destination!)}</span>
          </span>
        )}
      </span>
      <span class="tf-band__right" aria-hidden="true">
        <span class="tf-band__in">{minutes < 1 ? 'Now' : `${minutes} min`}</span>
        <span class="tf-band__inlabel">away</span>
        {!walk && (
          <span class="tf-band__chev">
            <IconChevron size={18} />
          </span>
        )}
      </span>
    </>
  );
  if (walk) {
    return (
      <article class="tf-card tf-card--walk">
        <h3 class="tf-card__heading">
          <span class="tf-band">
            <span class="tf-sr">{spoken}</span>
            {band}
          </span>
        </h3>
      </article>
    );
  }
  // The toggle is a button stretched under the whole band, rather than the band itself, so the
  // time and stop links in the band are their own targets and not buttons inside a button.
  return (
    <article class={`tf-card${expanded ? '' : ' tf-card--closed'}`}>
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
        <div role="list" aria-label={`Connecting ${noun[1]}`}>
          {departure.connections.map((connection) => (
            <ConnectionRow
              key={connection.trip}
              connection={connection}
              departure={departure}
              alightName={alightName}
              min={group.window.min}
              secondColor={color}
              context={context}
            />
          ))}
        </div>
      </Collapse>
      <Collapse open={!expanded}>
        <div class="tf-card__summary" aria-hidden="true">
          {summary}
        </div>
      </Collapse>
    </article>
  );
}
