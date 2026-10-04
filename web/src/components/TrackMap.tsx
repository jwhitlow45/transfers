import { useEffect, useId, useState } from 'preact/hooks';
import type { TrackResponse } from '../../../shared/api.ts';
import { clock, minutesUntil } from '../format.ts';
import { useNow, usePoll } from '../hooks.ts';
import { IconChevron } from '../icons/ui.tsx';
import { routeColor } from '../lib/color.ts';
import { ageText, clockSkewMs } from '../lib/freshness.ts';
import type { Mark, Tracked } from '../track.tsx';
import { shortStopName } from '../view.ts';
import { Collapse } from './Collapse.tsx';
import './TrackMap.css';

// Vehicles report about every 30 seconds. The server asks 511 no more often than that however
// often this asks.
const REFRESH_MS = 15_000;
// A position older than this is shown as old: the vehicle has likely moved on since.
const OLD_SECONDS = 120;

const MARK_LABEL = { yours: 'Your stop', transfer: 'Transfer stop' };

const MISSING = {
  'not-started': 'Not under way yet. It shows here once its trip starts.',
  ended: 'This trip has ended.',
  canceled: 'This trip is canceled.',
  unknown: 'There is no position for this vehicle right now.',
};

// The tracking sheet's content: where the vehicle is on its way to the rider's stop, drawn from
// our own data like Nearby's map, with the stops in between.
export function TrackMap({ tracked }: { tracked: Tracked }) {
  const marks = tracked.marks ?? [];
  // The stretch of the trip the first answer drew. Later refreshes ask for the same one, so the
  // map's stops stay where they are and only the vehicle moves.
  const [span, setSpan] = useState<[number, number] | null>(null);
  const url =
    `/api/vehicle?trip=${encodeURIComponent(tracked.trip)}&stop=${encodeURIComponent(tracked.stop)}` +
    marks.map(({ stop }) => `&mark=${encodeURIComponent(stop)}`).join('') +
    (span ? `&from=${span[0]}&to=${span[1]}` : '');
  // Not kept in storage: a position from an earlier visit is no use.
  const { data, error, fetchedAt, feed } = usePoll<TrackResponse>(url, REFRESH_MS, null, false);
  useEffect(() => {
    if (!span && data?.span) setSpan(data.span);
  }, [data]);
  const now = useNow() + clockSkewMs(data?.generatedAt, fetchedAt);
  // Folded runs the rider opened, by a stop key, which stays put as the vehicle moves and the
  // picture's positions shift.
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const between = useId();
  if (!data) {
    return <p class="tf-muted">{error ?? (feed === 'offline' ? 'Offline. The map shows once you are back online.' : 'Finding the vehicle…')}</p>;
  }
  const route = data.routes[data.route];
  const color = tracked.color ?? (route ? routeColor(route) : 'currentColor');
  const target = shortStopName(data.stops[data.target], 'your stop');
  const estimate = data.vehicle?.estimate;
  const headline = data.passed
    ? `It has gone past ${target}`
    : data.stopsAway === null
      ? MISSING[data.missing ?? 'unknown']
      : data.stopsAway === 0
        ? `${target} is its next stop`
        : `${estimate ? 'About ' : ''}${data.stopsAway} stop${data.stopsAway === 1 ? '' : 's'} before ${target}`;
  // Some vehicles send no time with their position. Theirs counts from when the server got it,
  // as does an estimate's, from when the predictions arrived.
  const reportedAt = data.vehicle && estimate !== 'scheduled' ? (data.vehicle.at ?? data.dataAt) : null;
  const age = reportedAt === null ? null : Math.max(0, Math.floor(now / 1000 - reportedAt));
  const ageLine =
    age === null
      ? estimate === 'scheduled' && 'Estimated from the schedule. There are no live updates for this trip.'
      : estimate === 'predicted'
        ? `Estimated from arrival times predicted ${ageText(age)} ago`
        : `Position ${data.vehicle?.at ? 'from' : 'received'} ${ageText(age)} ago`;
  const { targetIndex, nextIndex } = data;
  const labels = markedStops(data, marks);
  // The list runs the way the vehicle travels, from its next stop, or a labeled stop it has passed,
  // down to the farthest labeled stop, each with when the vehicle is due there. Runs of stops
  // between the labeled ones fold into one row that opens on a tap, since one stop takes no more
  // room than a row saying so. With no position, it starts at the first stop drawn.
  const ends = [...labels.keys(), nextIndex ?? 0];
  const rows: (number | number[])[] = [];
  for (let index = Math.min(...ends); index <= Math.max(...ends); index++) {
    const plain = !labels.has(index) && index !== nextIndex;
    const run = rows.at(-1);
    if (plain && Array.isArray(run)) run.push(index);
    else rows.push(plain ? [index] : index);
  }
  // By position, since a loop's path can hold one stop twice.
  // An ended trip has passed every stop.
  const passedAt = (index: number) => (nextIndex === null ? data.missing === 'ended' : index < nextIndex);
  const item = (index: number) => (
    <li key={index} class={labels.has(index) ? `tf-track__mark tf-track__mark--${labels.get(index)![0]}${passedAt(index) ? ' tf-track__mark--passed' : ''}` : ''}>
      <span class="tf-track__stop-dot" aria-hidden="true" style={index === nextIndex ? { background: color } : undefined} />
      <span class="tf-track__stop-name">{shortStopName(data.stops[data.path[index]!.stop], data.path[index]!.stop)}</span>
      {/* One tag says both when the rider's stop is also where the vehicle stops next. */}
      {labels.get(index)?.map((kind, n) => (
        <span key={kind} class="tf-track__tag tf-track__tag--mark">
          {MARK_LABEL[kind]}
          {index === nextIndex && n === 0 && ' is next'}
        </span>
      ))}
      {index === nextIndex && !labels.has(index) && <span class="tf-track__tag">Next stop</span>}
      {/* A canceled trip comes with no times. */}
      <When at={data.path[index]!.at ?? null} passed={passedAt(index)} now={now} />
    </li>
  );
  const fold = (run: number[]) => {
    // Its end beside a labeled stop, which stays put as the vehicle moves along. The other end
    // can be beside the vehicle's next stop, which moves.
    const key = data.path[labels.has(run.at(-1)! + 1) ? run.at(-1)! : run[0]!]!.stop;
    const isOpen = opened.has(key);
    const toggle = () =>
      setOpened((current) => {
        const next = new Set(current);
        if (isOpen) next.delete(key);
        else next.add(key);
        return next;
      });
    return (
      <li key={`fold-${run[0]}`} class="tf-track__fold">
        <button type="button" class="tf-track__more" aria-expanded={isOpen} aria-controls={`${between}-${run[0]}`} onClick={toggle}>
          <span class="tf-track__more-line" aria-hidden="true" />
          {run.length} stops
          <IconChevron size={16} />
        </button>
        <Collapse open={isOpen} id={`${between}-${run[0]}`}>
          <ol class="tf-track__stops tf-track__stops--between">{run.map(item)}</ol>
        </Collapse>
      </li>
    );
  };
  return (
    <div class="tf-track">
      <p class="tf-track__toward">Toward {data.headsign}</p>
      <p class="tf-track__headline" aria-live="polite">
        {headline}
      </p>
      <LineMap data={data} color={color} label={headline} labels={labels} />
      {ageLine && <p class={`tf-track__age${age !== null && age > OLD_SECONDS ? ' tf-track__age--old' : ''}`}>{ageLine}</p>}
      {feed === 'offline' && <p class="tf-track__age tf-track__age--old">Offline. This is the last update received.</p>}
      <ol class="tf-track__stops">{rows.map((row) => (Array.isArray(row) ? (row.length > 1 ? fold(row) : item(row[0]!)) : item(row)))}</ol>
      {error && <p class="tf-muted">{error}</p>}
    </div>
  );
}

// The line, its stops, the rider's stops as squares, and the vehicle pointing the way it heads.
// Sizes are in meters, scaled to the picture, so a long ride and a short one look alike. North is
// up.
function LineMap({ data, color, label, labels }: { data: TrackResponse; color: string; label: string; labels: Map<number, Mark['kind'][]> }) {
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
  return (
    <svg class="tf-track__map" viewBox={`${left} ${top} ${width} ${height}`} role="img" aria-label={label}>
      <polyline points={data.line.map(([x, y]) => `${x},${-y}`).join(' ')} fill="none" stroke={color} stroke-width={unit * 0.9} stroke-linecap="round" stroke-linejoin="round" />
      {data.path.map(({ x, y }, index) => (
        <circle key={index} cx={x} cy={-y} r={unit * 0.8} class="tf-track__stop" stroke-width={unit * 0.35} />
      ))}
      {/* The rider's stops as squares: solid where they get on, open where they transfer. */}
      {[...labels].map(([index, kinds]) => {
        const place = data.path[index]!;
        const kind = kinds[0]!;
        return (
          <rect key={index} x={place.x - unit * 1.4} y={-place.y - unit * 1.4} width={unit * 2.8} height={unit * 2.8} class={`tf-track__square--${kind}`} stroke-width={unit * (kind === 'yours' ? 0.45 : 0.7)} />
        );
      })}
      {data.vehicle && (
        <g transform={`translate(${data.vehicle.x} ${-data.vehicle.y})`}>
          {/* Bearing is clockwise from north, as SVG rotates. The arrow is in the text color, outlined,
              so it stands out from the line it travels along, which is the vehicle's color. */}
          {data.vehicle.bearing !== null && (
            <path d={`M0 ${-unit * 4.4} L${unit * 1.9} ${-unit * 1.2} L${-unit * 1.9} ${-unit * 1.2} Z`} class="tf-track__heading" stroke-width={unit * 0.35} stroke-linejoin="round" transform={`rotate(${data.vehicle.bearing})`} />
          )}
          {/* An estimate is drawn faded and dashed, so it does not pass for a reported position. */}
          <circle r={unit * 1.8} fill={color} class={`tf-track__vehicle${data.vehicle.estimate ? ' tf-track__vehicle--estimate' : ''}`} stroke-width={unit * 0.5} stroke-dasharray={data.vehicle.estimate ? `${unit * 0.7} ${unit * 0.5}` : undefined} />
        </g>
      )}
    </svg>
  );
}

// When the vehicle is due at a stop: minutes from now, as the results count down, over the clock
// time. A stop behind the vehicle says it has passed, with about when it left. Positions and
// predictions arrive apart, so the clock is kept on the right side of now: a stop passed early
// never shows a time to come, nor a stop ahead a time gone.
function When({ at, passed, now }: { at: number | null; passed: boolean; now: number }) {
  if (at === null) return null;
  const minutes = minutesUntil(at, now);
  const shown = passed ? Math.min(at, now / 1000) : Math.max(at, now / 1000);
  return (
    <span class="tf-track__when">
      <span class={`tf-track__in${passed ? ' tf-track__in--passed' : ''}`}>{passed ? 'Passed' : minutes < 1 ? 'Now' : `${minutes} min`}</span>
      <span class="tf-track__time">{clock(shown)}</span>
    </span>
  );
}

// The kinds of the rider's stops at each place in the path, in journey order. The stop watched is
// theirs unless the page said otherwise. A server from before marks sends none.
function markedStops(data: TrackResponse, marks: Mark[]) {
  const labels = new Map<number, Mark['kind'][]>();
  const mark = (index: number | null | undefined, kind: Mark['kind']) => {
    if (index !== null && index !== undefined) labels.set(index, [...(labels.get(index) ?? []), kind]);
  };
  marks.forEach(({ kind }, n) => mark(data.marks?.[n], kind));
  if (!labels.has(data.targetIndex)) mark(data.targetIndex, 'yours');
  return labels;
}
