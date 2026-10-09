import { useEffect, useRef, useState } from 'preact/hooks';
import type { NearbyArrival, NearbyStop, StopResponse } from '../../../shared/api.ts';
import { AlertList } from '../components/AlertList.tsx';
import { Collapse } from '../components/Collapse.tsx';
import { BottomBar } from '../components/BottomBar.tsx';
import { DataCredit } from '../components/DataCredit.tsx';
import { OfflineBanner, StaleBanner } from '../components/Banners.tsx';
import { PinToggle } from '../components/PinToggle.tsx';
import { ScreenHeader, liveStatusText } from '../components/ResultsHeader.tsx';
import { RouteChip } from '../components/RouteChip.tsx';
import { SkeletonResults } from '../components/SkeletonResults.tsx';
import { StatusTag } from '../components/StatusTag.tsx';
import { StopPinCard } from '../components/StopPinCard.tsx';
import { Toast, type ToastMessage } from '../components/Toast.tsx';
import { clock, minutesUntil } from '../format.ts';
import { useSwipeBack } from '../gestures.ts';
import { useNow, usePoll, useStopPin } from '../hooks.ts';
import { IconChevron } from '../icons/ui.tsx';
import { useShownAgain } from '../layers.ts';
import { type ViewAlert, viewAlerts } from '../lib/alerts.ts';
import { defaultSavedColor, routeColor } from '../lib/color.ts';
import { ageText, clockSkewMs, freshness } from '../lib/freshness.ts';
import { samePin } from '../lib/pinned.ts';
import { stopApiUrl, stopPinOf } from '../lib/stop-pins.ts';
import { goBack } from '../router.ts';
import { useSettings } from '../settings.tsx';
import {
  type Pin,
  type Search,
  dismissNotice,
  findSaved,
  loadDismissed,
  loadPin,
  loadSaved,
  rememberRecent,
  removeSaved,
  restoreNotice,
  saveSaved,
  saveSearch,
  savePin,
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
  const skew = clockSkewMs(data?.generatedAt, fetchedAt);
  const now = useNow() + skew;
  const fresh = freshness(now, fetchedAt === null ? null : fetchedAt + skew, data?.dataAt ?? null);
  const showStale = fresh.stale && settled;
  const secondsSinceUpdate = fresh.ageSeconds ?? (fetchedAt === null ? null : Math.max(0, Math.floor((now - (fetchedAt + skew)) / 1000)));
  useSwipeBack(() => goBack());
  useEffect(() => {
    if (data) rememberRecent(search);
  }, [Boolean(data)]);

  const [saved, setSaved] = useState(() => findSaved(search));
  const [pin, setPin] = useState(() => loadPin(search));
  const changePin = (next: Pin | null) => {
    const kept = next && { ...next, search };
    savePin(search, kept);
    setPin(kept);
  };
  useStopPin(pin, data, answered, search, settings, now, changePin);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastId = useRef(0);
  // As on results: what happened, with Undo putting back whatever was pinned before.
  const pinFromStop = (next: Pin | null) => {
    const previous = loadPin(search);
    changePin(next);
    const was = previous?.arrival && data?.routes[previous.arrival.route] ? `the ${chipLabel(data.routes[previous.arrival.route]!)} at ${clock(previous.ends)}` : 'the arrival pinned before';
    const text = !next ? 'Unpinned' : previous && !samePin(previous, next) ? `Pinned in place of ${was}` : 'Pinned to the top';
    setToast({ id: ++toastId.current, text, about: next ? 'pin' : 'unpin', undo: () => changePin(previous) });
  };

  const [dismissed, setDismissed] = useState(loadDismissed);
  // Kept under a page it opens (see main.tsx), it reads storage again on the way back.
  useShownAgain(() => {
    setSaved(findSaved(search));
    setPin(loadPin(search));
    setDismissed(loadDismissed());
  });
  const dismissedIds = new Set(dismissed.map(({ id }) => id));
  const allAlerts = data ? viewAlerts(data, new Set([data.stop, ...data.rows.map(({ stop }) => stop)]), { elevators: settings.stepFree, escalators: settings.escalatorOutages }) : [];
  const alerts = allAlerts.filter(({ id }) => !dismissedIds.has(id));
  const dismiss = ({ id, kicker, title, body, meta, url: link, severity }: ViewAlert) => {
    dismissNotice({ id, kicker, title, body, meta, url: link, severity });
    setDismissed(loadDismissed());
    setToast({
      id: ++toastId.current,
      text: 'Notice dismissed',
      about: 'notice',
      undo: () => {
        restoreNotice(id);
        setDismissed(loadDismissed());
      },
    });
  };

  // Saved by the stop's own name, in the color of its busiest route where that color is free.
  const toggleSaved = () => {
    if (saved) {
      const all = loadSaved();
      const index = all.findIndex(({ id }) => id === saved.id);
      const removed = all[index] ?? saved;
      removeSaved(saved.id);
      setSaved(null);
      setToast({
        id: ++toastId.current,
        text: 'Removed from Saved',
        about: 'unsaved',
        undo: () => {
          const rest = loadSaved().filter(({ id }) => id !== saved.id);
          saveSaved([...rest.slice(0, index), removed, ...rest.slice(index)]);
          setSaved(removed);
        },
      });
      return;
    }
    const busiest = data?.rows[0] && data.routes[data.rows[0].routes[0]!];
    const taken = loadSaved().map(({ color }) => color).filter((color) => color !== undefined);
    const added = saveSearch(search, search.fromLabel, defaultSavedColor(busiest ? routeColor(busiest) : null, taken));
    setSaved(added);
    setToast({
      id: ++toastId.current,
      text: 'Saved to Home',
      about: 'saved',
      undo: () => {
        removeSaved(added.id);
        setSaved(null);
      },
    });
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
          {feed === 'offline' && <OfflineBanner statusText={liveStatusText(feed, secondsSinceUpdate)} />}
          {feed !== 'offline' && showStale && <StaleBanner ageText={ageText(fresh.ageSeconds!)} cause={fresh.cause!} />}
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
                      <span class="tf-near__in">{minutes < 1 ? 'Now' : `${minutes} min`}</span>
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
        <Toast message={toast} onDone={() => setToast(null)} />
      </BottomBar>
    </>
  );
}
