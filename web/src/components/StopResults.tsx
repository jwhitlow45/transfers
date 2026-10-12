import { useState } from 'preact/hooks';
import type { RouteSearchResult, RouteStops, SearchResponse, StopSearchResult } from '../../../shared/api.ts';
import type { PlaceResult } from '../../../shared/journeys.ts';
import { metersFrom } from '../../../shared/projection.ts';
import type { Position } from '../lib/location.ts';
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
export function StopResults({ query, response, onPick, onPickPlace, includesRoutes, near }: {
  query: string;
  response: SearchResponse;
  onPick: (hit: SearchHit) => void;
  onPickPlace: (place: PlaceResult) => void;
  includesRoutes: boolean;
  // Where the phone says the rider is, when location is already allowed, for how far each place is.
  near: Position | null;
}) {
  const hits = response.results;
  const along = response.along ?? [];
  const places = response.places ?? [];
  const noun = includesRoutes ? 'stop or route' : 'stop';
  const label =
    hits.length === 0 ? `Nothing matches “${query}”` : hits.length === 1 ? `1 ${noun} matches “${query}”` : `${hits.length} ${includesRoutes ? 'stops and routes' : 'stops'} match “${query}”`;
  return (
    <>
      {along.map((route) => (
        <RouteStopList key={route.route} along={route} response={response} onPick={onPick} />
      ))}
      {/* Enter takes the first match, except under a route's own stop list (see SearchScreen). */}
      {(hits.length > 0 || along.length === 0) && (places.length === 0 || hits.length > 0) && <HitList label={label} hits={hits} response={response} onPick={onPick} enterTakesFirst={along.length === 0} />}
      {places.length > 0 && <PlaceList places={places} near={near} onPick={onPickPlace} enterTakesFirst={hits.length === 0 && along.length === 0} />}
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

function HitList({ label, hits, response, onPick, enterTakesFirst }: {
  label: string;
  hits: SearchHit[];
  response: SearchResponse;
  onPick: (hit: SearchHit) => void;
  enterTakesFirst: boolean;
}) {
  return (
    <div class="tf-results" role="region" aria-label={label}>
      <div class="tf-results__label" aria-live="polite">
        {label}
      </div>
      <div role="list">
        {hits.map((hit, index) => {
          const isRoute = hit.type === 'route';
          const route = isRoute ? response.routes[hit.route] : undefined;
          const code = isRoute ? 'Route' : hit.code ? `Stop ${hit.code}` : 'Station';
          const detail = isRoute
            ? `${route ? agencyName(route) : ''} · ${hit.directions.map(({ headsign }) => headsign).join(' ↔ ')}`
            : `${hitAgency(hit)} · ${hitDirection(hit)}`;
          const chips = isRoute ? [hit.route] : hit.routes;
          return (
            <div role="listitem" key={isRoute ? hit.route : hit.key}>
              <button type="button" class={`tf-result${enterTakesFirst && index === 0 ? ' tf-result--enter' : ''}`} onClick={() => onPick(hit)}>
                <span class="tf-result__top">
                  <span class="tf-result__name">
                    {hitName(hit, response)}
                    {enterTakesFirst && index === 0 && <span class="tf-sr"> (Enter picks this)</span>}
                  </span>
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

// Places found by name, from OpenStreetMap, which its credit names under the list, as its license
// asks wherever its data shows. A place is somewhere to walk to or from, so it has no routes. How far
// away each is tells apart a chain's branches, as OpenStreetMap often has no street for them.
function PlaceList({ places, near, onPick, enterTakesFirst }: { places: PlaceResult[]; near: Position | null; onPick: (place: PlaceResult) => void; enterTakesFirst: boolean }) {
  return (
    <div class="tf-results" role="region" aria-label="Places">
      <div class="tf-results__label">Places</div>
      <div role="list">
        {places.map((place, index) => (
          <div role="listitem" key={place.id}>
            <button type="button" class={`tf-result${enterTakesFirst && index === 0 ? ' tf-result--enter' : ''}`} onClick={() => onPick(place)}>
              <span class="tf-result__top">
                <span class="tf-result__name">
                  {place.name}
                  {enterTakesFirst && index === 0 && <span class="tf-sr"> (Enter picks this)</span>}
                </span>
                <span class="tf-result__code">{place.kind}</span>
              </span>
              {(place.street || near) && <span class="tf-result__dir">{[near && distanceText(near, place), place.street].filter(Boolean).join(' · ')}</span>}
            </button>
          </div>
        ))}
      </div>
      <div class="tf-results__credit">
        ©{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">
          OpenStreetMap
        </a>{' '}
        contributors
      </div>
    </div>
  );
}

// "450 m away", or "2.3 km away" past a kilometer.
function distanceText(near: Position, place: Position) {
  const meters = Math.hypot(...metersFrom(near, place));
  return meters < 1000 ? `${Math.max(10, Math.round(meters / 10) * 10)} m away` : `${(meters / 1000).toFixed(1)} km away`;
}
