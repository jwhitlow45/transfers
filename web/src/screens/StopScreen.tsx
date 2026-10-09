import { useEffect, useState } from 'preact/hooks';
import type { NearbyArrival, NearbyStop, StopResponse } from '../../../shared/api.ts';
import { AlertList } from '../components/AlertList.tsx';
import { Collapse } from '../components/Collapse.tsx';
import { BottomBar } from '../components/BottomBar.tsx';
import { DataCredit } from '../components/DataCredit.tsx';
import { LiveBanners } from '../components/Banners.tsx';
import { PinToggle } from '../components/PinToggle.tsx';
import { ScreenHeader } from '../components/ResultsHeader.tsx';
import { RouteChip } from '../components/RouteChip.tsx';
import { SkeletonResults } from '../components/SkeletonResults.tsx';
import { StatusTag } from '../components/StatusTag.tsx';
import { StopPinCard } from '../components/StopPinCard.tsx';
import { Toast, useToast } from '../components/Toast.tsx';
import { useSearchRecords } from '../records.ts';
import { clock, minutesUntil, untilText } from '../format.ts';
import { useSwipeBack } from '../gestures.ts';
import { useNow, usePoll, useStopPin } from '../hooks.ts';
import { IconChevron } from '../icons/ui.tsx';
import { viewAlerts } from '../lib/alerts.ts';
import { routeColor } from '../lib/color.ts';
import { liveClock } from '../lib/freshness.ts';
import { samePin } from '../lib/pinned.ts';
import { stopApiUrl, stopPinOf } from '../lib/stop-pins.ts';
import { goBack } from '../router.ts';
import { useSettings } from '../settings.tsx';
import {
  type Pin,
  type Search,
  rememberRecent,
} from '../storage.ts';
import { TimeLink } from '../track.tsx';
import { chipLabel, statusOf } from '../view.ts';

// A row's arrivals until it is opened for the rest the server sent.
const SHOWN = 3;

// What comes to one stop, with no transfer (J, 2026-10-09): each route and direction boarding
// there, as Nearby shows them, with its next three arrivals and more on a tap. Each arrival's time
// opens its map, and a tap anywhere else on it pins it, to Home's top as a pinned trip is. The
// stop saves to Home too, as a card of its arrivals.
export function StopScreen({ search }: { search: Search }) {
  const { settings } = useSettings();
  const { data, error, fetchedAt, feed, settled, answered, refresh } = usePoll<StopResponse>(stopApiUrl(search.from), 30_000);
  const { now, fresh, showStale, secondsSinceUpdate } = liveClock({ data, fetchedAt, settled }, useNow());
  useSwipeBack(() => goBack());
  useEffect(() => {
    if (data) rememberRecent(search);
  }, [Boolean(data)]);

  const { toast, show: showToast, clear: clearToast } = useToast();
  // Whether the stop is saved, the arrival pinned to it, and the notices dismissed, as on results
  // (see useSearchRecords).
  const records = useSearchRecords(search, showToast);
  const { saved, pin, changePin, dismissedIds, dismiss } = records;
  useStopPin(pin, data, answered, search, settings, now, changePin);
  const pinFromStop = (next: Pin | null) => records.pinWithUndo(next, data?.routes);
  const allAlerts = data ? viewAlerts(data, new Set([data.stop, ...data.rows.map(({ stop }) => stop)]), { elevators: settings.stepFree, escalators: settings.escalatorOutages }) : [];
  const alerts = allAlerts.filter(({ id }) => !dismissedIds.has(id));
  // Saved by the stop's own name, in the color of its busiest route.
  const toggleSaved = () => {
    const busiest = data?.rows[0] && data.routes[data.rows[0].routes[0]!];
    records.toggleSaved(search.fromLabel, busiest ? routeColor(busiest) : null);
  };

  const [opened, setOpened] = useState<Record<string, boolean>>({});
  // A row's arrivals that have not gone by since the latest times came.
  const rows = (data?.rows ?? []).map((row) => ({ row, arrivals: row.arrivals.filter(({ at }) => minutesUntil(at, now) >= 0) }));
  const rowKey = (row: NearbyStop) => `${row.stop}|${row.routes.join(',')}|${row.direction}`;

  return (
    <>
      <div class="tf-scroll">
        <ScreenHeader title={<span class="tf-chain__step">{search.fromLabel}</span>} feed={feed} secondsSinceUpdate={secondsSinceUpdate} stale={showStale} onRefresh={refresh} />
        <main class="tf-page" id="main">
          <LiveBanners feed={feed} fresh={fresh} showStale={showStale} secondsSinceUpdate={secondsSinceUpdate} />
          {error && (
            <div class="tf-empty" role="alert">
              <div class="tf-empty__title">{error}</div>
            </div>
          )}
          {pin && <StopPinCard pin={pin} data={data} now={now} offline={feed === 'offline'} stale={null} onPin={pinFromStop} />}
          {data && <AlertList key={data.stop} alerts={alerts} dismissed={allAlerts.length - alerts.length} onDismiss={dismiss} />}
          {!data && feed === 'loading' && <SkeletonResults />}
          {data && rows.length === 0 && (
            <div class="tf-empty">
              <div class="tf-empty__title">No routes stop here</div>
            </div>
          )}
          {data && (
            <div class="tf-near-grid">
              {rows.map(({ row, arrivals }) => {
                const key = rowKey(row);
                const routes = row.routes.map((route) => data.routes[route]).filter((route) => route !== undefined);
                const more = arrivals.slice(SHOWN);
                const arrival = (item: NearbyArrival) => {
                  const minutes = minutesUntil(item.at, now);
                  const route = data.routes[item.route];
                  const name = `${route ? chipLabel(route) : 'Vehicle'} at ${clock(item.at)}`;
                  const next = stopPinOf(item, row, search);
                  const pinned = pin !== null && samePin(pin, next);
                  return (
                    <li key={item.trip} class={pinned ? 'tf-arrival--pinned' : undefined}>
                      <PinToggle pinned={pinned} label={`the ${name}`} onToggle={() => pinFromStop(pinned ? null : next)} />
                      {routes.length > 1 && <RouteChip route={route} size="sm" label={route?.agency === 'BA' ? route.name : undefined} />}
                      <span class="tf-near__time">
                        <TimeLink trip={item.trip} stop={data.stops[row.stop]} title={name} marks={[{ stop: row.stop, kind: 'yours' }]} pin={{ pinned, label: `the ${name}`, set: (on) => pinFromStop(on ? next : null) }}>
                          {clock(item.at)}
                        </TimeLink>
                      </span>
                      <StatusTag status={statusOf(item.delay, item.live)} plain />
                      <span class="tf-near__in">{untilText(minutes)}</span>
                    </li>
                  );
                };
                return (
                  <article key={key} class="tf-near" aria-label={`${routes.map(({ name }) => name).join(', ')} toward ${row.headsign}`}>
                    <div class="tf-near__head">
                      <h2 class="tf-group__title">
                        {routes.map((route) => (
                          <RouteChip key={route.key} route={route} iconSize={18} label={routes.length > 1 && route.agency === 'BA' ? route.name : undefined} />
                        ))}
                        <span>
                          <span aria-hidden="true">→ </span>
                          <span class="tf-sr">toward </span>
                          {row.headsign}
                        </span>
                      </h2>
                    </div>
                    {arrivals.length > 0 ? (
                      <ul class="tf-near__times tf-near__times--pins" aria-label="Next arrivals">
                        {arrivals.slice(0, SHOWN).map(arrival)}
                      </ul>
                    ) : (
                      <p class="tf-near__none tf-muted">None coming soon</p>
                    )}
                    {/* Opens as the app's other folds do, with a chevron that turns, rather than as a
                        link, which here goes somewhere or does one thing. */}
                    {more.length > 0 && (
                      <>
                        <button type="button" class="tf-near__more" aria-expanded={Boolean(opened[key])} aria-controls={`more-${key}`} onClick={() => setOpened({ ...opened, [key]: !opened[key] })}>
                          <IconChevron size={18} />
                          {more.length} more {more.length === 1 ? 'time' : 'times'}
                        </button>
                        <Collapse open={Boolean(opened[key])} id={`more-${key}`}>
                          <ul class="tf-near__times tf-near__times--pins" aria-label="Later arrivals">
                            {more.map(arrival)}
                          </ul>
                        </Collapse>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          )}
          <DataCredit />
        </main>
      </div>
      <BottomBar windowText={null} saved={saved !== null} failed={Boolean(error) && !data} onBack={() => goBack()} onToggleSaved={toggleSaved}>
        <Toast message={toast} onDone={clearToast} />
      </BottomBar>
    </>
  );
}
