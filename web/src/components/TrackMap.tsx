import type { ComponentChildren } from 'preact';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Mode, Route, Stop, TrackLeg, TrackResponse } from '../../../shared/api.ts';
import { atLeast, clock, minutesUntil, walkText } from '../format.ts';
import { useNow, usePoll } from '../hooks.ts';
import { IconFit, IconFold, IconFullRoute } from '../icons/ui.tsx';
import { routeColor } from '../lib/color.ts';
import { useWatchedPosition } from '../lib/location.ts';
import { type Rect, placeLabels } from '../lib/map-labels.ts';
import { useMapView } from '../lib/map-view.ts';
import { metersFrom } from '../../../shared/projection.ts';
import { ageText, clockSkewMs } from '../lib/freshness.ts';
import type { Mark, Tracked } from '../track.tsx';
import { useSettings } from '../settings.tsx';
import { chipLabel, shortStopName } from '../view.ts';
import { Collapse } from './Collapse.tsx';
import { RouteChip } from './RouteChip.tsx';
import { Approx, Plus } from './StatusTag.tsx';
import './TrackMap.css';
import { TripTimeBar } from './TripTimeBar.tsx';
import { YouMarker } from './YouMarker.tsx';
import { failureOf } from '../lib/failure.ts';
import { MapHint, Recenter } from './MapControls.tsx';

// Vehicles report about every 30 seconds. The server asks 511 no more often than that however
// often this asks.
const REFRESH_MS = 15_000;
// A position older than this is shown as old: the vehicle has likely moved on since.
const OLD_SECONDS = 120;

const MISSING = {
  'not-started': 'Not under way yet. It shows here once its trip starts.',
  ended: 'This trip has ended.',
  canceled: 'This trip is canceled.',
  unknown: 'There is no position for this vehicle right now.',
};

// What the map calls a vehicle beside its marker, by what it is, as the marker itself is the same
// ring for every kind.
const VEHICLE_WORD: Record<Mode, string> = { bus: 'Bus', trolleybus: 'Bus', 'light-rail': 'Train', streetcar: 'Streetcar', 'cable-car': 'Cable car', bart: 'Train', ferry: 'Ferry' };

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
  const { data, error: refused, fetchedAt, feed } = usePoll<TrackResponse>(url, REFRESH_MS, null, false);
  // A stop no longer in the schedule says so plainly, as a page does.
  const error = failureOf(refused, 'The map')?.text ?? null;
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
  const both = offAt !== null && boardAt !== null;
  const transferMinutes = both ? Math.floor((boardAt - offAt) / 60) : transfer?.minutes;
  const transferScheduled = both ? Boolean(data.scheduled || next?.scheduled) : Boolean(transfer?.scheduled);
  // Missed, or tight as results mark a transfer within a minute of the window's shortest (isTight
  // in lib/results.ts), each drawn as results draw it.
  const missed = transferMinutes !== undefined && transferMinutes < 0;
  const tight = transferMinutes !== undefined && !missed && transfer?.min !== undefined && transferMinutes <= transfer.min + 1;
  const routeName = route ? chipLabel(route) : 'vehicle';
  const nextName = nextRoute ? chipLabel(nextRoute) : 'next vehicle';
  // With more of the journey known than the one stop, that stop is where the rider gets on.
  const journey = marks.length > 1 || Boolean(transfer);
  const mainRole = (kind: Mark['kind']) => (kind === 'yours' ? (journey ? 'Board here' : 'Your stop') : kind === 'transfer' ? 'Get off here' : 'Your destination');
  const nextRole = (kind: Mark['kind']) => (kind === 'transfer' ? 'Board here' : 'Your destination');
  // Two vehicles of one kind are told apart by their routes.
  const [word, nextWord] = [VEHICLE_WORD[route?.mode ?? 'bus'], VEHICLE_WORD[nextRoute?.mode ?? 'bus']];
  const sameWord = Boolean(next) && word === nextWord;
  const legs: Drawn[] = [
    ...(next && nextLabels
      ? [{ leg: next, color: nextColor, labels: nextLabels, word: sameWord ? `${nextWord} ${nextName}` : nextWord, role: (kind: Mark['kind']) => (kind === 'transfer' ? `Board the ${nextName}` : 'Destination') }]
      : []),
    {
      leg: data,
      color,
      labels,
      word: sameWord ? `${word} ${routeName}` : word,
      role: (kind: Mark['kind']) => (kind === 'yours' ? mainRole(kind) : kind === 'transfer' ? (next ? `Change to the ${nextName}` : 'Change here') : 'Destination'),
    },
  ];
  const [riderX, riderY] = position ? metersFrom(data.center, position) : [0, 0];
  const name = (leg: TrackLeg, index: number) => shortStopName(data.stops[leg.path[index]!.stop], leg.path[index]!.stop);
  // The map in words, for a screen reader, which gets none of the drawing: where the vehicle is,
  // then each of the rider's stops with what they do there, as the labels on the map say it.
  const inWords = [
    `Map. ${headline.replace(/\.$/, '')}.`,
    ...[...labels].map(([index, kinds]) => `${legs.at(-1)!.role(kinds[0]!)}: ${name(data, index)}.`),
    ...(next && nextLabels ? [`The ${nextName}: ${legStatus(next, data.stops, 'the transfer stop').replace(/\.$/, '')}.`, ...[...nextLabels].map(([index, kinds]) => `${legs[0]!.role(kinds[0]!)}: ${name(next, index)}.`)] : []),
  ].join(' ');
  // The whole transfer on one clock, once both vehicles have times at the change. A missed one
  // has no gap to draw, and its row in the list says so.
  const boardIndex = [...labels].find(([, kinds]) => kinds.includes('yours'))?.[0];
  const rideStart = boardIndex === undefined ? null : (data.path[boardIndex]?.at ?? null);
  const destinationAt = destinationIndex === null || destinationIndex === undefined ? null : (next?.path[destinationIndex]?.at ?? null);
  const bar = next && both && !missed && rideStart !== null && transferMinutes !== undefined ? { rideStart, rideEnd: offAt, gapEnd: boardAt, busEnd: destinationAt } : null;
  // The walk between the stops of the change, said where the rider gets off, as results say it.
  const walk = transfer?.walkMeters === undefined ? null : walkText(transfer.walkMeters, settings.walkSpeed);
  const notes = new Map<number, ComponentChildren>(walk && offIndex !== undefined ? [[offIndex, walk]] : []);
  // The transfer, where the rider boards the second vehicle, drawn as results draw a tight one.
  const nextNotes = new Map<number, ComponentChildren>();
  if (next && next.targetIndex !== null && transferMinutes !== undefined) {
    nextNotes.set(
      next.targetIndex,
      missed ? (
        <strong class="tf-track__warn">
          Transfer missed by <Approx scheduled={transferScheduled}>{-transferMinutes}</Approx>&nbsp;min
        </strong>
      ) : (
        <>
          <Approx scheduled={transferScheduled}>{transferMinutes}</Approx>&nbsp;min transfer{tight && <strong class="tf-track__warn">, tight</strong>}
        </>
      ),
    );
  }
  return (
    <div class="tf-track">
      <p class="tf-track__where">
        <span class="tf-track__toward">
          {route ? `${routeName} toward` : 'Toward'} {data.headsign}
        </span>
        <strong class="tf-track__headline" aria-live="polite">
          {headline}
        </strong>
      </p>
      <div class="tf-track__frame tf-map-frame">
        <LineMap legs={legs} stops={data.stops} label={inWords} rider={position && { x: riderX, y: riderY, accuracy: position.accuracy }} framedAt={refitAt} />
        <div class="tf-track__controls">
          <button type="button" class="tf-map-btn tf-track__fit" aria-pressed={whole} aria-label="Full route" onClick={toggleWhole}>
            <IconFullRoute />
            Full
          </button>
          {/* Drops the stops behind the vehicle and fits the map to the trip from where it is now. */}
          <button type="button" class="tf-map-btn tf-track__fit" onClick={refit} disabled={!spans && !whole} aria-label="Fit the map to the trip from here">
            <IconFit />
            Fit
          </button>
        </div>
      </div>
      {(ageLine || feed === 'offline') && (
        <div class="tf-track__caption">
          {ageLine && <p class={`tf-track__age${age !== null && age > OLD_SECONDS ? ' tf-track__age--old' : ''}`}>{ageLine}</p>}
          {feed === 'offline' && <p class="tf-track__age tf-track__age--old">Offline. This is the last update received.</p>}
        </div>
      )}
      {bar && (
        <TripTimeBar
          times={bar}
          now={now}
          color={nextColor}
          second={nextName}
          minutes={transferMinutes!}
          firstScheduled={Boolean(data.scheduled)}
          secondScheduled={Boolean(next?.scheduled)}
          tight={tight}
        />
      )}
      <Vehicle leg={data} route={route} color={tracked.color}>
        <LegList leg={data} stops={data.stops} labels={labels} now={now} role={mainRole} notes={notes} name={routeName} />
      </Vehicle>
      {next && nextLabels && (
        // The vehicle the rider changes to, from where it is now to where they board it, and on to
        // where they leave it. Where it is goes under its name, as the first vehicle's does above
        // the map.
        <Vehicle leg={next} route={nextRoute} color={transfer?.color} where={legStatus(next, data.stops, 'the transfer stop')}>
          <LegList leg={next} stops={data.stops} labels={nextLabels} now={now} role={nextRole} notes={nextNotes} name={nextName} />
        </Vehicle>
      )}
      {error && <p class="tf-muted">{error}</p>}
    </div>
  );
}

// One vehicle's part of the sheet: its chip, where it heads, and how sure its times are, over its
// stops. A trip the feed predicts none of carries the one Scheduled tag here, so its times and
// countdowns below stay bare (J, 2026-10-03).
function Vehicle({ leg, route, color, where, children }: { leg: TrackLeg; route: Route | undefined; color: string | undefined; where?: string; children: ComponentChildren }) {
  return (
    <section class="tf-track__veh">
      <h3 class="tf-track__veh-head">
        <RouteChip route={route} {...(color ? { color } : {})} />
        <span>toward {leg.headsign}</span>
        {leg.missing === 'canceled' ? (
          <span class="tf-track__state tf-track__warn">Canceled</span>
        ) : leg.scheduled ? (
          <span class="tf-track__sched">Scheduled</span>
        ) : leg.missing === 'not-started' ? (
          <span class="tf-track__state">Not left yet</span>
        ) : leg.missing === 'ended' ? (
          <span class="tf-track__state">Ended</span>
        ) : null}
      </h3>
      {where && <p class="tf-track__veh-where">{where}</p>}
      {children}
    </section>
  );
}

// A leg as the map draws it: `word` names its vehicle beside its marker, and `role` says what the
// rider does at each of their stops on it, under the stop's name.
type Drawn = { leg: TrackLeg; color: string; labels: Map<number, Mark['kind'][]>; word: string; role: (kind: Mark['kind']) => string };
type Rider = { x: number; y: number; accuracy: number };
// A label on the map: the marker it names, in the picture's own units, with the marker's radius in
// screen pixels at any zoom.
type MapLabel = { key: string; x: number; y: number; radius: number; name: string; role?: string };
// `text` is the rider's text size against the usual one, 2 at 200%.
type Measured = { width: number; height: number; text: number; sizes: Record<string, { width: number; height: number }>; blocked: Rect[] };

// Whether the vehicle has passed a stop of its leg. An ended trip has passed every stop.
const passedAt = (leg: TrackLeg, index: number) => (leg.nextIndex === null ? leg.missing === 'ended' : index < leg.nextIndex);

// Marker sizes, in the map's unit (see `unit` in LineMap): a stop the vehicle only passes, one of
// the rider's stops, and a vehicle.
const STOP_R = 0.75;
const MARK_R = 1.4;
const VEHICLE_R = 2.2;
// A route's shape can hold thousands of points. Labels keep off the lines by this many at most,
// which is plenty at the size of a phone and cheap enough to do again on every frame of a pinch.
const LINE_POINTS = 120;
const thinned = (line: [number, number][]) => {
  const step = Math.ceil(line.length / LINE_POINTS);
  return line.filter((_, index) => index % step === 0 || index === line.length - 1);
};

// Each leg's line in its route's color over a darker casing, its stops as small rings, the rider's
// stops as larger ones (solid at the destination), and its vehicle as a dark ring around its
// route's color, the transfer's drawn first so the rider's own vehicle sits on top. Beside the
// vehicles and the rider's stops, labels say what each is, so no marker's shape or color is the
// only thing telling them apart. A walk between the stop they get off at and the one they board is
// a dashed line. Sizes are in meters, scaled to the picture, so a long ride and a short one look
// alike. North is up.
// `framedAt` is when the rider last asked for the picture framed afresh, with Fit or Full, which
// undoes any zoom of theirs too.
function LineMap({ legs, stops, label, rider, framedAt }: { legs: Drawn[]; stops: Record<string, Stop>; label: string; rider: Rider | null; framedAt: number }) {
  const [measured, setMeasured] = useState<Measured | null>(null);
  // The frame fits the lines and stops, which stay put on a pinned map, so the picture holds still
  // as the vehicles move. A vehicle off the padded frame, as before its trip starts, widens it.
  const route: [number, number][] = legs.flatMap(({ leg }) => [...leg.line, ...leg.path.map(({ x, y }): [number, number] => [x, y])]);
  const xs = route.map(([x]) => x);
  // SVG's y axis points down.
  const ys = route.map(([, y]) => -y);
  const span = Math.max(300, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  // Room around the trip for the labels beside its end stops.
  const pad = span * 0.16;
  // Within half the padding, so its marker stays in the picture too.
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
  // At most a little taller than wide, and at most three wide to two tall, so it fits a phone and
  // leaves the labels room. Larger text makes larger labels, so the picture grows taller with it
  // to keep room for them. A band along the bottom is left clear for the Full and Fit buttons.
  const clear = span * 0.18;
  let width = Math.max(...xs) - Math.min(...xs) + pad * 2;
  let height = Math.max(...ys) - Math.min(...ys) + pad * 2 + clear;
  width = Math.max(width, height / 1.2);
  height = Math.max(height, (width / 1.5) * Math.min(1.8, Math.max(1, measured?.text ?? 1)));
  const left = (Math.max(...xs) + Math.min(...xs)) / 2 - width / 2;
  const top = (Math.max(...ys) + Math.min(...ys)) / 2 - (height - clear) / 2;
  // Pinched in, it shows down to a few blocks across.
  const map = useMapView({ left, top, width, height }, Math.max(1, Math.min(8, Math.max(width, height) / 400)));
  const framed = useRef(framedAt);
  useEffect(() => {
    if (framed.current === framedAt) return;
    framed.current = framedAt;
    map.recenter();
  }, [framedAt]);
  const shown = map.box;
  // Sizes follow the picture as shown, so markers and lines keep their size on screen at any zoom.
  const unit = Math.max(shown.width, shown.height) / 70;
  // Where the rider gets off, and where they board the next vehicle, when those differ.
  const [next, main] = legs.length === 2 ? legs : [null, legs[0]!];
  const off = main && [...main.labels].find(([, kinds]) => kinds.includes('transfer'))?.[0];
  const getOff = off === undefined ? undefined : main!.leg.path[off];
  const board = next && next.leg.targetIndex !== null ? next.leg.path[next.leg.targetIndex] : undefined;
  // Getting off and boarding at one place is one transfer, drawn and named once.
  const oneStop = getOff !== undefined && board !== undefined && Math.hypot(getOff.x - board.x, getOff.y - board.y) <= 15;

  // The labels, most important first, as one with no room left for it is left off the map: the
  // rider's stops in the order they reach them, then the vehicles.
  const labels: MapLabel[] = [];
  const stopLabels = (drawn: Drawn, prefix: string, skip: (kind: Mark['kind']) => boolean) => {
    for (const [index, kinds] of [...drawn.labels].sort(([a], [b]) => a - b)) {
      const place = drawn.leg.path[index];
      if (!place || skip(kinds[0]!)) continue;
      labels.push({ key: `${prefix}${index}`, x: place.x, y: -place.y, radius: MARK_R + 0.5, name: shortStopName(stops[place.stop], place.stop), role: drawn.role(kinds[0]!) });
    }
  };
  // The pointer that gives a vehicle's bearing reaches past its ring.
  const vehicleLabel = (drawn: Drawn, key: string) => drawn.leg.vehicle && labels.push({ key, x: drawn.leg.vehicle.x, y: -drawn.leg.vehicle.y, radius: VEHICLE_R + 1.7, name: drawn.word });
  // Stops first, as they stay put and their names are long. A vehicle's one word fits beside them.
  stopLabels(main!, 'stop-', () => false);
  if (next) stopLabels(next, 'next-', (kind) => kind === 'transfer');
  vehicleLabel(main!, 'vehicle');
  if (next) {
    vehicleLabel(next, 'next-vehicle');
    if (!oneStop) stopLabels(next, 'board-', (kind) => kind !== 'transfer');
  }

  // The labels are HTML over the map, not text in the drawing, so they follow the rider's text
  // size and wrap like any other text. They are measured once drawn, with the map and the buttons
  // over it, and placed from that.
  const layer = useRef<HTMLDivElement>(null);
  const wording = labels.map(({ key, name, role }) => `${key}:${name}:${role}`).join('|');
  useLayoutEffect(() => {
    const svg = map.ref.current;
    const frame = svg?.parentElement;
    if (!svg || !frame || !layer.current) return;
    const measure = () => {
      const box = svg.getBoundingClientRect();
      const sizes: Measured['sizes'] = {};
      for (const element of layer.current!.children as Iterable<HTMLElement>) sizes[element.dataset.key!] = { width: element.offsetWidth, height: element.offsetHeight };
      // The buttons and hints over the map's corners, where they show.
      const blocked = [...frame.querySelectorAll<HTMLElement>('.tf-track__controls, .tf-map-recenter, .tf-map-hint')]
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0)
        .map((rect) => ({ left: rect.left - box.left, top: rect.top - box.top, width: rect.width, height: rect.height }));
      const text = parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1;
      const now = { width: box.width, height: box.height, text, sizes, blocked };
      setMeasured((before) => (JSON.stringify(before) === JSON.stringify(now) ? before : now));
    };
    measure();
    // The map changes size with the sheet, and a label with the rider's text size.
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    for (const element of layer.current.children) observer.observe(element);
    return () => observer.disconnect();
  }, [wording, map.moved, map.zoomed, map.hint]);
  const lines = useMemo(() => legs.map(({ leg }) => thinned(leg.line)), legs.map(({ leg }) => leg.line));
  const placed = new Map<string, { left: number; top: number; align: string }>();
  if (measured && measured.width > 0) {
    // The drawing is fitted inside its box and centered, as SVG does with a viewBox.
    const scale = Math.min(measured.width / shown.width, measured.height / shown.height);
    const px = (x: number, y: number): [number, number] => [(x - shown.left) * scale + (measured.width - shown.width * scale) / 2, (y - shown.top) * scale + (measured.height - shown.height * scale) / 2];
    const asks = labels.flatMap(({ key, x, y, radius }) => {
      const size = measured.sizes[key];
      const [cx, cy] = px(x, y);
      return size ? [{ key, x: cx, y: cy, radius: radius * unit * scale, ...size }] : [];
    });
    // No label covers a marker another label names.
    const markers = asks.map(({ x, y, radius }) => ({ left: x - radius, top: y - radius, width: radius * 2, height: radius * 2 }));
    const walked = getOff && board && !oneStop ? [[px(getOff.x, -getOff.y), px(board.x, -board.y)]] : [];
    // A stop the vehicle only passes counts as a short stretch of line across it, so a label
    // keeps off its ring as it does the line.
    const passing = legs.flatMap(({ leg, labels: marked }) =>
      leg.path.flatMap(({ x, y }, index) => {
        if (marked.has(index)) return [];
        const [cx, cy] = px(x, -y);
        const r = (STOP_R + 0.3) * unit * scale;
        return [[[cx - r, cy] as const, [cx + r, cy] as const], [[cx, cy - r] as const, [cx, cy + r] as const]];
      }),
    );
    const drawnLines = [...lines.map((line) => line.map(([x, y]) => px(x, -y))), ...walked, ...passing];
    for (const { key, ...at } of placeLabels(asks, [...measured.blocked, ...markers], drawnLines, measured)) placed.set(key, at);
  }
  return (
    <>
    <Recenter map={map} />
    <MapHint map={map} />
    <svg
      ref={map.ref}
      class={`tf-track__map${map.zoomed ? ' tf-map--zoomed' : ''}`}
      style={{ touchAction: map.touchAction }}
      viewBox={`${shown.left} ${shown.top} ${shown.width} ${shown.height}`}
      {...map.widget}
      aria-label={label}
    >
      <g aria-hidden="true">
      {legs.map(({ leg }, n) => (
        <polyline key={`casing-${n}`} points={leg.line.map(([x, y]) => `${x},${-y}`).join(' ')} class="tf-track__casing" stroke-width={unit * 1.8} />
      ))}
      {legs.map(({ leg, color }, n) => (
        <polyline key={`line-${n}`} points={leg.line.map(([x, y]) => `${x},${-y}`).join(' ')} class="tf-track__line" stroke={color} stroke-width={unit * 1.2} />
      ))}
      {getOff && board && !oneStop && (
        <line x1={getOff.x} y1={-getOff.y} x2={board.x} y2={-board.y} class="tf-track__walk" stroke-width={unit * 0.45} stroke-dasharray={`${unit * 0.8} ${unit * 0.6}`} stroke-linecap="round" />
      )}
      {legs.map((drawn, n) => (
        <LegStops key={`stops-${n}`} drawn={drawn} unit={unit} skipTransfer={drawn === next && oneStop} />
      ))}
      {/* The rider over the stops, as they are often at one, and under the vehicles. */}
      {rider && nearby && (
        <YouMarker x={rider.x} y={-rider.y} dot={unit * 1.3} ring={unit * 0.6} halo={Math.max(unit * 2.4, Math.min(rider.accuracy, span * 0.2))} />
      )}
      {legs.map((drawn, n) => (
        <LegVehicle key={`vehicle-${n}`} drawn={drawn} unit={unit} />
      ))}
      </g>
    </svg>
    {/* Hidden from screen readers with the drawing: the map's own label says all of it. Until
        measured, and with no room, a label is in the page but not shown. */}
    <div ref={layer} class="tf-track__labels" aria-hidden="true">
      {labels.map(({ key, name, role }) => {
        const at = placed.get(key);
        return (
          <span key={key} data-key={key} class={`tf-track__label tf-track__label--${at?.align ?? 'center'}`} style={at ? { left: `${at.left}px`, top: `${at.top}px` } : { visibility: 'hidden' }}>
            <strong>{name}</strong>
            {role && <span>{role}</span>}
          </span>
        );
      })}
    </div>
    </>
  );
}

// One leg's stops, and the rider's stops on it.
function LegStops({ drawn: { leg, color, labels }, unit, skipTransfer }: { drawn: Drawn; unit: number; skipTransfer: boolean }) {
  return (
    <>
      {/* The vehicle's next stop is filled with its color, as its ring is. */}
      {leg.path.map(({ x, y }, index) =>
        labels.has(index) ? null : <circle key={index} cx={x} cy={-y} r={unit * STOP_R} class="tf-track__stop" stroke-width={unit * 0.45} style={index === leg.nextIndex ? { fill: color } : undefined} />,
      )}
      {/* The rider's stops as larger rings: open where they get on and where they change, solid at
          their destination, and struck through once the vehicle has passed them. The label beside
          each says which it is. */}
      {[...labels].map(([index, kinds]) => {
        const place = leg.path[index];
        if (!place) return null;
        const kind = kinds[0]!;
        if (kind === 'transfer' && skipTransfer) return null;
        const r = unit * MARK_R;
        return (
          <g key={`mark-${index}`} transform={`translate(${place.x} ${-place.y})`}>
            <circle r={r} class={`tf-track__mark-ring tf-track__mark-ring--${kind}`} stroke-width={unit * 0.5} style={index === leg.nextIndex && kind !== 'destination' ? { fill: color } : undefined} />
            {passedAt(leg, index) && (
              <>
                <line x1={-r * 1.5} y1={r * 1.5} x2={r * 1.5} y2={-r * 1.5} class="tf-track__slash-edge" stroke-width={unit * 1.1} stroke-linecap="round" />
                <line x1={-r * 1.5} y1={r * 1.5} x2={r * 1.5} y2={-r * 1.5} class="tf-track__slash" stroke-width={unit * 0.45} stroke-linecap="round" />
              </>
            )}
          </g>
        );
      })}
    </>
  );
}

// A leg's vehicle: a dark ring around its route's color, larger than any stop, with a pointer
// outside it giving the way it heads. The label beside it says what it is.
function LegVehicle({ drawn: { leg, color }, unit }: { drawn: Drawn; unit: number }) {
  if (!leg.vehicle) return null;
  const { x, y, bearing, estimate } = leg.vehicle;
  const r = unit * VEHICLE_R;
  return (
    <g transform={`translate(${x} ${-y})`}>
      {/* Bearing is clockwise from north, as SVG rotates. */}
      {bearing !== null && (
        <path d={`M0 ${-(r + unit * 1.5)} L${unit * 1.1} ${-(r + unit * 0.2)} L${-unit * 1.1} ${-(r + unit * 0.2)} Z`} class="tf-track__heading" stroke-width={unit * 0.3} stroke-linejoin="round" transform={`rotate(${bearing})`} />
      )}
      {/* An estimate is an open, dashed ring, so it does not pass for a reported position. */}
      <circle r={r} class={`tf-track__vehicle${estimate ? ' tf-track__vehicle--estimate' : ''}`} stroke-width={unit * 0.45} stroke-dasharray={estimate ? `${unit * 0.9} ${unit * 0.6}` : undefined} />
      <circle r={unit * 0.9} fill={color} />
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
// has passed, down to the farthest labeled stop. Each row leads with the minutes until the vehicle
// is due there, in the left column as every row in the app has them, then the stop with what the
// rider does there, then the clock time. Runs of stops between the labeled ones fold into one row
// that opens on a tap, since one stop takes no more room than a row saying so. With no position, it
// starts at the first stop drawn.
// `role` words a labeled stop, and `notes` add to a row's second line, such as the transfer.
function LegList({ leg, stops, labels, now, role, notes, name }: {
  leg: TrackLeg;
  stops: Record<string, Stop>;
  labels: Map<number, Mark['kind'][]>;
  now: number;
  role: (kind: Mark['kind']) => string;
  notes: Map<number, ComponentChildren>;
  name: string;
}) {
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
  // A live vehicle yet to leave its first stop comes then at the soonest (see atLeast).
  const notStarted = leg.missing === 'not-started' && !leg.scheduled;
  // By position, since a loop's path can hold one stop twice.
  const item = (index: number) => {
    const kind = labels.get(index)?.[0];
    const passed = passedAt(leg, index);
    // What the rider does here, whether the vehicle stops here next, and anything more to say,
    // on one line.
    const second: ComponentChildren[] = [...(kind ? [role(kind)] : []), ...(index === nextIndex ? [kind ? 'next stop' : 'Next stop'] : []), ...(notes.has(index) ? [notes.get(index)] : [])];
    return (
      <li key={index} class={`tf-track__row${kind ? ` tf-track__row--mark tf-track__row--${kind}` : ''}${passed ? ' tf-track__row--passed' : ''}`}>
        {/* A canceled trip comes with no times. */}
        <When at={leg.path[index]!.at ?? null} passed={passed} notStarted={notStarted} now={now} />
        <span class="tf-track__row-main">
          <span class="tf-track__stop-name">{shortStopName(stops[leg.path[index]!.stop], leg.path[index]!.stop)}</span>
          {second.length > 0 && (
            <span class="tf-track__row-note">
              {second.map((part, n) => (
                <>
                  {n > 0 && ' · '}
                  {part}
                </>
              ))}
            </span>
          )}
        </span>
        <Clock at={leg.path[index]!.at ?? null} passed={passed} now={now} />
      </li>
    );
  };
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
          {/* A dotted stretch of line in the number column, standing for the stops folded away. */}
          <span class="tf-track__more-line" aria-hidden="true" />
          <span class="tf-track__more-text">
            {run.length} stops
            <IconFold size={16} />
          </span>
        </button>
        <Collapse open={isOpen} id={`${between}-${run[0]}`}>
          <ol class="tf-track__stops tf-track__stops--between">{run.map(item)}</ol>
        </Collapse>
      </li>
    );
  };
  return (
    <ol class="tf-track__stops" aria-label={`${name} stops`}>
      {rows.map((row) => (Array.isArray(row) ? (row.length > 1 ? fold(row) : item(row[0]!)) : item(row)))}
    </ol>
  );
}

// The minutes until the vehicle is due at a stop, as the results count down. A stop behind the
// vehicle says it has passed. A trip from the schedule alone is marked once, on its vehicle's
// heading, so the minutes stay bare here.
function When({ at, passed, notStarted, now }: { at: number | null; passed: boolean; notStarted: boolean; now: number }) {
  if (passed) return <span class="tf-track__num tf-track__num--passed">Passed</span>;
  if (at === null) return <span class="tf-track__num" />;
  const minutes = minutesUntil(at, now);
  if (!notStarted && minutes < 1) {
    return (
      <span class="tf-track__num">
        <span class="tf-track__num-n">Now</span>
      </span>
    );
  }
  return (
    <span class="tf-track__num">
      <span class="tf-track__num-n">
        {notStarted ? (
          <>
            {atLeast(minutes).slice(0, -1)}
            <Plus />
          </>
        ) : (
          minutes
        )}
      </span>{' '}
      <span class="tf-track__num-u">min</span>
    </span>
  );
}

// The clock time beside it. Positions and predictions arrive apart, so the clock is kept on the
// right side of now: a stop passed early never shows a time to come, nor a stop ahead a time gone.
function Clock({ at, passed, now }: { at: number | null; passed: boolean; now: number }) {
  if (at === null) return null;
  return <span class="tf-track__time">{clock(passed ? Math.min(at, now / 1000) : Math.max(at, now / 1000))}</span>;
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
