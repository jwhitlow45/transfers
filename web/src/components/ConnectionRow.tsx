import type { Connection, Departure } from '../../../shared/api.ts';
import { clock, minutesUntil } from '../format.ts';
import { type CardContext, isTight } from '../lib/results.ts';
import { spokenRoute, statusOf } from '../view.ts';
import { RouteChip } from './RouteChip.tsx';
import { StatusTag } from './StatusTag.tsx';
import { TimeBar } from './TimeBar.tsx';

const HIDDEN = {
  short: { tag: 'Under min', spoken: 'shorter than your minimum' },
  long: { tag: 'Over max', spoken: 'longer than your maximum' },
  soon: { tag: 'Too soon', spoken: 'leaves before you can reach it' },
};

// One first vehicle under a departure. The countdown leads: when it reaches the From stop.
export function ConnectionRow({ connection, departure, alightName, min, secondColor, context }: {
  connection: Connection;
  departure: Departure;
  alightName: string;
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
  const spoken =
    `${route ? spokenRoute(route) : 'Vehicle'}, ${now ? 'arriving now' : `arrives in ${minutes} minute${minutes === 1 ? '' : 's'}`}, ${clock(connection.departs)}, ${status.label}. ` +
    `Off at ${alightName} ${clock(connection.arrives)}. ${connection.transfer} minute transfer${tight ? ', tight' : ''}${hidden ? `, hidden because it is ${hidden.spoken}` : ''}.`;
  const secondEnd = departure.destination ?? departure.at + 8 * 60;
  return (
    <div role="listitem" class={`tf-row${tight ? ' tf-row--tight' : ''}${hidden ? ' tf-row--hidden' : ''}`}>
      <span class="tf-sr">{spoken}</span>
      <div aria-hidden="true">
        <div class="tf-row__lead">{now ? 'Arriving' : 'Arrives in'}</div>
        <div class="tf-row__num">{now ? 'Now' : minutes}</div>
        {!now && <div class="tf-row__unit">min</div>}
      </div>
      <div class="tf-row__main" aria-hidden="true">
        <div class="tf-row__line">
          <RouteChip route={route} />
          <span>{clock(connection.departs)}</span>
        </div>
        <StatusTag status={status} plain />
        <div class="tf-row__off">
          Off at {alightName} {clock(connection.arrives)}
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
