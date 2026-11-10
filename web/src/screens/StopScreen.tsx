import { useEffect, useState } from 'preact/hooks';
import type { NearbyArrival, StopResponse } from '../../../shared/api.ts';
import { AlertList } from '../components/AlertList.tsx';
import { BottomBar } from '../components/BottomBar.tsx';
import { DataCredit } from '../components/DataCredit.tsx';
import { FeedOutages, LiveBanners } from '../components/Banners.tsx';
import { ScreenHeader } from '../components/ResultsHeader.tsx';
import { SkeletonResults } from '../components/SkeletonResults.tsx';
import { Toast, useToast } from '../components/Toast.tsx';
import { useSearchRecords } from '../records.ts';
import { useSwipeBack } from '../gestures.ts';
import { useNow, usePoll } from '../hooks.ts';
import { viewAlerts } from '../lib/alerts.ts';
import { routeColor } from '../lib/color.ts';
import { liveClock } from '../lib/freshness.ts';
import { samePin } from '../lib/pinned.ts';
import { stopPinOf } from '../lib/stop-pins.ts';
import { goBack } from '../router.ts';
import { useSettings } from '../settings.tsx';
import {
  type Pin,
  type Search,
  rememberRecent,
} from '../storage.ts';
import { Fold } from '../components/Fold.tsx';
import { ArrivalItem, RouteCard, routesOf, rowKey, upcoming } from '../components/RouteCard.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { failureOf } from '../lib/failure.ts';
import { type StationOutages, outagesByStation } from '../lib/outages.ts';
import { OutageSheet, OutageTag } from '../components/Outages.tsx';
import { AppLink } from '../components/AppLink.tsx';
import { apiUrl } from '../api.ts';
import { ringsBell } from '../lib/eggs.ts';

// A row's arrivals until it is opened for the rest the server sent.
const SHOWN = 3;

// What comes to one stop, with no transfer (J, 2026-10-09): each route and direction boarding
// there, as Nearby shows them, with its next three arrivals and more on a tap. Each arrival's time
// opens its map, and a tap anywhere else on it pins it, to the app's pin bar as a trip is. The
// stop saves to Home too, as a card of its arrivals.
export function StopScreen({ search }: { search: Search }) {
  const { settings } = useSettings();
  const { toast, show: showToast, clear: clearToast } = useToast();
  // Whether the stop is saved, the arrival pinned to it, and the notices dismissed, as on results
  // (see useSearchRecords).
  const records = useSearchRecords(search, showToast);
  const { saved, pin, dismissedIds, dismiss } = records;
  // The pin bar asks after a pinned arrival itself, so the page asks only for the stop's times.
  const { data, error, fetchedAt, feed, settled, refresh } = usePoll<StopResponse>(apiUrl.stop(search.from, settings));
  const { now, fresh, showStale, secondsSinceUpdate } = liveClock({ data, fetchedAt, settled }, useNow());
  useSwipeBack(() => goBack());
  useEffect(() => {
    if (data) rememberRecent(search);
  }, [Boolean(data)]);

  // As on results: a stop no longer in the schedule says so plainly.
  const failure = failureOf(error, 'Arrivals');
  const pinFromStop = (next: Pin | null) => records.pinByRider(next, data?.routes, next !== null && ringsBell(next, data));
  const allAlerts = data ? viewAlerts(data, new Set([data.stop, ...data.rows.map(({ stop }) => stop)]), { elevators: settings.elevatorOutages, escalators: settings.escalatorOutages }) : [];
  const alerts = allAlerts.filter(({ id }) => !dismissedIds.has(id));
  // An elevator or escalator out at the stop's BART station, for riders who asked, as on results.
  const outages = outagesByStation(data?.access ?? []);
  const [outagesOpen, setOutagesOpen] = useState<StationOutages | null>(null);
  // Saved by the stop's own name, in the color of its busiest route.
  const toggleSaved = () => {
    const busiest = data?.rows[0] && data.routes[data.rows[0].routes[0]!];
    records.toggleSaved(search.fromLabel, busiest ? routeColor(busiest) : null);
  };

  const rows = upcoming(data?.rows ?? [], now);

  return (
    <>
      <div class="tf-scroll">
        <ScreenHeader title={<span class="tf-chain__step">{search.fromLabel}</span>} feed={feed} secondsSinceUpdate={secondsSinceUpdate} stale={showStale} failed={failure} onRefresh={refresh} />
        <main class="tf-page" id="main">
          <LiveBanners feed={feed} fresh={fresh} showStale={showStale} secondsSinceUpdate={secondsSinceUpdate} />
          {data && <FeedOutages feeds={data.feeds} routeKeys={data.rows.flatMap(({ routes }) => routes)} routes={data.routes} />}
          {failure && (
            <EmptyState alert title={failure.text}>
              <AppLink class="tf-link-button" href="/" back>
                Search again
              </AppLink>
            </EmptyState>
          )}
          {data && outages.length > 0 && (
            <div class="tf-outage-tags tf-outage-tags--lead">
              {outages.map((station) => (
                <OutageTag key={station.station} outages={station} data={data} onOpen={() => setOutagesOpen(station)} />
              ))}
            </div>
          )}
          {data && <AlertList key={data.stop} alerts={alerts} dismissed={allAlerts.length - alerts.length} onDismiss={dismiss} />}
          {!data && feed === 'loading' && <SkeletonResults />}
          {data && rows.length === 0 && <EmptyState title="No routes stop here" />}
          {data && (
            <div class="tf-near-grid">
              {rows.map(({ row, arrivals }) => {
                const routes = routesOf(row, data.routes);
                const more = arrivals.slice(SHOWN);
                const arrival = (item: NearbyArrival) => {
                  const next = stopPinOf(item, row, search);
                  const pinned = pin !== null && samePin(pin, next);
                  return (
                    <ArrivalItem
                      key={item.trip}
                      arrival={item}
                      route={data.routes[item.route]}
                      chip={routes.length > 1}
                      stop={data.stops[row.stop]}
                      board={row.stop}
                      now={now}
                      pin={{ pinned, set: (on) => pinFromStop(on ? next : null) }}
                    />
                  );
                };
                return (
                  <RouteCard key={rowKey(row)} routes={routes} headsign={row.headsign}>
                    {arrivals.length > 0 ? (
                      <ul class="tf-near__times" aria-label="Next arrivals">
                        {arrivals.slice(0, SHOWN).map(arrival)}
                      </ul>
                    ) : (
                      <p class="tf-near__none tf-muted">None coming soon</p>
                    )}
                    {/* Opens as the app's other folds do, with a chevron that turns, rather than as a
                        link, which here goes somewhere or does one thing. */}
                    {more.length > 0 && (
                      <Fold class="tf-near__more" label={`${more.length} more ${more.length === 1 ? 'time' : 'times'}`}>
                        <ul class="tf-near__times" aria-label="Later arrivals">
                          {more.map(arrival)}
                        </ul>
                      </Fold>
                    )}
                  </RouteCard>
                );
              })}
            </div>
          )}
          <DataCredit />
        </main>
      </div>
      <BottomBar windowText={null} saved={saved !== null} failed={failure !== null && !data} onBack={() => goBack()} onToggleSaved={toggleSaved}>
        <Toast message={toast} onDone={clearToast} />
      </BottomBar>
      {outagesOpen && data && <OutageSheet outages={outagesOpen} data={data} onClose={() => setOutagesOpen(null)} />}
    </>
  );
}
