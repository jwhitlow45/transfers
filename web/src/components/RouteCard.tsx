import type { ComponentChildren } from 'preact';
import type { NearbyArrival, NearbyStop, Route, Stop } from '../../../shared/api.ts';
import { clock, minutesUntil, untilText } from '../format.ts';
import { TimeLink, type PinAction } from '../track.tsx';
import { pinLabel, statusOf, vehicleAt } from '../view.ts';
import { PinToggle } from './PinToggle.tsx';
import { RouteChip } from './RouteChip.tsx';
import { StatusTag } from './StatusTag.tsx';

// Nearby's rows and a stop's page share these: a card for each route and direction boarding at a
// stop, and a line for each arrival.

export const rowKey = (row: NearbyStop) => `${row.stop}|${row.routes.join(',')}|${row.direction}`;

// Each row with the arrivals that have not gone by since the latest times came.
export const upcoming = (rows: NearbyStop[], now: number) => rows.map((row) => ({ row, arrivals: row.arrivals.filter(({ at }) => minutesUntil(at, now) >= 0) }));

export const routesOf = (row: NearbyStop, routes: Record<string, Route>) => row.routes.map((key) => routes[key]).filter((route) => route !== undefined);

// Its routes and where they go, `marker` before them and `meta` under them, then `children`.
// Several BART lines on one platform go by their names, as their chips alone do not tell them apart.
export function RouteCard({ routes, headsign, marker, meta, children }: { routes: Route[]; headsign: string; marker?: ComponentChildren; meta?: ComponentChildren; children: ComponentChildren }) {
  return (
    <article class="tf-near" aria-label={`${routes.map(({ name }) => name).join(', ')} toward ${headsign}`}>
      <div class="tf-near__head">
        <h2 class="tf-group__title">
          {marker}
          {routes.map((route) => (
            <RouteChip key={route.key} route={route} iconSize={18} label={routes.length > 1 && route.agency === 'BA' ? route.name : undefined} />
          ))}
          <span>
            <span aria-hidden="true">→ </span>
            <span class="tf-sr">toward </span>
            {headsign}
          </span>
        </h2>
        {meta && <div class="tf-group__meta">{meta}</div>}
      </div>
      {children}
    </article>
  );
}

// An arrival at `board`: its route when the card has several, its time, which opens its map, its
// status, and the minutes until it comes. With `pin`, a tap anywhere else on it pins it.
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
  return (
    <li class={pin?.pinned ? 'tf-arrival--pinned' : undefined}>
      {action && <PinToggle pinned={action.pinned} label={action.label} onToggle={() => action.set(!action.pinned)} />}
      {chip && <RouteChip route={route} size="sm" label={route?.agency === 'BA' ? route.name : undefined} />}
      <span class="tf-near__time">
        <TimeLink trip={arrival.trip} stop={stop} title={vehicleAt(route, arrival.at)} marks={[{ stop: board, kind: 'yours' }]} pin={action}>
          {clock(arrival.at)}
        </TimeLink>
      </span>
      <StatusTag status={statusOf(arrival.delay, arrival.live)} plain />
      <span class="tf-near__in">{untilText(minutesUntil(arrival.at, now))}</span>
    </li>
  );
}
