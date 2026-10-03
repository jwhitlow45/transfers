import { useEffect, useState } from 'preact/hooks';
import type { NearbyResponse, NearbyStop } from '../../../shared/api.ts';
import { clock, countdown, lateness, minutesUntil } from '../format.ts';
import { useNow, usePoll } from '../hooks.ts';
import { navigate } from '../router.ts';
import { RouteBadge } from './RouteBadge.tsx';
import { Schematic } from './Schematic.tsx';

type Position = { lat: number; lon: number };
type LocationState = { state: 'idle' | 'asking' | 'denied' | 'unavailable' } | { state: 'found'; position: Position };

// Location is asked for only when the rider taps the button, never on page load.
export function Nearby() {
  const [location, setLocation] = useState<LocationState>({ state: 'idle' });
  const ask = () => {
    if (!('geolocation' in navigator)) return setLocation({ state: 'unavailable' });
    setLocation({ state: 'asking' });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setLocation({ state: 'found', position: { lat: coords.latitude, lon: coords.longitude } }),
      (error) => setLocation({ state: error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  };
  // Asking again is silent once permission was granted, so a return visit goes straight to results.
  useEffect(() => {
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((status) => {
        if (status.state === 'granted') ask();
      })
      .catch(() => {});
  }, []);

  if (location.state !== 'found') {
    return (
      <section class="nearby-start">
        <h1>Nearby</h1>
        {location.state === 'denied' && <p role="alert">Location is turned off for this site. You can still search for stops by name or number.</p>}
        {location.state === 'unavailable' && <p role="alert">Your location could not be found. Try again, or search for stops by name or number.</p>}
        <button type="button" class="primary" onClick={ask} disabled={location.state === 'asking'}>
          {location.state === 'asking' ? 'Finding you…' : 'Show nearby routes'}
        </button>
        <a href="/" onClick={(event) => (event.preventDefault(), navigate('/'))}>
          Search by name instead
        </a>
      </section>
    );
  }
  return <NearbyResults position={location.position} />;
}

function NearbyResults({ position }: { position: Position }) {
  // Rounded to about 10 m, so small GPS jitter reuses the same request.
  const url = `/api/nearby?lat=${position.lat.toFixed(4)}&lon=${position.lon.toFixed(4)}`;
  const { data, error, offline } = usePoll<NearbyResponse>(url, 30_000);
  const now = useNow();
  const pick = (group: NearbyStop, as: 'from' | 'to') => {
    const stop = data?.stops[group.stop];
    if (!stop) return;
    const picked = { key: stop.key, label: [stop.name, stop.code ? `(${stop.code})` : ''].filter(Boolean).join(' ') };
    history.pushState({ [as]: picked }, '', '/');
    dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <section class="nearby">
      <h1>Nearby</h1>
      {offline && <p class="status">Offline, showing the last results</p>}
      {error && <p class="error" role="alert">{error}</p>}
      {data && <Schematic schematic={data.schematic} routes={data.routes} />}
      {data && data.nearby.length === 0 && <p class="empty">No stops within a few blocks.</p>}
      <ul class="nearby-list">
        {data?.nearby.map((group) => {
          const stop = data.stops[group.stop];
          return (
            <li key={`${group.stop}|${group.route}|${group.direction}`} class="nearby-item">
              <div class="nearby-head">
                <RouteBadge route={data.routes[group.route]} />
                <span>
                  toward {group.headsign}
                  <span class="group-detail">
                    {stop?.name}
                    {stop?.code ? ` (${stop.code})` : ''} · {group.meters} m
                  </span>
                </span>
              </div>
              <ul class="arrivals" aria-label="Next arrivals">
                {group.arrivals.every(({ at }) => at * 1000 < now - 60_000) && <li>No more arrivals soon</li>}
                {group.arrivals.filter(({ at }) => minutesUntil(at, now) >= 0).map((arrival) => {
                  const late = lateness(arrival.delay);
                  return (
                    <li key={arrival.trip}>
                      <time class="time">{clock(arrival.at)}</time> <span class="countdown">{countdown(arrival.at, now)}</span>{' '}
                      <span class={`lateness lateness-${arrival.live ? late.tone : 'scheduled'}`}>{arrival.live ? late.text : 'scheduled'}</span>
                    </li>
                  );
                })}
              </ul>
              <div class="nearby-actions">
                <button type="button" class="secondary" onClick={() => pick(group, 'from')}>
                  From here
                </button>
                <button type="button" class="secondary" onClick={() => pick(group, 'to')}>
                  Transfer here
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
