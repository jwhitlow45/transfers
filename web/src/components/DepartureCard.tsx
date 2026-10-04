import type { Departure, Group } from '../../../shared/api.ts';
import { IconClock } from '../icons/ui.tsx';
import { clock, minutesUntil } from '../format.ts';
import type { CardContext } from '../lib/results.ts';
import { chipLabel, spokenRoute, statusOf } from '../view.ts';
import { ConnectionRow } from './ConnectionRow.tsx';
import { RouteChip } from './RouteChip.tsx';
import { StatusTag } from './StatusTag.tsx';
import { TimeTicks } from './TimeBar.tsx';

// One second-leg departure: a reversed band, then every first vehicle that makes it.
export function DepartureCard({ departure, group, next, boardName, alightName, colorOf, context }: {
  departure: Departure;
  group: Group;
  // The next departure still running, for the canceled note.
  next: Departure | undefined;
  boardName: string;
  alightName: string;
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
  const spoken =
    `${route ? spokenRoute(route) : 'Departure'} at ${clock(departure.at)}, ${status.label}${scheduled ? ', no live prediction' : ''}, ` +
    `${minutes} minutes away${destination ? `, reaches ${destination}` : ''}. ${count} connection${count === 1 ? '' : 's'}.`;
  return (
    <article class="tf-card" aria-label={spoken}>
      <h3 class="tf-sr">{spoken}</h3>
      <div class="tf-band" aria-hidden="true">
        <div class="tf-band__main">
          <div class="tf-band__line">
            <RouteChip route={route} size="band" color={color} />
            {scheduled && <IconClock />}
            <span class="tf-band__time">{clock(departure.at)}</span>
            <StatusTag status={status} />
          </div>
          <div class="tf-band__sub">
            {scheduled ? 'Scheduled time, no live prediction' : `Arrives at ${boardName}`}
            {destination && ` · ${destination}`}
          </div>
        </div>
        <div class="tf-band__right">
          <div class="tf-band__in">{minutes < 1 ? 'Now' : `${scheduled ? '~' : ''}${minutes} min`}</div>
          <div class="tf-band__inlabel">{scheduled ? 'by schedule' : 'away'}</div>
        </div>
      </div>
      <TimeTicks scaleMinutes={context.scaleMinutes} />
      <div role="list" aria-label="Connecting vehicles">
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
    </article>
  );
}
