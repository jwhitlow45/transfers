import { useEffect, useState } from 'preact/hooks';
import type { NearbyResponse, NearbyStop } from '../../../shared/api.ts';
import { DataCredit } from '../components/DataCredit.tsx';
import { LiveBanners } from '../components/Banners.tsx';
import { ScreenHeader } from '../components/ResultsHeader.tsx';
import { RouteChip } from '../components/RouteChip.tsx';
import { Schematic } from '../components/Schematic.tsx';
import { SkeletonResults } from '../components/SkeletonResults.tsx';
import { StatusTag } from '../components/StatusTag.tsx';
import { StopLink } from '../components/StopLink.tsx';
import { clock, minutesUntil, untilText } from '../format.ts';
import { useNow, usePoll } from '../hooks.ts';
import { IconLocation } from '../icons/ui.tsx';
import { stopLetterColor } from '../lib/color.ts';
import { liveClock } from '../lib/freshness.ts';
import { type LocationProblem, type Position, locate, locationProblemText, takeHanded } from '../lib/location.ts';
import { useSwipeBack } from '../gestures.ts';
import { goBack, navigate, stopPath } from '../router.ts';
import { TimeLink } from '../track.tsx';
import { agencyName, chipLabel, directionText, shortStopName, statusOf, stopLabel } from '../view.ts';
import type { Picked } from './SearchScreen.tsx';

type Located = { state: 'idle' | 'asking' | LocationProblem } | { state: 'found'; position: Position };

// Search asks for the location when the rider taps "Show nearby routes" and opens this screen
// with it. Opened any other way, such as by a reload, it asks only when the rider taps the
// button, never on page load.
export function NearbyScreen() {
  // Here, not in NearbyResults, so the swipe works before and after the rider is found.
  useSwipeBack(() => goBack());
  const [located, setLocated] = useState<Located>(() => {
    const position = takeHanded();
    return position ? { state: 'found', position } : { state: 'idle' };
  });
  const ask = () => {
    setLocated({ state: 'asking' });
    locate().then(
      (position) => setLocated({ state: 'found', position }),
      (problem: LocationProblem) => setLocated({ state: problem }),
    );
  };
  // A pull to refresh looks again in the background, keeping the stops shown meanwhile and if
  // the phone can no longer tell where it is.
  const relocate = () =>
    locate(0).then(
      (position) => setLocated({ state: 'found', position }),
      () => {},
    );
  // Once permission is granted, asking again is silent, so a return visit goes straight to results.
  useEffect(() => {
    if (located.state !== 'idle') return;
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((status) => status.state === 'granted' && ask())
      .catch(() => {});
  }, []);

  if (located.state === 'found') return <NearbyResults position={located.position} onRelocate={relocate} />;
  return (
    <div class="tf-scroll">
      <ScreenHeader title="Nearby" onBack={() => goBack()} />
      <main class="tf-page tf-page--form" id="main">
        <div class="tf-empty">
          <div class="tf-empty__title">See the routes around you</div>
          <div class="tf-muted">Your location is used once to find stops within a few blocks. It is not saved or shared.</div>
          {(located.state === 'denied' || located.state === 'unavailable') && (
            <div class="tf-near__problem" role="alert">
              {locationProblemText(located.state)}
            </div>
          )}
          <button type="button" class="tf-btn-primary tf-btn-with-icon" onClick={ask} disabled={located.state === 'asking'}>
            <IconLocation />
            {located.state === 'asking' ? 'Finding you…' : 'Show nearby routes'}
          </button>
          <a class="tf-link-button" href="/" onClick={(event) => (event.preventDefault(), goBack())}>
            Search by name instead
          </a>
        </div>
      </main>
    </div>
  );
}

function NearbyResults({ position, onRelocate }: { position: Position; onRelocate: () => void }) {
  // Rounded to about 10 m, so small GPS jitter reuses the same request.
  const url = `/api/nearby?lat=${position.lat.toFixed(4)}&lon=${position.lon.toFixed(4)}`;
  const { data, error, fetchedAt, feed, settled, refresh } = usePoll<NearbyResponse>(url, 30_000);
  const { now, fresh, showStale, secondsSinceUpdate } = liveClock({ data, fetchedAt, settled }, useNow());
  // The server leaves out routes with nothing coming. A row whose last arrival has passed since
  // is hidden too, until a refresh brings more.
  const rows = (data?.nearby ?? []).map((row) => ({ row, arrivals: row.arrivals.filter(({ at }) => minutesUntil(at, now) >= 0) })).filter(({ arrivals }) => arrivals.length > 0);
  // A letter for each stop, nearest first, on its cards and its marker on the map, which tells
  // apart stops that share a name and shows which routes use the same one.
  const letters: Record<string, string> = {};
  for (const { row } of rows) letters[row.stop] ??= String.fromCharCode(65 + Object.keys(letters).length);
  const pick = (row: NearbyStop, as: 'from' | 'to') => {
    const stop = data?.stops[row.stop];
    if (!stop) return;
    const meta = [agencyName(stop), stop.code ? `Stop ${stop.code}` : 'Station', directionText(stop, stop.agency === 'BA' ? undefined : row.headsign)].filter(Boolean).join(' · ');
    const picked: Picked = { key: stop.key, label: stop.name, meta, short: shortStopName(stop) + (stop.code ? ` (${stop.code})` : '') };
    navigate('/', { state: { [as]: picked } });
  };

  return (
    <div class="tf-scroll">
      <ScreenHeader
        title="Nearby"
        feed={feed}
        secondsSinceUpdate={secondsSinceUpdate}
        stale={showStale}
        onBack={() => goBack()}
        // A move of more than about 10 m makes a new request by itself, through the new position.
        onRefresh={() => {
          refresh();
          onRelocate();
        }}
      />
      <main class="tf-page" id="main">
        <LiveBanners feed={feed} fresh={fresh} showStale={showStale} secondsSinceUpdate={secondsSinceUpdate} />
        {error && (
          <div class="tf-empty" role="alert">
            <div class="tf-empty__title">{error}</div>
          </div>
        )}
        {!data && feed === 'loading' && <SkeletonResults />}
        {data && <Schematic schematic={data.schematic} routes={data.routes} letters={letters} />}
        {data && rows.length === 0 && (
          <div class="tf-empty">
            <div class="tf-empty__title">{data.schematic.stops.length > 0 ? 'Nothing leaves stops within a few blocks in the next few hours' : 'No stops within a few blocks'}</div>
          </div>
        )}
        {data && (
          <div class="tf-near-grid">
            {rows.map(({ row, arrivals }) => {
              const stop = data.stops[row.stop];
              const routes = row.routes.map((key) => data.routes[key]).filter((route) => route !== undefined);
              return (
                <article key={`${row.stop}|${row.routes.join(',')}|${row.direction}`} class="tf-near" aria-label={`${routes.map(({ name }) => name).join(', ')} toward ${row.headsign}`}>
                  <div class="tf-near__head">
                    <h2 class="tf-group__title">
                      <span class="tf-stop-letter" style={{ background: stopLetterColor(letters[row.stop]!) }} aria-hidden="true">
                        {letters[row.stop]}
                      </span>
                      {routes.map((route) => (
                        <RouteChip key={route.key} route={route} iconSize={18} label={routes.length > 1 && route.agency === 'BA' ? route.name : undefined} />
                      ))}
                      <span>
                        <span aria-hidden="true">→ </span>
                        <span class="tf-sr">toward </span>
                        {row.headsign}
                      </span>
                    </h2>
                    <div class="tf-group__meta">
                      <StopLink stop={stop}>{shortStopName(stop, row.stop)}</StopLink>
                      {stop?.code ? ` · Stop ${stop.code}` : ''} · {row.meters}&nbsp;m away
                    </div>
                  </div>
                  <ul class="tf-near__times" aria-label="Next arrivals">
                    {arrivals.map((arrival) => {
                      const minutes = minutesUntil(arrival.at, now);
                      const route = data.routes[arrival.route];
                      return (
                        <li key={arrival.trip}>
                          {routes.length > 1 && <RouteChip route={route} size="sm" label={route?.agency === 'BA' ? route.name : undefined} />}
                          <span class="tf-near__time">
                            <TimeLink trip={arrival.trip} stop={stop} title={`${route ? chipLabel(route) : 'Vehicle'} at ${clock(arrival.at)}`} marks={[{ stop: row.stop, kind: 'yours' }]}>
                              {clock(arrival.at)}
                            </TimeLink>
                          </span>
                          <StatusTag status={statusOf(arrival.delay, arrival.live)} plain />
                          <span class="tf-near__in">{untilText(minutes)}</span>
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
                    {/* The stop's every route and direction, with no transfer (J, 2026-10-09). */}
                    {stop && (
                      <a class="tf-btn-outline tf-btn-secondary" href={stopPath({ from: stop.key, fromLabel: stopLabel(stop) })} onClick={(event) => (event.preventDefault(), navigate(stopPath({ from: stop.key, fromLabel: stopLabel(stop) })))}>
                        Arrivals
                      </a>
                    )}
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
