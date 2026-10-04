import type { Group, Route } from '../../../shared/api.ts';
import { walkMinutes } from '../format.ts';
import { type CardContext, alightVerb, familyName, firstNoun, firstWord, pointId, visibleDepartures } from '../lib/results.ts';
import { agencyName, chipLabel, shortStopName, windowText } from '../view.ts';
import { DepartureCard } from './DepartureCard.tsx';
import { RouteChip } from './RouteChip.tsx';

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
  const colorOf = context.colorOf;
  const departures = visibleDepartures(group, context.now, context.showHidden);
  const noun = firstNoun(group, data);
  const boardName = shortStopName(board, group.board);
  const alightName = shortStopName(alight, group.alight);
  const sameStop = group.alight === group.board;
  // BART groups hold every line toward one direction, so each chip names its line.
  const many = routes.length > 1;
  const routeLabel = familyName(group.routes, data);
  const station = board?.serves ? 'BART and Muni Metro station' : board ? `${agencyName(board)} station` : null;
  const place = [board?.direction, `at ${boardName}`, board?.code ? `stop ${board.code}` : station].filter(Boolean).join(' · ');
  const firstOpen = departures.find(({ canceled }) => !canceled)?.trip;
  const walk = group.kind === 'walk';
  // Rows that get off at another stop may walk farther than the group's own stop.
  const shortest = walkMinutes(group.walkMeters);
  const longest = walkMinutes(group.longestWalkMeters ?? group.walkMeters);
  const walkTime = longest > shortest ? `${shortest}–${longest}` : `${shortest}`;
  const routeNames = familyName(group.routes, data);
  // Where to get off says it once here, so each row only needs the time. A walk group has no
  // first vehicle: the route is right here, or a short walk away.
  const off = walk
    ? group.walkMeters < 15
      ? `No transfer needed: ${routeNames} ${group.routes.length > 1 && !/^(BART|Muni Metro)/.test(routeNames) ? 'stop' : 'stops'} here`
      : `No transfer needed: walk ${walkMinutes(group.walkMeters)} min to ${boardName}`
    : sameStop
      ? `Transfer at ${boardName}`
      : `${alightVerb(group, data)} ${alightName} · ${walkTime} min walk`;
  return (
    <section class="tf-group">
      <div>
        <h2 class="tf-group__title">
          {routes.length > 4 ? (
            // A group pooling BART and Muni Metro would carry nine chips. One per system says the
            // same, and each departure still shows its own line.
            familyChips(routes)
          ) : (
            routes.map((route) => (
              <RouteChip key={route.key} route={route} iconSize={18} color={colorOf(route.key)} label={many && route.agency === 'BA' ? route.name : undefined} />
            ))
          )}
          <span>
            <span aria-hidden="true">→ </span>
            <span class="tf-sr">toward </span>
            {group.headsign}
          </span>
        </h2>
        <div class="tf-group__meta">{place}</div>
        <div class="tf-group__off">{off}</div>
      </div>
      {departures.length === 0 && walk ? (
        <div class="tf-empty">
          <div class="tf-empty__title">No {routeLabel.replace(/^the /, '')} coming soon</div>
        </div>
      ) : departures.length === 0 ? (
        <div class="tf-empty">
          <div class="tf-empty__title">
            No {firstWord(group, data)} connects to {routeLabel} within {windowText(group.window)}
          </div>
          <div class="tf-muted">{group.widen ? 'The closest connections fall just outside your window.' : 'Nothing connects in the next few hours.'}</div>
          {group.widen && (
            <button type="button" class="tf-btn-primary" onClick={() => onWiden(group.widen!)}>
              Widen to {windowText(group.widen)}
            </button>
          )}
          {!context.showHidden && (
            <button type="button" class="tf-btn-outline tf-btn-secondary" onClick={onShowHidden}>
              Show hidden connections
            </button>
          )}
        </div>
      ) : (
        departures.map((departure, index) => (
          <DepartureCard
            key={departure.trip}
            departure={departure}
            group={group}
            next={departures.slice(index + 1).find(({ canceled }) => !canceled)}
            boardName={boardName}
            alightName={alightName}
            noun={noun}
            walk={walk}
            expanded={isExpanded(`${pointId(group)}|${departure.trip}`, departure.trip === firstOpen)}
            onToggle={() => onToggle(`${pointId(group)}|${departure.trip}`, departure.trip === firstOpen)}
            colorOf={colorOf}
            context={context}
          />
        ))
      )}
    </section>
  );
}

const SYSTEM_CHIP = '#1d2d3d';

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
