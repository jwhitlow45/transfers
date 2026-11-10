import type { ComponentChildren } from 'preact';
import type { NearbyArrival, NearbyStop, Route, Stop } from '../../../shared/api.ts';
import { atLeast, clock, minutesUntil, stillWaiting } from '../format.ts';
import { TimeLink, type PinAction } from '../track.tsx';
import { pinLabel, spokenRoute, statusAt, vehicleAt } from '../view.ts';
import { PinToggle } from './PinToggle.tsx';
import { RouteChip } from './RouteChip.tsx';
import { PinnedTag, StatusTag } from './StatusTag.tsx';
import { Num } from './Countdown.tsx';

// Nearby's rows and a stop's page share these: a heading and a card for each route and direction
// boarding at a stop, and a row for each arrival.

export const rowKey = (row: NearbyStop) => `${row.stop}|${row.routes.join(',')}|${row.direction}`;

// Each row with the arrivals that have not gone by since the latest times came. One yet to leave
// the first stop of its trip has not, whatever its time (see stillWaiting).
export const upcoming = (rows: NearbyStop[], now: number) => rows.map((row) => ({ row, arrivals: row.arrivals.filter(({ at, notStarted }) => minutesUntil(at, now) >= 0 || stillWaiting(at, now, notStarted)) }));

export const routesOf = (row: NearbyStop, routes: Record<string, Route>) => row.routes.map((key) => routes[key]).filter((route) => route !== undefined);

// Its routes and where they go as a heading on the page, `marker` before them and `meta` under
// them, then a card holding `children`: its arrivals, each a row. Several BART lines on one
// platform go by their names, as their chips alone do not tell them apart.
export function RouteCard({ routes, headsign, marker, meta, children }: { routes: Route[]; headsign: string; marker?: ComponentChildren; meta?: ComponentChildren; children: ComponentChildren }) {
  return (
    <section class="tf-near" aria-label={`${routes.map(({ name }) => name).join(', ')} toward ${headsign}`}>
      <div>
        <h2 class="tf-group__title">
          {marker}
          {routes.map((route) => (
            <RouteChip key={route.key} route={route} iconSize={18} label={routes.length > 1 && route.agency === 'BA' ? route.name : undefined} />
          ))}
          <span class="tf-to">
            <span aria-hidden="true">→</span>
            <span>
              <span class="tf-sr">toward </span>
              {headsign}
            </span>
          </span>
        </h2>
        {meta && <div class="tf-group__meta">{meta}</div>}
      </div>
      <div class="tf-card">{children}</div>
    </section>
  );
}

// An arrival at `board`, as a row of the shape every page shares: the minutes until it comes in
// the number column, then its route when the card has several and its time, which opens its map,
// and its status on the line under the time. With `pin`, a tap anywhere else on it pins it.
export function ArrivalItem({ arrival, route, chip, stop, board, now, pin }: {
  arrival: NearbyArrival;
  route: Route | undefined;
  chip: boolean;
  stop: Stop | undefined;
  board: string;
  now: number;
  pin?: { pinned: boolean; set: (on: boolean) => void };
}) {
  const action: PinAction | undefined = pin && { ...pin, label: pinLabel([route, arrival.at]) };
  const status = statusAt(arrival.at, now, arrival.delay, arrival.live, false, arrival.notStarted);
  const minutes = minutesUntil(arrival.at, now);
  // A vehicle yet to leave the first stop of its trip cannot be arriving now (see atLeast).
  const notStarted = stillWaiting(arrival.at, now, arrival.notStarted);
  const soon = minutes < 1 && !notStarted;
  const count = Math.max(1, minutes);
  const spoken = `${chip && route ? `${spokenRoute(route)}, ` : ''}${soon ? 'Arriving now' : `In ${notStarted ? 'at least ' : ''}${count} minute${count === 1 ? '' : 's'}`}, ${clock(arrival.at)}, ${status.label.toLowerCase()}.${pin?.pinned ? ' Pinned.' : ''}`;
  return (
    <li class={`tf-row${pin?.pinned ? ' tf-row--pinned' : ''}`}>
      <span class="tf-sr">{spoken}</span>
      {/* First, so what follows lies over it and takes no taps but its time's (see styles.css). */}
      {action && <PinToggle pinned={action.pinned} label={action.label} onToggle={() => action.set(!action.pinned)} />}
      <Num n={soon ? 'Now' : notStarted ? atLeast(minutes) : minutes} unit={soon ? null : 'min'} />
      <div class="tf-rb">
        <div class="tf-rb__main">
          <div class="tf-l1">
            {chip && <RouteChip route={route} size="sm" label={route?.agency === 'BA' ? route.name : undefined} hidden />}
            <TimeLink trip={arrival.trip} stop={stop} title={vehicleAt(route, arrival.at)} marks={[{ stop: board, kind: 'yours' }]} pin={action}>
              {clock(arrival.at)}
            </TimeLink>
          </div>
          <div class="tf-l2" aria-hidden="true">
            <StatusTag status={status} plain />
          </div>
          {pin?.pinned && (
            <div class="tf-l2" aria-hidden="true">
              <PinnedTag />
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
