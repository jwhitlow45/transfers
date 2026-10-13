import { type ComponentChildren, Fragment } from 'preact';
import type { Group, Route } from '../../../shared/api.ts';
import { walkMinutes } from '../format.ts';
import { IconGerbil } from '../icons/ui.tsx';
import { groupStops, outagesByStation } from '../lib/outages.ts';
import { type CardContext, alightVerb, cardLeft, familyName, firstNoun, firstWord, pointId, ridesStraightTo, visibleDepartures } from '../lib/results.ts';
import { agencyName, shortStopName, windowText } from '../view.ts';
import { DepartureCard } from './DepartureCard.tsx';
import { Departed } from './Departed.tsx';
import { OutageTag } from './Outages.tsx';
import { RouteChip } from './RouteChip.tsx';
import { StopLink } from './StopLink.tsx';
import { EmptyState } from './EmptyState.tsx';
import { useSettings } from '../settings.tsx';

// One group per connecting route, or per transfer point when To is a route. Up to 3 departures.
export function TransferPointGroup({ group, context, isExpanded, onToggle, onWiden, onShowHidden }: {
  group: Group;
  context: CardContext;
  // Whether a departure's card is open, given whether it is the group's first. A card is named by
  // its group and trip, since one trip can show in two groups and each card opens on its own.
  isExpanded: (card: string, first: boolean) => boolean;
  onToggle: (card: string, first: boolean) => void;
  onWiden: (window: { min: number; max: number }) => void;
  onShowHidden: () => void;
}) {
  const { data } = context;
  const board = data.stops[group.board];
  const alight = data.stops[group.alight];
  const routes = group.routes.map((key) => data.routes[key]).filter((route) => route !== undefined);
  // What the rider boards at From, ahead of what they change to, as several can lead to one place
  // to change, and one place to change can follow several (J, 2026-10-12). A walk group has none.
  const firstRoutes = group.kind === 'walk' ? [] : group.firstRoutes.map((key) => data.routes[key]).filter((route) => route !== undefined);
  // Going to a stop, a pooled group names the routes its departures take, when any do, as it may
  // hold some that run only at other hours, such as owl buses. Its identity keeps them all.
  const taken = routes.filter((route) => group.departures.some(({ canceled, route: key }) => !canceled && key === route.key));
  const titleRoutes = context.going && taken.length > 0 ? taken : routes;
  const colorOf = context.colorOf;
  const departures = visibleDepartures(group, context.now, context.showHidden, true);
  const noun = firstNoun(group, data);
  const boardName = shortStopName(board, group.board);
  const alightName = shortStopName(alight, group.alight);
  const sameStop = group.alight === group.board;
  const routeLabel = familyName(group.routes, data);
  const station = board?.serves ? 'BART and Muni Metro station' : board ? `${agencyName(board)} station` : null;
  const boardLink = <StopLink stop={board}>{boardName}</StopLink>;
  const place = joined([board?.direction, <>at {boardLink}</>, board?.code ? `stop ${board.code}` : station]);
  // Cards whose vehicles have all left fold into one section above the rest. Inside it they open,
  // as the rider looking there wants their rows.
  const left = departures.filter((departure) => !departure.canceled && cardLeft(group, departure, context.now));
  const ahead = departures.filter((departure) => !left.includes(departure));
  const firstOpen = ahead.find(({ canceled }) => !canceled)?.trip;
  const opensFirst = (departure: (typeof departures)[number]) => departure.trip === firstOpen || left.includes(departure);
  // By station, so one with both out says so once: "Elevator and escalator out at 24th St Mission".
  const outages = outagesByStation(data.access ?? [], groupStops(group));
  const walk = group.kind === 'walk';
  // Rows that get off at another stop may walk farther than the group's own stop.
  const { walkSpeed } = useSettings().settings;
  const shortest = walkMinutes(group.walkMeters, walkSpeed);
  const longest = walkMinutes(group.longestWalkMeters ?? group.walkMeters, walkSpeed);
  const walkTime = longest > shortest ? `${shortest}–${longest}` : `${shortest}`;
  const routeNames = familyName(group.routes, data);
  const plural = group.routes.length > 1 && !/^(BART|Muni Metro)/.test(routeNames);
  // A ride straight to the named To stop says so, as it may stop across the street from it, or at
  // a station by its corner. It does not say no transfer is needed: on the transfers tab the rider
  // may be going there to catch something, and transfers at To can sit beside it (J, 2026-10-08).
  const straightTo = ridesStraightTo(group, context.going ? undefined : context.destination) ? context.toName : null;
  const goes = straightTo && `${routeNames} ${plural ? 'go' : 'goes'} straight to ${straightTo}`;
  // Where to get off says it once here, so each row only needs the time. A walk group has no
  // first vehicle: the route is right here, or a short walk away.
  const off = walk ? (
    group.walkMeters < 15 ? (
      goes ? (
        `${goes[0]!.toUpperCase()}${goes.slice(1)}`
      ) : (
        `No transfer needed: ${routeNames} ${plural ? 'stop' : 'stops'} here`
      )
    ) : goes ? (
      <>
        Walk {shortest}&nbsp;min to {boardLink}, then {goes}
      </>
    ) : (
      <>
        No transfer needed: walk {shortest}&nbsp;min to {boardLink}
      </>
    )
  ) : sameStop ? (
    <>Transfer at {boardLink}</>
  ) : (
    <>
      {alightVerb(group, data)} <StopLink stop={alight}>{alightName}</StopLink>&nbsp;·{' '}
      <span class="tf-walk-gerbil" aria-hidden="true">
        <IconGerbil />
      </span>
      {walkTime}&nbsp;min walk
    </>
  );
  const card = (departure: (typeof departures)[number]) => (
    <DepartureCard
      key={departure.trip}
      departure={departure}
      group={group}
      next={ahead.slice(ahead.indexOf(departure) + 1).find(({ canceled }) => !canceled)}
      boardName={boardName}
      alightName={alightName}
      noun={noun}
      walk={walk}
      allLeft={left.includes(departure)}
      expanded={isExpanded(`${pointId(group)}|${departure.trip}`, opensFirst(departure))}
      onToggle={() => onToggle(`${pointId(group)}|${departure.trip}`, opensFirst(departure))}
      colorOf={colorOf}
      context={context}
    />
  );
  return (
    <section class="tf-group">
      <div>
        <h2 class="tf-group__title">
          {firstRoutes.length > 0 && (
            <>
              {chips(firstRoutes, colorOf)}
              <span class="tf-group__then" aria-hidden="true">
                ›
              </span>
              <span class="tf-sr">then </span>
            </>
          )}
          {chips(titleRoutes, colorOf)}
          {/* Going to a stop, every vehicle in a group heads the rider's way, so the header names no
              direction, and each departure says where it goes. Catching a route, the direction is
              the choice (J, 2026-10-12). */}
          {!context.going && (
            <span>
              <span aria-hidden="true">→ </span>
              <span class="tf-sr">toward </span>
              {group.headsign}
            </span>
          )}
        </h2>
        <div class="tf-group__meta">{place}</div>
        <div class="tf-group__off">{off}</div>
        {/* An elevator or escalator out where the rider gets off or changes, for riders who asked. */}
        {outages.length > 0 && (
          <div class="tf-outage-tags">
            {outages.map((station) => (
              <OutageTag key={station.station} outages={station} data={data} onOpen={() => context.showOutages(station)} />
            ))}
          </div>
        )}
      </div>
      {left.length > 0 && (
        <Departed count={walk ? left.length : left.reduce((sum, { connections }) => sum + connections.length, 0)} place={shortStopName(data.stops[data.from], data.from)}>
          {left.map(card)}
        </Departed>
      )}
      {/* Rows that have left are no use to a rider still at From, so with only those, the group
          says nothing connects, and offers what might. */}
      {ahead.length === 0 && walk ? (
        <EmptyState title={`No ${routeLabel.replace(/^the /, '')} coming soon`} />
      ) : ahead.length === 0 ? (
        <EmptyState title={`No ${firstWord(group, data)} connects to ${routeLabel} within ${keepUnit(windowText(group.window))}`}>
          <div class="tf-muted">{group.widen ? 'The closest connections fall just outside your window.' : 'Nothing connects in the next few hours.'}</div>
          {group.widen && (
            <button type="button" class="tf-btn-primary" onClick={() => onWiden(group.widen!)}>
              Widen to {keepUnit(windowText(group.widen))}
            </button>
          )}
          {!context.showHidden && (
            <button type="button" class="tf-btn-outline tf-btn-secondary" onClick={onShowHidden}>
              Show hidden connections
            </button>
          )}
        </EmptyState>
      ) : (
        ahead.map(card)
      )}
    </section>
  );
}

const SYSTEM_CHIP = '#1d2d3d';

// A group's routes as chips, each BART line by its color when there are several. A group pooling
// BART and Muni Metro would carry nine chips. One per system says the same, and each departure
// still shows its own line.
function chips(routes: Route[], colorOf: CardContext['colorOf']) {
  if (routes.length > 4) return familyChips(routes);
  return routes.map((route) => <RouteChip key={route.key} route={route} iconSize={18} color={colorOf(route.key)} label={routes.length > 1 && route.agency === 'BA' ? route.name : undefined} />);
}

function familyChips(routes: Route[]) {
  const bart = routes.find(({ agency }) => agency === 'BA');
  const metro = routes.find(({ mode }) => mode === 'light-rail');
  const others = routes.filter((route) => route.agency !== 'BA' && route.mode !== 'light-rail');
  return (
    <>
      {bart && <RouteChip route={bart} iconSize={18} color={SYSTEM_CHIP} label="BART" />}
      {metro && <RouteChip route={metro} iconSize={18} color={SYSTEM_CHIP} label="Muni Metro" />}
      {others.map((route) => (
        <RouteChip key={route.key} route={route} iconSize={18} />
      ))}
    </>
  );
}

// A number and its unit stay on one line: "3–12 min" never wraps before "min".
const keepUnit = (text: string) => text.replace(/ min\b/g, '\u00a0min');

// Parts of a line joined by " · ", leaving out the empty ones.
function joined(parts: (ComponentChildren | null | undefined | false)[]) {
  return parts.filter(Boolean).map((part, index) => (
    <Fragment key={index}>
      {index > 0 && ' · '}
      {part}
    </Fragment>
  ));
}
