import { useEffect, useId, useState } from 'preact/hooks';
import type { Route, Stop, TrackLeg, TrackResponse } from '../../../shared/api.ts';
import { clock, minutesUntil } from '../format.ts';
import { useNow, usePoll } from '../hooks.ts';
import { ModeGlyph } from '../icons/ModeIcon.tsx';
import { IconChevron } from '../icons/ui.tsx';
import { routeColor, textOn } from '../lib/color.ts';
import { useWatchedPosition } from '../lib/location.ts';
import { metersFrom } from '../../../shared/projection.ts';
import { ageText, clockSkewMs } from '../lib/freshness.ts';
import type { Mark, Tracked } from '../track.tsx';
import { useSettings } from '../settings.tsx';
import { shortStopName } from '../view.ts';
import { Collapse } from './Collapse.tsx';
import { RouteChip } from './RouteChip.tsx';
import './TrackMap.css';

// Vehicles report about every 30 seconds. The server asks 511 no more often than that however
// often this asks.
const REFRESH_MS = 15_000;
// A position older than this is shown as old: the vehicle has likely moved on since.
const OLD_SECONDS = 120;

const MARK_LABEL = { yours: 'Your stop', transfer: 'Transfer stop', destination: 'Destination' };

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
  const { transfer } = tracked;
  const { settings } = useSettings();
  // The stretches of the trips the first answer drew. Later refreshes ask for the same ones, so
  // the map's stops stay where they are and only the vehicles move.
  const [spans, setSpans] = useState<{ main: [number, number]; transfer?: [number, number] } | null>(null);
  // Each trip from its first stop to its last, for seeing where the lines go. The spans stay as
  // they were, so turning it off goes back to the same picture.
  const [whole, setWhole] = useState(false);
  const url =
    `/api/vehicle?trip=${encodeURIComponent(tracked.trip)}&stop=${encodeURIComponent(tracked.stop)}` +
    marks.map(({ stop }) => `&mark=${encodeURIComponent(stop)}`).join('') +
    (spans ? `&from=${spans.main[0]}&to=${spans.main[1]}` : '') +
    (transfer ? `&ttrip=${encodeURIComponent(transfer.trip)}&tstop=${encodeURIComponent(transfer.stop)}` : '') +
    // The second vehicle's stops: where the rider boards it and, with a destination, where they leave it.
    (transfer?.destination ? `&tmark=${encodeURIComponent(transfer.stop)}&tmark=${encodeURIComponent(transfer.destination)}` : '') +
    (spans?.transfer ? `&tfrom=${spans.transfer[0]}&tto=${spans.transfer[1]}` : '') +
    (settings.mapFitOnBoard ? '&autofit=1' : '') +
    (whole ? '&whole=1' : '');
  // Not kept in storage: a position from an earlier visit is no use.
  const { data, error, fetchedAt, feed } = usePoll<TrackResponse>(url, REFRESH_MS, null, false);
  // When the rider last asked to fit the map to the trip from here. Only an answer that arrives
  // after it pins the map again, as the one on screen still shows the old stretch.
  const [refitAt, setRefitAt] = useState(0);
  // The first answer's spans are pinned, and later ones only where the server zoomed in after the
  // rider boarded, which then sticks. A span the server grew to take in a vehicle past it is not
  // pinned: the picture stays centered where it was, and the server grows it again as needed.
  useEffect(() => {
    if (whole || !data?.span || fetchedAt === null || fetchedAt <= refitAt) return;
    const zoomed = (now: [number, number] | undefined, pinned: [number, number] | undefined) => (now && (!pinned || now[0] > pinned[0]) ? now : pinned);
    const main = zoomed(data.span, spans?.main)!;
    const transfer = zoomed(data.transfer?.span, spans?.transfer);
    const next = { main, ...(transfer ? { transfer } : {}) };
    if (JSON.stringify(next) !== JSON.stringify(spans)) setSpans(next);
  }, [data, fetchedAt]);
  const refit = () => {
    setRefitAt(Date.now());
    setWhole(false);
    setSpans(null);
  };
  // An answer drawn whole, still on screen until the next arrives, never pins the spans.
  const toggleWhole = () => {
    setRefitAt(Date.now());
    setWhole(!whole);
  };
  const now = useNow() + clockSkewMs(data?.generatedAt, fetchedAt);
  // Where the rider is, when the phone already shares it, so the vehicle is not taken for them.
  const position = useWatchedPosition();
  if (!data) {
    return <p class="tf-muted">{error ?? (feed === 'offline' ? 'Offline. The map shows once you are back online.' : 'Finding the vehicle…')}</p>;
  }
  const route = data.routes[data.route];
  const color = tracked.color ?? (route ? routeColor(route) : 'currentColor');
  const estimate = data.vehicle?.estimate;
  const headline = legStatus(data, data.stops, 'your stop');
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
  const labels = markedStops(data, marks);
  // The vehicle the rider transfers to, watched to where they board it.
  const next = data.transfer;
  const nextRoute = next ? data.routes[next.route] : undefined;
  const nextColor = transfer?.color ?? (nextRoute ? routeColor(nextRoute) : 'currentColor');
  const nextLabels = next ? new Map<number, Mark['kind'][]>(next.targetIndex === null ? [] : [[next.targetIndex, ['transfer']]]) : null;
  const destinationIndex = transfer?.destination ? next?.marks[1] : null;
  if (nextLabels && destinationIndex !== null && destinationIndex !== undefined && !nextLabels.has(destinationIndex)) nextLabels.set(destinationIndex, ['destination']);
  // The transfer as it stands now: from the first vehicle reaching the stop the rider gets off at
  // to the second reaching where they board, as the results count it. Without both times, the
  // figure from when the rider tapped.
  const offIndex = [...labels].find(([, kinds]) => kinds.includes('transfer'))?.[0];
  const offAt = offIndex === undefined ? null : (data.path[offIndex]?.at ?? null);
  const boardAt = next && next.targetIndex !== null ? (next.path[next.targetIndex]?.at ?? null) : null;
  const transferMinutes = offAt !== null && boardAt !== null ? Math.floor((boardAt - offAt) / 60) : transfer?.minutes;
  // Missed, or tight as results mark a transfer within a minute of the window's shortest (isTight
  // in lib/results.ts), each drawn as results draw it.
  const missed = transferMinutes !== undefined && transferMinutes < 0;
  const tight = transferMinutes !== undefined && !missed && transfer?.min !== undefined && transferMinutes <= transfer.min + 1;
  const spokenTransfer =
    transferMinutes === undefined
      ? 'Transfer to'
      : missed
        ? `Transfer missed by ${-transferMinutes} minute${transferMinutes === -1 ? '' : 's'}, to`
        : `${transferMinutes} minute transfer${tight ? ', tight' : ''}, to`;
  const legs: Drawn[] = [
    ...(next && nextLabels ? [{ leg: next, color: nextColor, labels: nextLabels, mode: nextRoute?.mode ?? 'bus' }] : []),
    { leg: data, color, labels, mode: route?.mode ?? 'bus' },
  ];
  const [riderX, riderY] = position ? metersFrom(data.center, position) : [0, 0];
  return (
    <div class="tf-track">
      <p class="tf-track__toward">Toward {data.headsign}</p>
      <p class="tf-track__headline" aria-live="polite">
        {headline}
      </p>
      <div class="tf-track__frame">
        <LineMap legs={legs} label={headline} rider={position && { x: riderX, y: riderY, accuracy: position.accuracy }} />
        <div class="tf-track__controls">
          <button type="button" class="tf-track__fit" aria-pressed={whole} aria-label="Full route" onClick={toggleWhole}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="5" cy="18" r="2" />
              <circle cx="19" cy="6" r="2" />
              <path d="M7 18h6a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h6" />
            </svg>
            Full
          </button>
          {/* Drops the stops behind the vehicle and fits the map to the trip from where it is now. */}
          <button type="button" class="tf-track__fit" onClick={refit} disabled={!spans && !whole} aria-label="Fit the map to the trip from here">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
            </svg>
            Fit
          </button>
        </div>
      </div>
      {ageLine && <p class={`tf-track__age${age !== null && age > OLD_SECONDS ? ' tf-track__age--old' : ''}`}>{ageLine}</p>}
      {feed === 'offline' && <p class="tf-track__age tf-track__age--old">Offline. This is the last update received.</p>}
      <LegList leg={data} stops={data.stops} labels={labels} color={color} now={now} />
      {next && nextLabels && (
        <>
          {/* The change of vehicles, then the one the rider changes to, from where it is now to
              where they board it. */}
          {/* The vehicle and where it is, with the transfer on the right, as a results row
              gives it (J, 2026-10-08). Without both vehicles' times, the vehicle alone. */}
          <div class={`tf-track__change${missed ? ' tf-track__change--missed' : tight ? ' tf-track__change--tight' : ''}`}>
            <div class="tf-track__change-main">
              <p class="tf-track__change-head">
                {transferMinutes === undefined ? <span class="tf-track__change-kicker">Transfer to</span> : <span class="tf-sr">{spokenTransfer}</span>}
                <RouteChip route={nextRoute} size="sm" {...(transfer?.color ? { color: transfer.color } : {})} />
                <span>toward {next.headsign}</span>
              </p>
              <p class="tf-track__change-status">{legStatus(next, data.stops, 'the transfer stop')}</p>
            </div>
            {transferMinutes !== undefined && (
              <div class="tf-row__xfer tf-track__xfer" aria-hidden="true">
                <div class="tf-row__xfer-min">{Math.abs(transferMinutes)}&nbsp;min</div>
                <div class="tf-row__xfer-label">{missed ? 'missed by' : 'transfer'}</div>
                {tight && <div class="tf-tight">TIGHT</div>}
              </div>
            )}
          </div>
          <LegList leg={next} stops={data.stops} labels={nextLabels} color={nextColor} now={now} />
        </>
      )}
      {error && <p class="tf-muted">{error}</p>}
    </div>
  );
}

type Drawn = { leg: TrackLeg; color: string; labels: Map<number, Mark['kind'][]>; mode: Route['mode'] };
type Rider = { x: number; y: number; accuracy: number };

// Whether the vehicle has passed a stop of its leg. An ended trip has passed every stop.
const passedAt = (leg: TrackLeg, index: number) => (leg.nextIndex === null ? leg.missing === 'ended' : index < leg.nextIndex);

// Each leg's line, its stops, the rider's stops as squares, and its vehicle pointing the way it
// heads, the transfer's drawn first so the rider's own vehicle sits on top. A walk between the
// stop they get off at and the one they board is a dashed line. Sizes are in meters, scaled to the
// picture, so a long ride and a short one look alike. North is up.
function LineMap({ legs, label, rider }: { legs: Drawn[]; label: string; rider: Rider | null }) {
  // The frame fits the lines and stops, which stay put on a pinned map, so the picture holds still
  // as the vehicles move. A vehicle off the padded frame, as before its trip starts, widens it.
  const route: [number, number][] = legs.flatMap(({ leg }) => [...leg.line, ...leg.path.map(({ x, y }): [number, number] => [x, y])]);
  const xs = route.map(([x]) => x);
  // SVG's y axis points down.
  const ys = route.map(([, y]) => -y);
  const span = Math.max(300, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const pad = span * 0.12;
  // Within half the padding, so its badge stays in the picture too.
  for (const { leg } of legs) {
    if (!leg.vehicle) continue;
    const [x, y] = [leg.vehicle.x, -leg.vehicle.y];
    if (x < Math.min(...xs) - pad / 2 || x > Math.max(...xs) + pad / 2 || y < Math.min(...ys) - pad / 2 || y > Math.max(...ys) + pad / 2) {
      xs.push(x);
      ys.push(y);
    }
  }
  // The rider, when near enough that the picture still shows the trip well with them in it.
  const nearby = rider && rider.x > Math.min(...xs) - span * 0.5 && rider.x < Math.max(...xs) + span * 0.5 && -rider.y > Math.min(...ys) - span * 0.5 && -rider.y < Math.max(...ys) + span * 0.5;
  if (rider && nearby) {
    xs.push(rider.x);
    ys.push(-rider.y);
  }
  // At most a little taller than wide, and at most twice as wide as tall, so it fits a phone. A
  // band along the bottom is left clear for the Fit button.
  const clear = span * 0.14;
  let width = Math.max(...xs) - Math.min(...xs) + pad * 2;
  let height = Math.max(...ys) - Math.min(...ys) + pad * 2 + clear;
  width = Math.max(width, height / 1.2);
  height = Math.max(height, width / 2);
  const left = (Math.max(...xs) + Math.min(...xs)) / 2 - width / 2;
  const top = (Math.max(...ys) + Math.min(...ys)) / 2 - (height - clear) / 2;
  const unit = Math.max(width, height) / 70;
  // Where the rider gets off, and where they board the next vehicle, when those differ.
  const [next, main] = legs.length === 2 ? legs : [null, legs[0]!];
  const off = main && [...main.labels].find(([, kinds]) => kinds.includes('transfer'))?.[0];
  const getOff = off === undefined ? undefined : main!.leg.path[off];
  const board = next && next.leg.targetIndex !== null ? next.leg.path[next.leg.targetIndex] : undefined;
  return (
    <svg class="tf-track__map" viewBox={`${left} ${top} ${width} ${height}`} role="img" aria-label={label}>
      {legs.map(({ leg, color }, n) => (
        <polyline key={`line-${n}`} points={leg.line.map(([x, y]) => `${x},${-y}`).join(' ')} fill="none" stroke={color} stroke-width={unit * 0.9} stroke-linecap="round" stroke-linejoin="round" />
      ))}
      {getOff && board && Math.hypot(getOff.x - board.x, getOff.y - board.y) > 15 && (
        <line x1={getOff.x} y1={-getOff.y} x2={board.x} y2={-board.y} class="tf-track__walk" stroke-width={unit * 0.45} stroke-dasharray={`${unit * 0.8} ${unit * 0.6}`} stroke-linecap="round" />
      )}
      {/* Getting off and boarding at one place is one transfer, drawn once. */}
      {legs.map((drawn, n) => (
        <LegStops key={`stops-${n}`} drawn={drawn} unit={unit} skipTransfer={drawn === next && getOff !== undefined && board !== undefined && Math.hypot(getOff.x - board.x, getOff.y - board.y) <= 15} />
      ))}
      {/* The rider over the stops, as they are often at one, and under the vehicles. */}
      {rider && nearby && (
        <g transform={`translate(${rider.x} ${-rider.y})`} aria-hidden="true">
          <circle r={Math.max(unit * 2.4, Math.min(rider.accuracy, span * 0.2))} class="tf-track__you-halo" />
          <circle r={unit * 1.3} class="tf-track__you" stroke-width={unit * 0.6} />
        </g>
      )}
      {legs.map((drawn, n) => (
        <LegVehicle key={`vehicle-${n}`} drawn={drawn} unit={unit} />
      ))}
    </svg>
  );
}

// One leg's stops, and the rider's stops on it.
function LegStops({ drawn: { leg, color, labels }, unit, skipTransfer }: { drawn: Drawn; unit: number; skipTransfer: boolean }) {
  return (
    <>
      {/* The vehicle's next stop is filled with its color, as in the list. */}
      {leg.path.map(({ x, y }, index) => (
        <circle key={index} cx={x} cy={-y} r={unit * 0.8} class="tf-track__stop" stroke-width={unit * 0.35} style={index === leg.nextIndex ? { fill: color } : undefined} />
      ))}
      {/* The rider's stops as squares: solid where they get on, open where they transfer, solid in a
          ring at their destination, and struck through once the vehicle has passed them. */}
      {[...labels].map(([index, kinds]) => {
        const place = leg.path[index];
        if (!place) return null;
        const kind = kinds[0]!;
        if (kind === 'transfer' && skipTransfer) return null;
        const half = unit * 1.4;
        // Where the rider changes, by the transfer mark the app gives changes everywhere else, so it
        // stands out from the stops and squares around it (J, 2026-10-09).
        if (kind === 'transfer') {
          const r = unit * 2.5;
          return (
            <g key={`mark-${index}`} transform={`translate(${place.x} ${-place.y})`} class={passedAt(leg, index) ? 'tf-track__change-mark tf-track__change-mark--passed' : 'tf-track__change-mark'}>
              <circle r={r} stroke-width={unit * 0.55} style={index === leg.nextIndex ? { fill: color } : undefined} />
              <path d="M4 8h14l-4-4M20 16H6l4 4" transform={`scale(${(r * 1.25) / 24}) translate(-12 -12)`} fill="none" stroke-width={2.4} stroke-linecap="round" stroke-linejoin="round" />
            </g>
          );
        }
        return (
          <g key={`mark-${index}`} transform={`translate(${place.x} ${-place.y})`}>
            {kind === 'destination' && <rect x={-half * 1.7} y={-half * 1.7} width={half * 3.4} height={half * 3.4} class="tf-track__square-ring" stroke-width={unit * 0.45} />}
            <rect x={-half} y={-half} width={half * 2} height={half * 2} class={`tf-track__square--${kind}`} stroke-width={unit * 0.45} style={index === leg.nextIndex ? { fill: color } : undefined} />
            {passedAt(leg, index) && (
              <>
                <line x1={-half * 1.5} y1={half * 1.5} x2={half * 1.5} y2={-half * 1.5} class="tf-track__slash-edge" stroke-width={unit * 1.1} stroke-linecap="round" />
                <line x1={-half * 1.5} y1={half * 1.5} x2={half * 1.5} y2={-half * 1.5} class="tf-track__slash" stroke-width={unit * 0.45} stroke-linecap="round" />
              </>
            )}
          </g>
        );
      })}
    </>
  );
}

// A leg's vehicle, as its chip draws it: its route's color with its pictogram, so it reads as the
// bus or train rather than as the rider's own dot (J, 2026-10-09). The pictogram faces the way the
// vehicle heads, and a pointer outside it gives the bearing.
function LegVehicle({ drawn: { leg, color, mode }, unit }: { drawn: Drawn; unit: number }) {
  if (!leg.vehicle) return null;
  const { x, y, bearing, estimate } = leg.vehicle;
  const size = unit * 4.6;
  const reach = size * 0.72;
  const west = bearing !== null && bearing > 180;
  return (
    <g transform={`translate(${x} ${-y})`}>
      {/* Bearing is clockwise from north, as SVG rotates. */}
      {bearing !== null && (
        <path d={`M0 ${-(reach + unit * 1.9)} L${unit * 1.5} ${-reach} L${-unit * 1.5} ${-reach} Z`} class="tf-track__heading" stroke-width={unit * 0.35} stroke-linejoin="round" transform={`rotate(${bearing})`} />
      )}
      {/* An estimate is drawn faded and dashed, so it does not pass for a reported position. */}
      <rect
        x={-size / 2}
        y={-size / 2}
        width={size}
        height={size}
        rx={unit * 0.9}
        fill={color}
        class={`tf-track__vehicle${estimate ? ' tf-track__vehicle--estimate' : ''}`}
        stroke-width={unit * 0.5}
        stroke-dasharray={estimate ? `${unit * 0.7} ${unit * 0.5}` : undefined}
      />
      <g transform={`scale(${(west ? -1 : 1) * ((size * 0.82) / 24)} ${(size * 0.82) / 24}) translate(-12 -12)`} style={{ color: textOn(color) }}>
        <ModeGlyph mode={mode} />
      </g>
    </g>
  );
}

// Where a leg's vehicle stands against the stop watched on it.
function legStatus(leg: TrackLeg, stops: Record<string, Stop>, fallback: string) {
  const target = shortStopName(stops[leg.target], fallback);
  if (leg.passed) return `It has gone past ${target}`;
  if (leg.stopsAway === null) return MISSING[leg.missing ?? 'unknown'];
  if (leg.stopsAway === 0) return `${target} is its next stop`;
  return `${leg.vehicle?.estimate ? 'About ' : ''}${leg.stopsAway} stop${leg.stopsAway === 1 ? '' : 's'} before ${target}`;
}

// One leg's stops as a list, the way the vehicle travels, from its next stop, or a labeled stop it
// has passed, down to the farthest labeled stop, each with when the vehicle is due there. Runs of
// stops between the labeled ones fold into one row that opens on a tap, since one stop takes no
// more room than a row saying so. With no position, it starts at the first stop drawn.
function LegList({ leg, stops, labels, color, now }: { leg: TrackLeg; stops: Record<string, Stop>; labels: Map<number, Mark['kind'][]>; color: string; now: number }) {
  // Folded runs the rider opened, by a stop key, which stays put as the vehicle moves and the
  // picture's positions shift.
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const between = useId();
  const { nextIndex } = leg;
  const ends = [...labels.keys(), nextIndex ?? 0].filter((index) => index >= 0 && index < leg.path.length);
  const rows: (number | number[])[] = [];
  for (let index = Math.min(...ends); index <= Math.max(...ends); index++) {
    const plain = !labels.has(index) && index !== nextIndex;
    const run = rows.at(-1);
    if (plain && Array.isArray(run)) run.push(index);
    else rows.push(plain ? [index] : index);
  }
  // By position, since a loop's path can hold one stop twice.
  const item = (index: number) => (
    <li key={index} class={labels.has(index) ? `tf-track__mark tf-track__mark--${labels.get(index)![0]}${passedAt(leg, index) ? ' tf-track__mark--passed' : ''}` : ''}>
      <span class="tf-track__stop-dot" aria-hidden="true" style={index === nextIndex ? { background: color } : undefined} />
      <span class="tf-track__stop-name">{shortStopName(stops[leg.path[index]!.stop], leg.path[index]!.stop)}</span>
      {/* One tag says both when the rider's stop is also where the vehicle stops next. */}
      {labels.get(index)?.map((kind, n) => (
        <span key={kind} class="tf-track__tag tf-track__tag--mark">
          {MARK_LABEL[kind]}
          {index === nextIndex && n === 0 && ' is next'}
        </span>
      ))}
      {index === nextIndex && !labels.has(index) && <span class="tf-track__tag">Next stop</span>}
      {/* A canceled trip comes with no times. */}
      <When at={leg.path[index]!.at ?? null} passed={passedAt(leg, index)} now={now} />
    </li>
  );
  const fold = (run: number[]) => {
    // Its end beside a labeled stop, which stays put as the vehicle moves along. The other end
    // can be beside the vehicle's next stop, which moves.
    const key = leg.path[labels.has(run.at(-1)! + 1) ? run.at(-1)! : run[0]!]!.stop;
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
  return <ol class="tf-track__stops">{rows.map((row) => (Array.isArray(row) ? (row.length > 1 ? fold(row) : item(row[0]!)) : item(row)))}</ol>;
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
      <span class={`tf-track__in${passed ? ' tf-track__in--passed' : ''}`}>{passed ? 'Passed' : minutes < 1 ? 'Now' : `${minutes}\u00a0min`}</span>
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
  if (data.targetIndex !== null && !labels.has(data.targetIndex)) mark(data.targetIndex, 'yours');
  return labels;
}
