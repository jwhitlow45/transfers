import type { Group } from '../../../shared/api.ts';
import { walkMinutes } from '../format.ts';
import { type CardContext, firstNoun, firstWord, groupColors, visibleDepartures } from '../lib/results.ts';
import { agencyName, chipLabel, shortStopName, windowText } from '../view.ts';
import { DepartureCard } from './DepartureCard.tsx';
import { RouteChip } from './RouteChip.tsx';

// One group per connecting route, or per transfer point when To is a route. Up to 3 departures.
export function TransferPointGroup({ group, kicker, context, isExpanded, onToggle, onWiden, onShowHidden }: {
  group: Group;
  kicker: string | null;
  context: CardContext;
  // Whether a departure's card is open, given whether it is the group's first.
  isExpanded: (trip: string, first: boolean) => boolean;
  onToggle: (trip: string, first: boolean) => void;
  onWiden: (window: { min: number; max: number }) => void;
  onShowHidden: () => void;
}) {
  const { data } = context;
  const board = data.stops[group.board];
  const alight = data.stops[group.alight];
  const routes = group.routes.map((key) => data.routes[key]).filter((route) => route !== undefined);
  const colorOf = groupColors(group, data);
  const departures = visibleDepartures(group, context.now, context.showHidden);
  const noun = firstNoun(group, data);
  const boardName = shortStopName(board, group.board);
  const alightName = shortStopName(alight, group.alight);
  const sameStop = group.alight === group.board;
  // BART groups hold every line toward one direction, so each chip names its line.
  const many = routes.length > 1;
  const routeLabel = many ? (routes[0]?.agency === 'BA' ? 'BART' : routes.map(chipLabel).join(' or ')) : routes[0] ? chipLabel(routes[0]) : '';
  const place = [board?.direction, `at ${boardName}`, board?.code ? `stop ${board.code}` : board ? `${agencyName(board)} station` : null].filter(Boolean).join(' · ');
  const firstOpen = departures.find(({ canceled }) => !canceled)?.trip;
  const firstRoute = group.firstRoutes.length > 0 ? data.routes[group.firstRoutes[0]!] : undefined;
  // Where to get off says it once here, so each row only needs the time.
  const off = sameStop
    ? `Transfer at ${boardName}`
    : `Get off${firstRoute?.agency === 'BA' ? ' BART' : ''} at ${alightName} · ${walkMinutes(group.walkMeters)} min walk`;
  return (
    <section class="tf-group">
      <div>
        {kicker && <div class="tf-kicker">{kicker}</div>}
        <h2 class="tf-group__title">
          {routes.map((route) => (
            <RouteChip key={route.key} route={route} iconSize={18} color={colorOf(route.key)} label={many && route.agency === 'BA' ? route.name : undefined} />
          ))}
          <span>
            <span aria-hidden="true">→ </span>
            <span class="tf-sr">toward </span>
            {group.headsign}
          </span>
        </h2>
        <div class="tf-group__meta">{place}</div>
        <div class="tf-group__off">{off}</div>
      </div>
      {departures.length === 0 ? (
        <div class="tf-empty">
          <div class="tf-empty__title">
            No {firstWord(group, data)} connects to the {routeLabel} within {windowText(group.window)}
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
            expanded={isExpanded(departure.trip, departure.trip === firstOpen)}
            onToggle={() => onToggle(departure.trip, departure.trip === firstOpen)}
            colorOf={colorOf}
            context={context}
          />
        ))
      )}
    </section>
  );
}
