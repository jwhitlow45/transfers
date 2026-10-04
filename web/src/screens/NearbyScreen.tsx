import { useEffect, useState } from 'preact/hooks';
import type { NearbyResponse, NearbyStop } from '../../../shared/api.ts';
import { DataCredit } from '../components/DataCredit.tsx';
import { OfflineBanner } from '../components/Banners.tsx';
import { ScreenHeader, liveStatusText } from '../components/ResultsHeader.tsx';
import { RouteChip } from '../components/RouteChip.tsx';
import { Schematic } from '../components/Schematic.tsx';
import { SkeletonResults } from '../components/SkeletonResults.tsx';
import { StatusTag } from '../components/StatusTag.tsx';
import { clock, minutesUntil } from '../format.ts';
import { useNow, usePoll } from '../hooks.ts';
import { IconLocation } from '../icons/ui.tsx';
import { navigate } from '../router.ts';
import { agencyName, directionText, shortStopName, statusOf } from '../view.ts';
import type { Picked } from './SearchScreen.tsx';

type Position = { lat: number; lon: number };
type Located = { state: 'idle' | 'asking' | 'denied' | 'unavailable' } | { state: 'found'; position: Position };

// Location is asked for only when the rider taps the button, never on page load.
export function NearbyScreen() {
  const [located, setLocated] = useState<Located>({ state: 'idle' });
  const ask = () => {
    if (!('geolocation' in navigator)) return setLocated({ state: 'unavailable' });
    setLocated({ state: 'asking' });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setLocated({ state: 'found', position: { lat: coords.latitude, lon: coords.longitude } }),
      (error) => setLocated({ state: error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  };
  // Once permission is granted, asking again is silent, so a return visit goes straight to results.
  useEffect(() => {
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((status) => status.state === 'granted' && ask())
      .catch(() => {});
  }, []);

  if (located.state === 'found') return <NearbyResults position={located.position} />;
  return (
    <div class="tf-scroll">
      <ScreenHeader title="Nearby" onBack={() => navigate('/')} />
      <main class="tf-page tf-page--form" id="main">
        <div class="tf-empty">
          <div class="tf-empty__title">See the routes around you</div>
          <div class="tf-muted">Your location is used once to find stops within a few blocks. It is not saved or shared.</div>
          {located.state === 'denied' && (
            <div class="tf-near__problem" role="alert">
              Location is turned off for this site. Turn it on in your browser's site settings, or search by stop name or code.
            </div>
          )}
          {located.state === 'unavailable' && (
            <div class="tf-near__problem" role="alert">
              Your location could not be found. Try again, or search by stop name or code.
            </div>
          )}
          <button type="button" class="tf-btn-primary tf-btn-with-icon" onClick={ask} disabled={located.state === 'asking'}>
            <IconLocation />
            {located.state === 'asking' ? 'Finding you…' : 'Show nearby routes'}
          </button>
          <a class="tf-link-button" href="/" onClick={(event) => (event.preventDefault(), navigate('/'))}>
            Search by name instead
          </a>
        </div>
      </main>
    </div>
  );
}

function NearbyResults({ position }: { position: Position }) {
  // Rounded to about 10 m, so small GPS jitter reuses the same request.
  const url = `/api/nearby?lat=${position.lat.toFixed(4)}&lon=${position.lon.toFixed(4)}`;
  const { data, error, fetchedAt, feed } = usePoll<NearbyResponse>(url, 30_000);
  const now = useNow();
  const secondsSinceUpdate = fetchedAt === null ? null : Math.max(0, Math.floor((now - fetchedAt) / 1000));
  const pick = (row: NearbyStop, as: 'from' | 'to') => {
    const stop = data?.stops[row.stop];
    if (!stop) return;
    const meta = [agencyName(stop), stop.code ? `Stop ${stop.code}` : 'Station', directionText(stop, stop.agency === 'BA' ? undefined : row.headsign)].filter(Boolean).join(' · ');
    const picked: Picked = { key: stop.key, label: stop.name, meta, short: shortStopName(stop) + (stop.code ? ` (${stop.code})` : '') };
    history.pushState({ [as]: picked }, '', '/');
    dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <div class="tf-scroll">
      <ScreenHeader title="Nearby" feed={feed} secondsSinceUpdate={secondsSinceUpdate} onBack={() => navigate('/')} />
      <main class="tf-page" id="main">
        {feed === 'offline' && <OfflineBanner statusText={liveStatusText(feed, secondsSinceUpdate)} />}
        {error && (
          <div class="tf-empty" role="alert">
            <div class="tf-empty__title">{error}</div>
          </div>
        )}
        {!data && feed === 'loading' && <SkeletonResults />}
        {data && <Schematic schematic={data.schematic} routes={data.routes} />}
        {data && data.nearby.length === 0 && (
          <div class="tf-empty">
            <div class="tf-empty__title">No stops within a few blocks</div>
          </div>
        )}
        {data && (
          <div class="tf-near-grid">
            {data.nearby.map((row) => {
              const stop = data.stops[row.stop];
              const routes = row.routes.map((key) => data.routes[key]).filter((route) => route !== undefined);
              const arrivals = row.arrivals.filter(({ at }) => minutesUntil(at, now) >= 0);
              return (
                <article key={`${row.stop}|${row.routes.join(',')}|${row.direction}`} class="tf-near" aria-label={`${routes.map(({ name }) => name).join(', ')} toward ${row.headsign}`}>
                  <div class="tf-near__head">
                    <div class="tf-chips">
                      {routes.map((route) => (
                        <RouteChip key={route.key} route={route} label={routes.length > 1 && route.agency === 'BA' ? route.name : undefined} />
                      ))}
                    </div>
                    <div class="tf-near__toward">toward {row.headsign}</div>
                    <div class="tf-group__meta">
                      {shortStopName(stop, row.stop)}
                      {stop?.code ? ` · Stop ${stop.code}` : ''} · {row.meters} m away
                    </div>
                  </div>
                  <ul class="tf-near__times" aria-label="Next arrivals">
                    {arrivals.length === 0 && <li class="tf-muted">No arrivals in the next few hours</li>}
                    {arrivals.map((arrival) => {
                      const minutes = minutesUntil(arrival.at, now);
                      const route = data.routes[arrival.route];
                      return (
                        <li key={arrival.trip}>
                          {routes.length > 1 && <RouteChip route={route} size="sm" label={route?.agency === 'BA' ? route.name : undefined} />}
                          <span class="tf-near__time">{clock(arrival.at)}</span>
                          <span class="tf-near__in">{minutes < 1 ? 'now' : `${arrival.live ? '' : '~'}${minutes} min`}</span>
                          <StatusTag status={statusOf(arrival.delay, arrival.live)} plain />
                        </li>
                      );
                    })}
                  </ul>
                  <div class="tf-near__actions">
                    <button type="button" class="tf-btn-outline tf-btn-secondary" onClick={() => pick(row, 'from')}>
                      From here
                    </button>
                    <button type="button" class="tf-btn-outline tf-btn-secondary" onClick={() => pick(row, 'to')}>
                      Transfer here
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        <DataCredit />
      </main>
    </div>
  );
}
