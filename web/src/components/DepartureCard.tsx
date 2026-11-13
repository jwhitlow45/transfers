import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Departure, Group } from '../../../shared/api.ts';
import { IconFold } from '../icons/ui.tsx';
import { approx, approxMinutes, atLeast, clock, hasLeft, minuteCount, minutesSince, minutesUntil, stillWaiting, untilText } from '../format.ts';
import { pinOf, sameRun } from '../lib/pinned.ts';
import { type CardContext, listedConnections, tripSeconds, tripStart } from '../lib/results.ts';
import { useSettings } from '../settings.tsx';
import { walkSeconds } from '../../../shared/walk.ts';
import { TimeLink } from '../track.tsx';
import { chipLabel, pinLabel, shortStopName, spokenRoute, statusAt, statusOf, vehicleAt } from '../view.ts';
import { Collapse } from './Collapse.tsx';
import { ConnectionRow, connectionMap } from './ConnectionRow.tsx';
import { Departed } from './Departed.tsx';
import { Dots } from './Dots.tsx';
import { PinToggle } from './PinToggle.tsx';
import { RouteChip } from './RouteChip.tsx';
import { Approx, PinnedTag, StatusTag } from './StatusTag.tsx';
import { Name, Whole } from './Whole.tsx';

// One second-leg departure: a reversed band, then every first vehicle that makes it. The band
// opens and closes the card. Closed, it keeps one line of countdowns for those vehicles.
export function DepartureCard({ departure, group, next, alightName, noun, walk, allLeft = false, expanded, onToggle, colorOf, context }: {
  departure: Departure;
  group: Group;
  // The next departure still running, for the canceled note.
  next: Departure | undefined;
  alightName: string;
  noun: readonly [string, string];
  // A route already at or near From: the card is just the departure, with nothing to open.
  walk: boolean;
  // Every vehicle on the card has left, so it sits among those departed and folds none of its own.
  allLeft?: boolean;
  expanded: boolean;
  onToggle: () => void;
  colorOf: (routeKey: string) => string;
  context: CardContext;
}) {
  const route = context.data.routes[departure.route];
  const color = colorOf(departure.route);
  // One trip can appear in two groups, such as BART's and Muni Metro's at a shared station.
  const panel = useId();
  if (departure.canceled) {
    return (
      <div class="tf-canceled">
        <RouteChip route={route} color={color} />
        <span class="tf-canceled__time">{clock(departure.at)}</span>
        <StatusTag status={statusOf(null, true, true)} />
        {next && (
          <span class="tf-canceled__note">
            {`Next ${route ? chipLabel(route) : ''} toward ${group.headsign} at `}
            <Approx scheduled={!next.live}>{clock(next.at)}</Approx>.
          </span>
        )}
      </div>
    );
  }
  const status = statusAt(departure.at, context.now, departure.delay, departure.live, false, departure.notStarted);
  // Yet to leave the first stop of its trip, while it is held as coming (see stillWaiting).
  const notStarted = stillWaiting(departure.at, context.now, departure.notStarted);
  const minutes = minutesUntil(departure.at, context.now);
  // Left where the rider boards it, on its way to the destination: kept so a rider on it can
  // still pin it.
  const left = hasLeft(departure.at, context.now, departure.notStarted);
  const ago = minutesSince(departure.at, context.now);
  const away = left ? (ago < 1 ? 'Just left' : `Left ${ago} min ago`) : null;
  // With no first vehicle, the departure itself is the trip to pin, by tapping its band.
  const walkPinned = walk && context.pin !== null && !context.pin.first && context.pin.second.trip === departure.trip && context.pin.second.board === group.board && sameRun(context.pin.at, departure.at);
  const setWalkPinned = (on: boolean) => context.onPin(on ? pinOf(departure, group.board) : null);
  const walkPinLabel = pinLabel([route, departure.at]);
  const destinationName = context.destinationName ?? (walk ? context.toName : null);
  const destinationShort = context.destinationName ? context.destinationShort : walk ? context.toShort : null;
  // The time there is the schedule's alone when the departure's is, or when no live delay reaches it.
  const destinationScheduled = !departure.live || Boolean(departure.destinationScheduled);
  const destinationAt = departure.destination ? approx(clock(departure.destination), destinationScheduled) : null;
  const destination = destinationName && destinationAt ? `${destinationName} ${destinationAt}` : null;
  // With it, how long the trip takes, from setting off, as the rider may weigh a later one that
  // is quicker (J, 2026-10-12). It is from the schedule when either end is.
  const { walkSpeed } = useSettings().settings;
  const trip = destination ? tripSeconds(departure, walk, walk ? walkSeconds(group.walkMeters, walkSpeed) : 0, context.now) : null;
  const tripMinutes = trip === null ? null : Math.max(1, Math.round(trip / 60));
  const tripScheduled = destinationScheduled || (!walk && tripStart(departure, context.now)?.live === false);
  const toward = departure.toward ? `To ${departure.toward}` : null;
  const count = departure.connections.length;
  // The transfer whose map the band's time opens, with both vehicles on it: the one pinned, or else
  // the next to leave From that the rider can make, then any next to leave, or with all of them
  // gone, the last, which the rider may be on.
  const maps = walk ? [] : departure.connections.map((connection) => ({ connection, map: connectionMap(connection, departure, { alight: group.alight, board: group.board, min: group.window.min, walkMeters: group.walkMeters, secondColor: color, context }) }));
  const ahead = maps.filter(({ connection }) => !hasLeft(connection.departs, context.now, connection.notStarted));
  const leadMap = (maps.find(({ map }) => map.pin.pinned) ?? ahead.find(({ connection }) => !connection.hidden) ?? ahead[0] ?? maps.at(-1))?.map;
  const listed = listedConnections(departure, context.going);
  const countdowns = departure.connections
    .filter(({ departs, notStarted }) => !hasLeft(departs, context.now, notStarted))
    .map(({ departs, live, notStarted }) => ({ minutes: Math.max(0, minutesUntil(departs, context.now)), scheduled: !live, notStarted: notStarted === true }));
  const gone = count - countdowns.length;
  const shownCountdowns = countdowns.map(({ minutes, scheduled, notStarted }) => (notStarted ? atLeast(minutes) : approxMinutes(minutes, scheduled))).join(', ');
  const spokenCountdowns = countdowns.map(({ minutes, scheduled, notStarted }) => (scheduled ? `scheduled ${Math.max(1, minutes)}` : notStarted ? `at least ${Math.max(1, minutes)}` : minutes)).join(', ');
  const summary = [`${count} ${noun[count === 1 ? 0 : 1]}`, gone > 0 && `${gone} departed`, countdowns.length > 0 && `in ${shownCountdowns}\u00a0min`];
  const spokenDestination = destinationName && departure.destination ? `${destinationName} ${clock(departure.destination)}${destinationScheduled ? ' scheduled' : ''}` : null;
  const spoken =
    `${route ? spokenRoute(route) : 'Departure'} at ${clock(departure.at)}, ${status.label}, ` +
    `${away ? away.toLowerCase() : notStarted ? `at least ${minuteCount(Math.max(1, minutes))} away` : `${minuteCount(minutes)} away`}${toward ? `, ${toward.toLowerCase()}` : ''}${spokenDestination ? `, reaches ${spokenDestination}` : ''}${tripMinutes !== null ? `, a ${tripScheduled ? 'scheduled ' : ''}${tripMinutes} minute trip` : ''}.` +
    (walk ? (walkPinned ? ' Pinned.' : '') : ` ${count} connecting ${noun[count === 1 ? 0 : 1]}${expanded ? '' : [gone > 0 && `, ${gone} already left`, countdowns.length > 0 && `, leaving in ${spokenCountdowns} minutes`].filter(Boolean).join('')}.`);
  // The spoken summary says everything shown, so screen readers skip the shown text and reach
  // only the links in it.
  // The countdown's number apart from its "min", which "Now" and "Left" have none of.
  const [until, counted] = left ? ['Left'] : untilText(minutes, notStarted).split('\u00a0');
  const band = (
    <>
      {/* The band is the card's header, so its countdown stays on the right (J, 2026-11-09). Read
          top to bottom: "12 min away", "Now arriving". A vehicle gone says "Left" over how long
          ago, as a departed row does. It comes first, so the band's lines run beside it and then
          under it at the band's full width (see .tf-band__end). On a narrow phone "min" drops
          to the line under its number, so the time beside it keeps to one line (see styles.css). */}
      <span class="tf-end tf-band__end" aria-hidden="true">
        <span class="tf-end__n">
          {until}
          {counted && <span class="tf-band__min">&nbsp;{counted}</span>}
        </span>
        <span class="tf-end__u">
          {counted && <span class="tf-band__min tf-band__min--under">{counted} </span>}
          {left ? (ago < 1 ? 'just now' : `${ago}\u00a0min ago`) : counted ? 'away' : 'arriving'}
        </span>
        {!walk && <IconFold />}
      </span>
      <span class="tf-band__main">
        <span class="tf-band__line">
          <RouteChip route={route} size="band" color={color} hidden />
          <span class="tf-band__time">
            {leadMap ? (
              <TimeLink {...leadMap}>{clock(departure.at)}</TimeLink>
            ) : (
              <TimeLink
                trip={departure.trip}
                stop={context.data.stops[group.board]}
                title={vehicleAt(route, departure.at)}
                color={color}
                // A route already at From is boarded there.
                marks={[{ stop: group.board, kind: 'yours' }]}
                {...(walk ? { pin: { pinned: walkPinned, label: walkPinLabel, set: setWalkPinned } } : {})}
              >
                {clock(departure.at)}
              </TimeLink>
            )}
          </span>
        </span>
        {/* Every status, the Scheduled tag too, has the line under the time, as in every row. */}
        <span class="tf-band__sub" aria-hidden="true">
          <StatusTag status={status} hidden />
        </span>
        {toward && (
          <span class="tf-band__sub tf-band__toward" aria-hidden="true">
            <Name text={toward} />
          </span>
        )}
        {destination && (
          <ArrivalLine name={destinationName!} short={destinationShort} at={destinationAt!} trip={tripMinutes !== null ? `${approx(String(tripMinutes), tripScheduled)}\u00a0min` : null} />
        )}
        {walkPinned && (
          <span class="tf-band__sub" aria-hidden="true">
            <PinnedTag />
          </span>
        )}
      </span>
    </>
  );
  const row = (connection: (typeof departure.connections)[number]) => (
    <ConnectionRow
      key={connection.trip}
      connection={connection}
      departure={departure}
      alightName={alightName}
      alight={group.alight}
      board={group.board}
      min={group.window.min}
      walkMeters={group.walkMeters}
      secondColor={color}
      context={context}
    />
  );
  if (walk) {
    return (
      <article class={`tf-card tf-card--walk${left ? ' tf-card--left' : ''}`}>
        <h3 class="tf-card__heading">
          <span class={`tf-band${walkPinned ? ' tf-band--pinned' : ''}`}>
            <span class="tf-sr">{spoken}</span>
            <PinToggle pinned={walkPinned} label={walkPinLabel} onToggle={() => setWalkPinned(!walkPinned)} />
            {band}
          </span>
        </h3>
      </article>
    );
  }
  // The toggle is a button stretched under the whole band, rather than the band itself, so the
  // time and stop links in the band are their own targets and not buttons inside a button.
  return (
    <article class={`tf-card${expanded ? '' : ' tf-card--closed'}${left ? ' tf-card--left' : ''}`}>
      <h3 class="tf-card__heading">
        <span class="tf-band">
          <button type="button" class="tf-band__toggle" aria-expanded={expanded} aria-controls={panel} onClick={onToggle}>
            <span class="tf-sr">{spoken}</span>
          </button>
          {band}
        </span>
      </h3>
      {/* The rows and the closed card's one-line summary each slide, so they trade places
          smoothly. */}
      <Collapse open={expanded} id={panel}>
        {gone > 0 && !allLeft ? (
          <>
            <Departed count={gone} place={shortStopName(context.data.stops[context.data.from], context.data.from)}>
              <div role="list" aria-label={`Departed ${noun[gone === 1 ? 0 : 1]}`}>
                {listed.filter(({ departs, notStarted }) => hasLeft(departs, context.now, notStarted)).map(row)}
              </div>
            </Departed>
            <div role="list" aria-label={`Connecting ${noun[1]}`}>
              {listed.filter(({ departs, notStarted }) => !hasLeft(departs, context.now, notStarted)).map(row)}
            </div>
          </>
        ) : (
          <div role="list" aria-label={`Connecting ${noun[1]}`}>
            {listed.map(row)}
          </div>
        )}
      </Collapse>
      <Collapse open={!expanded}>
        <div class="tf-card__summary" aria-hidden="true">
          <Dots parts={summary} />
        </div>
      </Collapse>
    </article>
  );
}

// When a departure arrives, and how long the trip takes. Where the line would wrap, a corner's
// short name stands in for its full one (J, 2026-10-13). Laid out full and measured before paint,
// and again whenever its room may have changed.
// The name is one part and its time another (see Whole), so a long name wraps by itself and the
// time stays whole after its last word.
function ArrivalLine({ name, short, at, trip }: { name: string; short: string | null; at: string; trip: string | null }) {
  const full = [name, at, trip ?? ''].join(' ');
  const line = useRef<HTMLSpanElement>(null);
  const [wraps, setWraps] = useState(false);
  // Counts changes to the line's room: its width, and the size of what comes before it in the
  // band. A status that stops wrapping, or a countdown that grows, changes the room the line has
  // with the same width and text. None of these depend on the line,
  // so its own changes never come back here.
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => setWraps(false), [full, short, room]);
  useLayoutEffect(() => {
    if (!wraps && short && line.current && lineCount(line.current) > 1) setWraps(true);
  }, [wraps, full, short, room]);
  useEffect(() => {
    const element = line.current;
    if (!short || !element?.parentElement || typeof ResizeObserver === 'undefined') return;
    // The band's countdown floats beside its lines, outside their block, and narrows them as it grows.
    const end = element.closest('.tf-band')?.querySelector('.tf-band__end');
    const before = [...element.parentElement.children, ...(end ? [end] : [])].filter((child) => child !== element);
    // The line's own height changes as it wraps, so only its width counts.
    const size = (target: Element) => {
      const { width, height } = target.getBoundingClientRect();
      return target === element ? `${Math.round(width)}` : `${Math.round(width)}x${Math.round(height)}`;
    };
    const sizes = new Map([element, ...before].map((target) => [target, size(target)]));
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      for (const { target } of entries) {
        const now = size(target);
        if (now !== sizes.get(target)) changed = true;
        sizes.set(target, now);
      }
      if (changed) setRoom((count) => count + 1);
    });
    for (const target of sizes.keys()) observer.observe(target);
    return () => observer.disconnect();
  }, [short !== null]);
  return (
    <span class="tf-band__sub tf-band__dest" aria-hidden="true" ref={line}>
      <Dots
        parts={[
          <>
            <Name text={wraps && short ? short : name} /> <Whole>{at}</Whole>
          </>,
          trip,
        ]}
      />
    </span>
  );
}

// How many lines a block's text takes.
function lineCount(element: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(element);
  return new Set([...range.getClientRects()].map(({ top }) => Math.round(top))).size;
}
