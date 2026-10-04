import type { Connection, Departure } from '../../../shared/api.ts';
import { clock, minutesUntil } from '../format.ts';
import { type CardContext, isTight } from '../lib/results.ts';
import { TimeLink } from '../track.tsx';
import { chipLabel, shortStopName, spokenRoute, statusOf } from '../view.ts';
import { RouteChip } from './RouteChip.tsx';
import { StopLink } from './StopLink.tsx';
import { StatusTag } from './StatusTag.tsx';
import { TimeBar } from './TimeBar.tsx';

const HIDDEN = {
  short: { tag: 'Under min', spoken: 'shorter than your minimum' },
  long: { tag: 'Over max', spoken: 'longer than your maximum' },
  soon: { tag: 'Too soon', spoken: 'leaves before you can reach it' },
};

// One first vehicle under a departure. The countdown leads: when it reaches the From stop.
export function ConnectionRow({ connection, departure, alightName, alight, min, secondColor, context }: {
  connection: Connection;
  departure: Departure;
  alightName: string;
  // The group's stop key for where riders get off, unless this vehicle names its own.
  alight: string;
  min: number;
  secondColor: string;
  context: CardContext;
}) {
  const route = context.data.routes[connection.route];
  const minutes = minutesUntil(connection.departs, context.now);
  const now = minutes < 1;
  const status = statusOf(connection.departDelay, connection.live);
  const tight = isTight(connection, min);
  const hidden = connection.hidden ? HIDDEN[connection.hidden] : null;
  // A pooled group's vehicles can let the rider off at different stops. The group names its
  // usual one, and a row says its own when it differs.
  const offAt = connection.alight ? shortStopName(context.data.stops[connection.alight], '') : null;
  const spoken =
    `${route ? spokenRoute(route) : 'Vehicle'}, ${now ? 'arriving now' : `arrives in ${minutes} minute${minutes === 1 ? '' : 's'}`}, ${clock(connection.departs)}, ${status.label}. ` +
    `Off at ${offAt ?? alightName} ${clock(connection.arrives)}. ${connection.transfer} minute transfer${tight ? ', tight' : ''}${hidden ? `, hidden because it is ${hidden.spoken}` : ''}.`;
  const secondEnd = departure.destination ?? departure.at + 8 * 60;
  // Both of this vehicle's times open its map with where the rider gets on and where they get off
  // to transfer marked.
  const offStop = connection.alight ?? alight;
  const marks = [
    { stop: context.data.from, kind: 'yours' as const },
    { stop: offStop, kind: 'transfer' as const },
  ];
  return (
    <div role="listitem" class={`tf-row${tight ? ' tf-row--tight' : ''}${hidden ? ' tf-row--hidden' : ''}`}>
      <span class="tf-sr">{spoken}</span>
      <div aria-hidden="true">
        <div class="tf-row__lead">{now ? 'Arriving' : 'Arrives in'}</div>
        <div class="tf-row__num">{now ? 'Now' : minutes}</div>
        {!now && <div class="tf-row__unit">min</div>}
      </div>
      {/* The spoken summary says everything shown, so screen readers skip the shown text and
          reach only the links in it. */}
      <div class="tf-row__main">
        <div class="tf-row__line">
          <RouteChip route={route} hidden />
          <TimeLink trip={connection.trip} stop={context.data.stops[context.data.from]} title={`${route ? chipLabel(route) : 'Vehicle'} at ${clock(connection.departs)}`} marks={marks}>
            {clock(connection.departs)}
          </TimeLink>
        </div>
        <StatusTag status={status} plain hidden />
        <div class="tf-row__off">
          <span aria-hidden="true">Off </span>
          <TimeLink trip={connection.trip} stop={context.data.stops[offStop]} title={`${route ? chipLabel(route) : 'Vehicle'} at ${clock(connection.arrives)}`} marks={marks}>
            {clock(connection.arrives)}
          </TimeLink>
          {offAt && (
            <>
              <span aria-hidden="true"> at </span>
              <StopLink stop={context.data.stops[connection.alight!]}>{offAt}</StopLink>
            </>
          )}
        </div>
      </div>
      <div class="tf-row__xfer" aria-hidden="true">
        <div class="tf-row__xfer-min">{connection.transfer} min</div>
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
