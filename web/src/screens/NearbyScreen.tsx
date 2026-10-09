import { useEffect, useState } from 'preact/hooks';
import type { NearbyResponse, NearbyStop } from '../../../shared/api.ts';
import { DataCredit } from '../components/DataCredit.tsx';
import { LiveBanners } from '../components/Banners.tsx';
import { ScreenHeader } from '../components/ResultsHeader.tsx';
import { Schematic } from '../components/Schematic.tsx';
import { SkeletonResults } from '../components/SkeletonResults.tsx';
import { StopLink } from '../components/StopLink.tsx';
import { useNow, usePoll } from '../hooks.ts';
import { IconLocation } from '../icons/ui.tsx';
import { stopLetterColor } from '../lib/color.ts';
import { liveClock } from '../lib/freshness.ts';
import { type LocationProblem, type Position, locate, locationProblemText, takeHanded } from '../lib/location.ts';
import { useSwipeBack } from '../gestures.ts';
import { goBack, navigate, stopPath } from '../router.ts';
import { agencyName, directionText, shortStopName, stopLabel } from '../view.ts';
import type { Picked } from './SearchScreen.tsx';
import { AppLink } from '../components/AppLink.tsx';
import { ArrivalItem, RouteCard, routesOf, rowKey, upcoming } from '../components/RouteCard.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { failureOf } from '../lib/failure.ts';
import { apiUrl } from '../api.ts';

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
        <EmptyState title="See the routes around you">
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
          <AppLink class="tf-link-button" href="/" back>
            Search by name instead
          </AppLink>
        </EmptyState>
      </main>
    </div>
  );
}

function NearbyResults({ position, onRelocate }: { position: Position; onRelocate: () => void }) {
  const { data, error, fetchedAt, feed, settled, refresh } = usePoll<NearbyResponse>(apiUrl.nearby(position), 30_000);
  const { now, fresh, showStale, secondsSinceUpdate } = liveClock({ data, fetchedAt, settled }, useNow());
  const failure = failureOf(error, 'Nearby');
  // The server leaves out routes with nothing coming. A row whose last arrival has passed since
  // is hidden too, until a refresh brings more.
  const rows = upcoming(data?.nearby ?? [], now).filter(({ arrivals }) => arrivals.length > 0);
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
        failed={failure}
        onBack={() => goBack()}
        // A move of more than about 10 m makes a new request by itself, through the new position.
        onRefresh={() => {
          refresh();
          onRelocate();
        }}
      />
      <main class="tf-page" id="main">
        <LiveBanners feed={feed} fresh={fresh} showStale={showStale} secondsSinceUpdate={secondsSinceUpdate} />
        {failure && <EmptyState alert title={failure.text} />}
        {!data && feed === 'loading' && <SkeletonResults />}
        {data && <Schematic schematic={data.schematic} routes={data.routes} letters={letters} />}
        {data && rows.length === 0 && (
          <EmptyState title={data.schematic.stops.length > 0 ? 'Nothing leaves stops within a few blocks in the next few hours' : 'No stops within a few blocks'} />
        )}
        {data && (
          <div class="tf-near-grid">
            {rows.map(({ row, arrivals }) => {
              const stop = data.stops[row.stop];
              const routes = routesOf(row, data.routes);
              const stopPage = stop && stopPath({ from: stop.key, fromLabel: stopLabel(stop) });
              return (
                <RouteCard
                  key={rowKey(row)}
                  routes={routes}
                  headsign={row.headsign}
                  marker={
                    <span class="tf-stop-letter" style={{ background: stopLetterColor(letters[row.stop]!) }} aria-hidden="true">
                      {letters[row.stop]}
                    </span>
                  }
                  meta={
                    <>
                      <StopLink stop={stop}>{shortStopName(stop, row.stop)}</StopLink>
                      {stop?.code ? ` · Stop ${stop.code}` : ''} · {row.meters}&nbsp;m away
                    </>
                  }
                >
                  <ul class="tf-near__times" aria-label="Next arrivals">
                    {arrivals.map((arrival) => (
                      <ArrivalItem key={arrival.trip} arrival={arrival} route={data.routes[arrival.route]} chip={routes.length > 1} stop={stop} board={row.stop} now={now} />
                    ))}
                  </ul>
                  <div class="tf-near__actions">
                    <button type="button" class="tf-btn-outline tf-btn-secondary" onClick={() => pick(row, 'from')}>
                      From here
                    </button>
                    <button type="button" class="tf-btn-outline tf-btn-secondary" onClick={() => pick(row, 'to')}>
                      Transfer here
                    </button>
                    {/* The stop's every route and direction, with no transfer (J, 2026-10-09). */}
                    {stopPage && (
                      <AppLink class="tf-btn-outline tf-btn-secondary" href={stopPage}>
                        Arrivals
                      </AppLink>
                    )}
                  </div>
                </RouteCard>
              );
            })}
          </div>
        )}
        <DataCredit />
      </main>
    </div>
  );
}
