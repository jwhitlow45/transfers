import { useState } from 'preact/hooks';
import type { RouteSearchResult, RouteStops, SearchResponse, StopSearchResult } from '../../../shared/api.ts';
import { agencyName, spokenRoute } from '../view.ts';
import { Segmented } from './DirectionSwitcher.tsx';
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
  const along = response.along ?? [];
  const noun = includesRoutes ? 'stop or route' : 'stop';
  const label =
    hits.length === 0 ? `Nothing matches “${query}”` : hits.length === 1 ? `1 ${noun} matches “${query}”` : `${hits.length} ${includesRoutes ? 'stops and routes' : 'stops'} match “${query}”`;
  return (
    <>
      {along.map((route) => (
        <RouteStopList key={route.route} along={route} response={response} onPick={onPick} />
      ))}
      {(hits.length > 0 || along.length === 0) && <HitList label={label} hits={hits} response={response} onPick={onPick} />}
    </>
  );
}

// The stops of a route named in From, one direction at a time, since which side of the street
// the rider stands on decides the stop.
function RouteStopList({ along, response, onPick }: { along: RouteStops; response: SearchResponse; onPick: (hit: SearchHit) => void }) {
  const [shown, setShown] = useState(String(along.directions[0]?.id ?? 0));
  const route = response.routes[along.route];
  const direction = along.directions.find(({ id }) => String(id) === shown) ?? along.directions[0];
  if (!route || !direction) return null;
  const bart = route.agency === 'BA';
  const label = `${bart ? 'Stations' : 'Stops'} on the ${spokenRoute(route)}`;
  return (
    <div class="tf-results" role="region" aria-label={label}>
      <div class="tf-results__label tf-along__head">
        <RouteChip route={route} size="sm" label={bart ? route.name : undefined} />
        {bart ? 'Stations' : 'Stops'} in riding order
      </div>
      {along.directions.length > 1 && (
        <div class="tf-along__way">
          <Segmented
            label={`Which way on the ${bart ? `${route.name} line` : route.name}`}
            options={along.directions.map(({ id, headsign }) => ({ key: String(id), text: headsign, toward: true }))}
            selected={shown}
            onChoose={setShown}
          />
        </div>
      )}
      <div role="list">
        {direction.stops.map((stop) => (
          <div role="listitem" key={stop.key}>
            <button type="button" class="tf-result tf-result--compact" onClick={() => onPick(stop)}>
              <span class="tf-result__top">
                <span class="tf-result__name">{stop.name}</span>
                <span class="tf-result__code">{stop.code ? `Stop ${stop.code}` : 'Station'}</span>
              </span>
              {!bart && stop.direction && <span class="tf-result__dir">{stop.direction}</span>}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function HitList({ label, hits, response, onPick }: { label: string; hits: SearchHit[]; response: SearchResponse; onPick: (hit: SearchHit) => void }) {
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
