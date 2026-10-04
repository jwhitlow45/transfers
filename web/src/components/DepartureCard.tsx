import type { Departure, Group } from '../../../shared/api.ts';
import { IconChevron, IconClock } from '../icons/ui.tsx';
import { clock, minutesUntil } from '../format.ts';
import type { CardContext } from '../lib/results.ts';
import { chipLabel, spokenRoute, statusOf } from '../view.ts';
import { ConnectionRow } from './ConnectionRow.tsx';
import { RouteChip } from './RouteChip.tsx';
import { StatusTag } from './StatusTag.tsx';
import { TimeTicks } from './TimeBar.tsx';

// One second-leg departure: a reversed band, then every first vehicle that makes it. The band
// opens and closes the card. Closed, it keeps one line of countdowns for those vehicles.
export function DepartureCard({ departure, group, next, boardName, alightName, noun, expanded, onToggle, colorOf, context }: {
  departure: Departure;
  group: Group;
  // The next departure still running, for the canceled note.
  next: Departure | undefined;
  boardName: string;
  alightName: string;
  noun: readonly [string, string];
  expanded: boolean;
  onToggle: () => void;
  colorOf: (routeKey: string) => string;
  context: CardContext;
}) {
  const route = context.data.routes[departure.route];
  const color = colorOf(departure.route);
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
  const scheduled = !departure.live;
  const status = statusOf(departure.delay, departure.live);
  const minutes = minutesUntil(departure.at, context.now);
  const destination = context.destinationName && departure.destination ? `${context.destinationName} ${clock(departure.destination)}` : null;
  const count = departure.connections.length;
  const countdowns = departure.connections.map(({ departs }) => Math.max(0, minutesUntil(departs, context.now)));
  const summary = `${count} ${noun[count === 1 ? 0 : 1]} · in ${countdowns.join(', ')} min`;
  const spoken =
    `${route ? spokenRoute(route) : 'Departure'} at ${clock(departure.at)}, ${status.label}${scheduled ? ', no live prediction' : ''}, ` +
    `${minutes} minutes away${destination ? `, reaches ${destination}` : ''}. ${count} connecting ${noun[count === 1 ? 0 : 1]}${expanded ? '' : `, leaving in ${countdowns.join(', ')} minutes`}.`;
  const panel = `connections-${departure.trip.replace(/[^\w-]/g, '_')}`;
  return (
    <article class={`tf-card${expanded ? '' : ' tf-card--closed'}`}>
      <h3 class="tf-card__heading">
        <button type="button" class="tf-band" aria-expanded={expanded} aria-controls={panel} onClick={onToggle}>
          <span class="tf-sr">{spoken}</span>
          <span class="tf-band__main" aria-hidden="true">
            <span class="tf-band__line">
              <RouteChip route={route} size="band" color={color} />
              {scheduled && <IconClock />}
              <span class="tf-band__time">{clock(departure.at)}</span>
              <StatusTag status={status} />
            </span>
            <span class="tf-band__sub">{scheduled ? 'Scheduled time, no live prediction' : `Arrives at ${boardName}`}</span>
            {destination && <span class="tf-band__dest">{destination}</span>}
          </span>
          <span class="tf-band__right" aria-hidden="true">
            <span class="tf-band__in">{minutes < 1 ? 'Now' : `${scheduled ? '~' : ''}${minutes} min`}</span>
            <span class="tf-band__inlabel">{scheduled ? 'by schedule' : 'away'}</span>
            <span class="tf-band__chev">
              <IconChevron size={18} />
            </span>
          </span>
        </button>
      </h3>
      <div id={panel}>
        {expanded ? (
          <>
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
          </>
        ) : (
          <div class="tf-card__summary" aria-hidden="true">
            {summary}
          </div>
        )}
      </div>
    </article>
  );
}
