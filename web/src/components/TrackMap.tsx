import { useId, useState } from 'preact/hooks';
import type { TrackResponse } from '../../../shared/api.ts';
import { useNow, usePoll } from '../hooks.ts';
import { IconChevron } from '../icons/ui.tsx';
import { routeColor } from '../lib/color.ts';
import { ageText, clockSkewMs } from '../lib/freshness.ts';
import type { Tracked } from '../track.tsx';
import { shortStopName } from '../view.ts';
import { Collapse } from './Collapse.tsx';
import './TrackMap.css';

// Vehicles report about every 30 seconds. The server asks 511 no more often than that however
// often this asks.
const REFRESH_MS = 15_000;
// A position older than this is shown as old: the vehicle has likely moved on since.
const OLD_SECONDS = 120;

// The tracking sheet's content: where the vehicle is on its way to the rider's stop, drawn from
// our own data like Nearby's map, with the stops in between.
export function TrackMap({ tracked }: { tracked: Tracked }) {
  const url = `/api/vehicle?trip=${encodeURIComponent(tracked.trip)}&stop=${encodeURIComponent(tracked.stop)}`;
  // Not kept in storage: a position from an earlier visit is no use.
  const { data, error, fetchedAt, feed } = usePoll<TrackResponse>(url, REFRESH_MS, null, false);
  const now = useNow() + clockSkewMs(data?.generatedAt, fetchedAt);
  const [showBetween, setShowBetween] = useState(false);
  const between = useId();
  if (!data) {
    return <p class="tf-muted">{error ?? (feed === 'offline' ? 'Offline. The map shows once you are back online.' : 'Finding the vehicle…')}</p>;
  }
  const route = data.routes[data.route];
  const color = tracked.color ?? (route ? routeColor(route) : 'currentColor');
  const target = shortStopName(data.stops[data.target], 'your stop');
  const headline = data.passed
    ? `It has gone past ${target}`
    : data.stopsAway === null
      ? 'No position yet. Vehicles report one once their trip starts.'
      : data.stopsAway === 0
        ? `${target} is its next stop`
        : `${data.stopsAway} stop${data.stopsAway === 1 ? '' : 's'} before ${target}`;
  // Some vehicles send no time with their position. Theirs counts from when the server got it.
  const reportedAt = data.vehicle ? (data.vehicle.at ?? data.dataAt) : null;
  const age = reportedAt === null ? null : Math.max(0, Math.floor(now / 1000 - reportedAt));
  // The stops listed from the rider's toward the vehicle: the rider's first and the vehicle's next
  // stop last, with the stops between folded into one row that opens on a tap. With no position,
  // the stops before the rider's, nearest first.
  const { targetIndex, nextIndex } = data;
  const step = nextIndex !== null && nextIndex > targetIndex ? 1 : -1;
  const order: number[] = [];
  for (let index = targetIndex; step === 1 ? index <= nextIndex! : index >= (nextIndex ?? 0); index += step) order.push(index);
  const middle = nextIndex === null ? order.slice(1) : order.slice(1, -1);
  const last = nextIndex !== null && order.length > 1 ? order.at(-1) : undefined;
  // One stop takes no more room than a row saying so.
  const fold = nextIndex !== null && middle.length > 1;
  // By position, since a loop's path can hold one stop twice.
  const item = (index: number) => (
    <li key={index} class={index === targetIndex ? 'tf-track__yours' : ''}>
      <span class="tf-track__stop-dot" aria-hidden="true" style={index === nextIndex ? { background: color } : undefined} />
      <span class="tf-track__stop-name">{shortStopName(data.stops[data.path[index]!.stop], data.path[index]!.stop)}</span>
      {index === nextIndex && <span class="tf-track__tag">Next stop</span>}
      {index === targetIndex && <span class="tf-track__tag tf-track__tag--yours">Your stop</span>}
    </li>
  );
  return (
    <div class="tf-track">
      <p class="tf-track__toward">Toward {data.headsign}</p>
      <p class="tf-track__headline" aria-live="polite">
        {headline}
      </p>
      <Map data={data} color={color} label={headline} />
      {age !== null && (
        <p class={`tf-track__age${age > OLD_SECONDS ? ' tf-track__age--old' : ''}`}>
          Position {data.vehicle?.at ? 'from' : 'received'} {ageText(age)} ago
        </p>
      )}
      {feed === 'offline' && <p class="tf-track__age tf-track__age--old">Offline. This is the last position received.</p>}
      <ol class="tf-track__stops">
        {item(order[0]!)}
        {fold ? (
          <li class="tf-track__fold">
            <button type="button" class="tf-track__more" aria-expanded={showBetween} aria-controls={between} onClick={() => setShowBetween(!showBetween)}>
              <span class="tf-track__more-line" aria-hidden="true" />
              {middle.length} stops
              <IconChevron size={16} />
            </button>
            <Collapse open={showBetween} id={between}>
              <ol class="tf-track__stops tf-track__stops--between">{middle.map(item)}</ol>
            </Collapse>
          </li>
        ) : (
          middle.map(item)
        )}
        {last !== undefined && item(last)}
      </ol>
      {error && <p class="tf-muted">{error}</p>}
    </div>
  );
}

// The line, its stops, the rider's stop as a square, and the vehicle pointing the way it heads.
// Sizes are in meters, scaled to the picture, so a long ride and a short one look alike. North is
// up.
function Map({ data, color, label }: { data: TrackResponse; color: string; label: string }) {
  const points: [number, number][] = [...data.line, ...data.path.map(({ x, y }): [number, number] => [x, y]), ...(data.vehicle ? [[data.vehicle.x, data.vehicle.y] as [number, number]] : [])];
  const xs = points.map(([x]) => x);
  // SVG's y axis points down.
  const ys = points.map(([, y]) => -y);
  const span = Math.max(300, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const pad = span * 0.12;
  // At most a little taller than wide, and at most twice as wide as tall, so it fits a phone.
  let width = Math.max(...xs) - Math.min(...xs) + pad * 2;
  let height = Math.max(...ys) - Math.min(...ys) + pad * 2;
  width = Math.max(width, height / 1.2);
  height = Math.max(height, width / 2);
  const left = (Math.max(...xs) + Math.min(...xs)) / 2 - width / 2;
  const top = (Math.max(...ys) + Math.min(...ys)) / 2 - height / 2;
  const unit = Math.max(width, height) / 70;
  const target = data.path[data.targetIndex];
  return (
    <svg class="tf-track__map" viewBox={`${left} ${top} ${width} ${height}`} role="img" aria-label={label}>
      <polyline points={data.line.map(([x, y]) => `${x},${-y}`).join(' ')} fill="none" stroke={color} stroke-width={unit * 0.9} stroke-linecap="round" stroke-linejoin="round" />
      {data.path.map(({ stop, x, y }) => (
        <circle key={stop} cx={x} cy={-y} r={unit * 0.8} class="tf-track__stop" stroke-width={unit * 0.35} />
      ))}
      {target && <rect x={target.x - unit * 1.4} y={-target.y - unit * 1.4} width={unit * 2.8} height={unit * 2.8} class="tf-track__target" stroke-width={unit * 0.45} />}
      {data.vehicle && (
        <g transform={`translate(${data.vehicle.x} ${-data.vehicle.y})`}>
          {/* Bearing is clockwise from north, as SVG rotates. */}
          {data.vehicle.bearing !== null && <path d={`M0 ${-unit * 3.2} L${unit * 1.3} ${-unit * 1.5} L${-unit * 1.3} ${-unit * 1.5} Z`} fill={color} transform={`rotate(${data.vehicle.bearing})`} />}
          <circle r={unit * 1.8} fill={color} class="tf-track__vehicle" stroke-width={unit * 0.5} />
        </g>
      )}
    </svg>
  );
}
