import type { RouteSearchResult, SearchResponse, StopSearchResult } from '../../../shared/api.ts';
import { agencyName } from '../view.ts';
import { RouteChip } from './RouteChip.tsx';

export type SearchHit = StopSearchResult | RouteSearchResult;

// Muni writes route names in capitals ("FILLMORE").
const titleCase = (text: string) => (text === text.toUpperCase() ? text.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()) : text);

export function hitName(hit: SearchHit, response: SearchResponse) {
  if (hit.type === 'stop') return hit.name;
  const route = response.routes[hit.route];
  return route ? `${route.name} ${titleCase(route.longName)}`.trim() : hit.route;
}

// "Muni · Stop 13477 · Eastbound, toward 22nd St + Iowa St", which tells same-name stops apart.
export function hitMeta(hit: SearchHit, response: SearchResponse) {
  if (hit.type === 'route') {
    const route = response.routes[hit.route];
    return `${route ? agencyName(route) : ''} route`;
  }
  return [hitAgency(hit), hit.code ? `Stop ${hit.code}` : 'Station', hitDirection(hit)].filter(Boolean).join(' · ');
}

// A shared downtown station serves both systems.
const hitAgency = (hit: StopSearchResult) => (hit.serves ? 'BART and Muni Metro' : agencyName(hit));

function hitDirection(hit: StopSearchResult) {
  if (hit.agency === 'BA') return 'Trains in both directions';
  return [hit.direction, hit.toward.length > 0 && `toward ${hit.toward.join(', ')}`].filter(Boolean).join(', ');
}

// A plain list of buttons under a polite live count. It is not a listbox, since there is no
// arrow-key model to go with one.
export function StopResults({ query, response, onPick, includesRoutes }: { query: string; response: SearchResponse; onPick: (hit: SearchHit) => void; includesRoutes: boolean }) {
  const hits = response.results;
  const label = hits.length === 0 ? `Nothing matches “${query}”` : `${hits.length} ${includesRoutes ? 'stops and routes' : 'stops'} match “${query}”`;
  return (
    <div class="tf-results" role="region" aria-label={label}>
      <div class="tf-results__label" aria-live="polite">
        {label}
      </div>
      <div role="list">
        {hits.map((hit) => {
          const isRoute = hit.type === 'route';
          const route = isRoute ? response.routes[hit.route] : undefined;
          const code = isRoute ? 'Route' : hit.code ? `Stop ${hit.code}` : 'Station';
          const detail = isRoute
            ? `${route ? agencyName(route) : ''} · ${hit.directions.map(({ headsign }) => headsign).join(' ↔ ')}`
            : `${hitAgency(hit)} · ${hitDirection(hit)}`;
          const chips = isRoute ? [hit.route] : hit.routes;
          return (
            <div role="listitem" key={isRoute ? hit.route : hit.key}>
              <button type="button" class="tf-result" onClick={() => onPick(hit)}>
                <span class="tf-result__top">
                  <span class="tf-result__name">{hitName(hit, response)}</span>
                  <span class="tf-result__code">{code}</span>
                </span>
                <span class="tf-result__dir">{detail}</span>
                <span class="tf-chips">
                  {chips.map((key) => {
                    const chip = response.routes[key];
                    // A BART station serves several lines, so each chip names its line.
                    return <RouteChip key={key} route={chip} size="sm" label={chip?.agency === 'BA' ? chip.name : undefined} />;
                  })}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
