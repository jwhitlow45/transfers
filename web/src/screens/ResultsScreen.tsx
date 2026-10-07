import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { TripResponse } from '../../../shared/api.ts';
import { takeInitialData } from '../api.ts';
import { AlertList } from '../components/AlertList.tsx';
import { FeedOutageBanner, OfflineBanner, StaleBanner } from '../components/Banners.tsx';
import { OutageSheet, OutageTag } from '../components/Outages.tsx';
import { PinnedCard } from '../components/PinnedCard.tsx';
import { BottomBar } from '../components/BottomBar.tsx';
import { DataCredit } from '../components/DataCredit.tsx';
import { DirectionSwitcher, SystemSwitcher } from '../components/DirectionSwitcher.tsx';
import { ScreenHeader, TripChain, liveStatusText } from '../components/ResultsHeader.tsx';
import { RouteChip } from '../components/RouteChip.tsx';
import { SkeletonResults } from '../components/SkeletonResults.tsx';
import { Toast, type ToastMessage } from '../components/Toast.tsx';
import { TransferPointGroup } from '../components/TransferPointGroup.tsx';
import { type SearchUpdate, TripSettingsSheet } from '../components/TripSettingsSheet.tsx';
import { useSwipeBack } from '../gestures.ts';
import { useNow, usePinnedTrip, usePoll } from '../hooks.ts';
import { defaultSavedColor } from '../lib/color.ts';
import { clock, walkMinutes } from '../format.ts';
import { type ViewAlert, viewAlerts } from '../lib/alerts.ts';
import { type StationOutages, groupStops, outagesByStation } from '../lib/outages.ts';
import { samePin } from '../lib/pinned.ts';
import { ageText, clockSkewMs, freshness } from '../lib/freshness.ts';
import { IconHidden, IconTransfer } from '../icons/ui.tsx';
import { type CardContext, chooseDirection, directionChoices, hintKey, pageColors, pointId, scaleFor, timeScale, visibleDepartures } from '../lib/results.ts';
import { summarize } from '../lib/summary.ts';
import { goBack, navigate, tripPath } from '../router.ts';
import { matchesServerDefaults, tripApiUrl, useSettings } from '../settings.tsx';
import {
  type Pin,
  type Search,
  clearPinHint,
  dismissNotice,
  findSaved,
  loadDismissed,
  loadPin,
  loadSaved,
  rememberRecent,
  removeSaved,
  restoreNotice,
  savePin,
  saveSearch,
  takePinHint,
  updateSaved,
} from '../storage.ts';
import { agencyOnly, chipLabel, shortStopName } from '../view.ts';

// The server puts the first trip's results in the page. They seed only the first visit, as of
// when the page arrived: shown again on a later visit, even to the same trip, they would pass
// for new.
let initialData = takeInitialData<TripResponse>();
// When the page, and so the results in it, arrived. The scripts load after, which on a slow
// first visit takes seconds that would otherwise read as clock skew.
const navigation = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
const initialAt = navigation?.responseEnd ? performance.timeOrigin + navigation.responseEnd : Date.now();
const tripTo = (to: TripResponse['to']) => ('route' in to ? `route:${to.route}` : to.stop);

export function ResultsScreen({ search }: { search: Search }) {
  const { settings, update: updateSettings } = useSettings();
  const deviceNow = useNow();
  const { showHidden } = settings;
  const setShowHidden = (shown: boolean) => updateSettings({ showHidden: shown });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saved, setSaved] = useState(() => findSaved(search));
  // Cards the rider opened or closed, by group and trip. Others start as the device's setting
  // says: all open, each group's soonest open, or all closed. Kept across refreshes, which reuse
  // trip ids.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const openAtFirst = (first: boolean) => settings.cards === 'expanded' || (settings.cards === 'first' && first);
  const isExpanded = (card: string, first: boolean) => toggled[card] ?? openAtFirst(first);
  const toggleCard = (card: string, first: boolean) => setToggled((current) => ({ ...current, [card]: !(current[card] ?? openAtFirst(first)) }));
  // The trip the rider pinned to these results, which the results request follows too.
  const [pin, setPin] = useState(() => loadPin(search));
  // Kept with the search as it stands, so Home can show the pin and open these results.
  const changePin = (next: Pin | null) => {
    const kept = next && { ...next, search };
    savePin(search, kept);
    setPin(kept);
  };
  useEffect(() => {
    if (pin) changePin(pin);
  }, [tripPath(search)]);
  const url = tripApiUrl(search, settings, showHidden, pin);
  // Results the server put in the page answer this request only if nothing differs from its defaults.
  const initial = useMemo(() => {
    const page = initialData;
    initialData = null;
    // Nor do they follow a pinned trip.
    const matches = page && page.from === search.from && tripTo(page.to) === search.to && matchesServerDefaults(settings) && !search.firstRoutes && !search.secondRoutes && !pin;
    return matches ? { data: page, fetchedAt: initialAt } : null;
  }, []);
  // Stored under the search's own address, so pinning adds no stored copy of its own.
  const { data, error, fetchedAt, feed, settled, answered, refresh } = usePoll<TripResponse>(url, 30_000, initial, tripApiUrl(search, settings, showHidden));
  // Every time on the page is the server's, so the clock is too.
  const skew = clockSkewMs(data?.generatedAt, fetchedAt);
  const now = deviceNow + skew;
  const fresh = freshness(now, fetchedAt === null ? null : fetchedAt + skew, data?.dataAt ?? null);
  const showStale = fresh.stale && settled;
  const summary = summarize(search, data, now);

  useEffect(() => {
    if (data) rememberRecent(search, summary.via ?? undefined);
  }, [Boolean(data), summary.via]);

  // The pinned trip as its vehicles run now. When it ends moves with them, and with a new
  // destination, and decides when it unpins itself.
  const { pinned, unpinAt, expired } = usePinnedTrip(pin, data, answered, search.dest, settings, now, changePin);
  // Whether this visit shows how to pin, counted once per visit, until the rider first pins.
  const [hint, setHint] = useState(() => !pin && takePinHint());
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastId = useRef(0);
  // Pinning from a row, the pinned card, or a map's sheet says what happened, with Undo putting
  // back whatever was pinned before, in case the tap was not meant.
  // A map's sheet holds this from when it opened, so the pin it replaces is read as it is now.
  const pinFromResults = (next: Pin | null) => {
    const previous = loadPin(search);
    changePin(next);
    if (next) {
      clearPinHint();
      setHint(false);
    }
    const leg = previous?.last?.first ?? previous?.last?.second;
    const route = leg && data?.routes[leg.route];
    const was = leg?.on && route ? `the ${chipLabel(route)} at ${clock(leg.on.at)}` : 'the trip pinned before';
    const text = !next ? 'Unpinned' : previous && !samePin(previous, next) ? `Pinned in place of ${was}` : 'Pinned to the top';
    setToast({ id: ++toastId.current, text, about: next ? 'pin' : 'unpin', undo: () => changePin(previous) });
  };
  // Notices the rider dismissed stay hidden here and on every other search, until the Notices
  // page puts them back. Dismissing says so, with Undo.
  const [dismissed, setDismissed] = useState(loadDismissed);
  const dismissedIds = new Set(dismissed.map(({ id }) => id));
  const allAlerts = data ? viewAlerts(data, summary.boarding, { elevators: settings.stepFree, escalators: settings.escalatorOutages }) : [];
  const alerts = allAlerts.filter(({ id }) => !dismissedIds.has(id));
  const dismissedHere = allAlerts.length - alerts.length;
  const dismiss = ({ id, kicker, title, body, meta, url, severity }: ViewAlert) => {
    dismissNotice({ id, kicker, title, body, meta, url, severity });
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

  useSwipeBack(() => goBack());

  const update: SearchUpdate = (change) => {
    const next = change(search);
    if (saved) updateSaved(next);
    navigate(tripPath(next), { replace: true });
  };
  const toggleSaved = () => {
    if (saved) {
      removeSaved(saved.id);
      setSaved(null);
    } else {
      const taken = loadSaved().map(({ color }) => color).filter((color) => color !== undefined);
      setSaved(saveSearch(search, `${summary.from} to ${summary.to}`, defaultSavedColor(summary.lineColor, taken)));
    }
  };

  const groups = summary.groups;
  const scaleMinutes = scaleFor(groups, now);
  // Groups with something to catch first, then by the soonest departure.
  const firstAt = (group: (typeof groups)[number]) => visibleDepartures(group, now, showHidden).find(({ canceled }) => !canceled)?.at ?? Infinity;
  const ordered = [...groups].sort((a, b) => firstAt(a) - firstAt(b));
  // Elevator and escalator outages: each transfer point tags those where it gets off or changes,
  // and the rest, such as where the rider starts or is going, lead the results. Each opens what
  // BART says about it.
  const [outagesOpen, setOutagesOpen] = useState<StationOutages | null>(null);
  const tagged = new Set(ordered.flatMap((group) => [...groupStops(group)]));
  const untagged = outagesByStation((data?.access ?? []).filter(({ stops }) => !stops.some((stop) => tagged.has(stop))));
  // The first card with connections says how to pin.
  const hintGroup = hint ? ordered.find((group) => group.kind !== 'walk') : undefined;
  const context: CardContext = {
    data: data!,
    now,
    scaleMinutes,
    pct: timeScale(now, scaleMinutes),
    destinationName: search.dest ? shortStopName(data?.stops[search.dest], search.destLabel ?? '') : null,
    // Riding straight to a named stop, the arrival there is what the rider is after.
    toName: data && 'stop' in data.to ? shortStopName(data.stops[data.to.stop]) : null,
    showHidden,
    colorOf: data ? pageColors(groups, data) : () => '#55575a',
    destination: search.dest,
    pin,
    onPin: pinFromResults,
    pinHint: hintGroup ? hintKey(hintGroup, visibleDepartures(hintGroup, now, showHidden)[0]?.trip) : null,
    showOutages: setOutagesOpen,
  };
  const secondsSinceUpdate = fresh.ageSeconds ?? (fetchedAt === null ? null : Math.max(0, Math.floor((now - (fetchedAt + skew)) / 1000)));
  const window = summary.window ?? { min: search.min ?? 3, max: search.max ?? 12 };
  const hide = search.hide ?? settings.hide;
  const footer = saved ? `Saved with “${saved.name}”` : 'Applies to this search. Save it to keep these settings.';
  const outages = (data?.feeds ?? []).filter(({ state }) => state === 'down' || state === 'stale');
  const liveAgencies = (data?.feeds ?? []).filter(({ state }) => state === 'live').map(({ agency }) => agencyOnly(agency));
  const routesOf = (agency: string) =>
    [...new Set(groups.flatMap(({ routes }) => routes).filter((key) => key.startsWith(`${agency}:`)).map((key) => (data?.routes[key] ? chipLabel(data.routes[key]!) : key)))].join(', ');
  // The header chip takes the same color its group gives it, which may have stepped away from a clash.
  const toColor = summary.toRoute && data ? context.colorOf(summary.toRoute.key) : undefined;
  const toChip = summary.toRoute ? <RouteChip route={summary.toRoute} {...(toColor ? { color: toColor } : {})} /> : <span>{summary.to}</span>;
  const params = new URLSearchParams(url.split('?')[1]);
  // The destinations a trip can have do not depend on what is shown or pinned.
  for (const name of ['hidden', 'p1', 'pa', 'pf', 'p2', 'pb', 'pt']) params.delete(name);
  const destinationsUrl = `/api/destinations?${params}`;

  return (
    <>
      <div class="tf-scroll">
        <ScreenHeader
          title={<TripChain from={summary.from} via={summary.via} to={toChip} />}
          feed={feed}
          secondsSinceUpdate={secondsSinceUpdate}
          stale={showStale}
          items={[
            ...(summary.window
              ? [{ key: 'window', icon: <IconTransfer />, short: `${summary.window.min}–${summary.window.max}m`, full: `Showing transfers of ${summary.window.min} to ${summary.window.max} minutes` }]
              : []),
            ...(hide > 0 ? [{ key: 'hide', icon: <IconHidden />, short: `<${hide}m`, full: `Hiding departures that leave in under ${hide} minutes` }] : []),
          ]}
          accent={saved?.color}
          onRefresh={refresh}
        />
        <main class="tf-page" id="main">
          {feed === 'offline' && <OfflineBanner statusText={liveStatusText(feed, secondsSinceUpdate)} />}
          {feed !== 'offline' && showStale && <StaleBanner ageText={ageText(fresh.ageSeconds!)} cause={fresh.cause!} />}
          {outages.map(({ agency }) => (
            <FeedOutageBanner key={agency} agency={agencyOnly(agency)} routes={routesOf(agency)} liveAgencies={liveAgencies.join(' and ')} />
          ))}
          {error && (
            <div class="tf-empty" role="alert">
              <div class="tf-empty__title">{/^No (stop|route)/.test(error) ? "This stop or route isn't in the schedule anymore" : error}</div>
              <a class="tf-link-button" href="/" onClick={(event) => (event.preventDefault(), goBack())}>
                Search again
              </a>
            </div>
          )}
          {pin && data && !expired && (
            <PinnedCard pin={pin} pinned={pinned} data={data} destination={search.dest} colorOf={context.colorOf} pct={context.pct} now={now} unpinAt={unpinAt} onPin={pinFromResults} />
          )}
          {data && untagged.length > 0 && (
            <div class="tf-outage-tags tf-outage-tags--lead">
              {untagged.map((station) => (
                <OutageTag key={station.station} outages={station} data={data} onOpen={() => setOutagesOpen(station)} />
              ))}
            </div>
          )}
          {data && <AlertList key={data.from} alerts={alerts} dismissed={dismissedHere} onDismiss={dismiss} />}
          {data && ((data.systems?.from?.length ?? 0) > 1 || search.fromSystem) && (
            <SystemSwitcher
              label={`From ${shortStopName(data.stops[data.from])}, ride`}
              selected={search.fromSystem}
              onChoose={(system) => update(({ fromSystem: _system, ...rest }) => (system ? { ...rest, fromSystem: system } : rest))}
            />
          )}
          {data && 'stop' in data.to && ((data.systems?.to?.length ?? 0) > 1 || search.toSystem) && (
            <SystemSwitcher
              label={`At ${shortStopName(data.stops[data.to.stop])}, catch`}
              selected={search.toSystem}
              onChoose={(system) => update(({ toSystem: _system, ...rest }) => (system ? { ...rest, toSystem: system } : rest))}
            />
          )}
          {data &&
            directionChoices(data.groups, search.off ?? [], data).map((choice) => (
              <DirectionSwitcher
                key={choice.routes.join(',')}
                choice={choice}
                data={data}
                onChoose={(key) => {
                  const off = chooseDirection(choice, key, search.off ?? []);
                  update((current) => ({ ...current, off: off.length ? off : undefined }));
                }}
              />
            ))}
          {!data && feed === 'loading' ? (
            <SkeletonResults />
          ) : data && groups.length === 0 ? (
            <EmptyTrip data={data} search={search} summary={summary} maxWalk={settings.maxWalk} update={update} />
          ) : (
            data && (
              <>
                <div class="tf-groups">
                  {ordered.map((group) => (
                    <TransferPointGroup
                      key={pointId(group)}
                      group={group}
                      context={context}
                      isExpanded={isExpanded}
                      onToggle={toggleCard}
                      // Widening raises the maximum only. The minimum is the time the walk takes.
                      onWiden={(widened) => update((current) => ({ ...current, max: widened.max }))}
                      onShowHidden={() => setShowHidden(true)}
                    />
                  ))}
                </div>
              </>
            )
          )}
          <DataCredit />
        </main>
      </div>
      <BottomBar windowText={summary.windowText} saved={saved !== null} onBack={() => goBack()} onOpen={() => setSettingsOpen(true)} onToggleSaved={toggleSaved}>
        <Toast message={toast} onDone={() => setToast(null)} />
      </BottomBar>
      {outagesOpen && data && <OutageSheet outages={outagesOpen} data={data} onClose={() => setOutagesOpen(null)} />}
      {settingsOpen && (
        <TripSettingsSheet
          search={search}
          data={data}
          window={window}
          footer={footer}
          chain={summary.chain}
          destinationsUrl={destinationsUrl}
          deviceHide={settings.hide}
          showHidden={showHidden}
          update={update}
          onShowHidden={setShowHidden}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  );
}

const weekdayTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit' });

// Why nothing showed up, in the rider's terms, with the one thing that might help.
function EmptyTrip({ data, search, summary, maxWalk, update }: { data: TripResponse; search: Search; summary: ReturnType<typeof summarize>; maxWalk: number; update: SearchUpdate }) {
  const notice = data.notice;
  const route = summary.toRoute;
  // "the 48", or a BART line by its color.
  const toName = route ? (route.agency === 'BA' ? `the ${route.name} line` : `the ${summary.to}`) : summary.to;
  const again = (next: number | null, place: string) => (next ? `${place} starts again ${weekdayTime.format(next * 1000)}.` : `${place} does not run in the next few days.`);
  if (notice?.kind === 'idle' && notice.side === 'to') {
    return (
      <div class="tf-empty">
        <div class="tf-empty__title">{route ? `${capitalize(toName)} isn't running now` : `Nothing boards at ${summary.to} right now`}</div>
        <div class="tf-muted">{again(notice.next, route ? 'Service' : 'Service there')}</div>
      </div>
    );
  }
  if (notice?.kind === 'idle') {
    return (
      <div class="tf-empty">
        <div class="tf-empty__title">
          Nothing from {summary.from} connects to {toName} at this hour
        </div>
        <div class="tf-muted">{again(notice.next, `Service from ${summary.from}`)}</div>
      </div>
    );
  }
  if (notice?.kind === 'walkable') {
    return (
      <div class="tf-empty">
        <div class="tf-empty__title">
          {notice.meters < 15
            ? `${shortStopName(data.stops[notice.stop], notice.stop)} is where you start`
            : `${shortStopName(data.stops[notice.stop], notice.stop)} is a ${walkMinutes(notice.meters)} min walk from ${summary.from}`}
        </div>
        {notice.meters >= 15 && <div class="tf-muted">Walking there is about as quick as any ride.</div>}
      </div>
    );
  }
  if (notice?.kind === 'destination') {
    return (
      <div class="tf-empty">
        <div class="tf-empty__title">Nothing from here reaches {search.destLabel ?? 'your destination'}</div>
        <div class="tf-muted">No route you could transfer to goes on to that stop.</div>
        <button type="button" class="tf-btn-outline tf-btn-secondary" onClick={() => update(({ dest: _dest, destLabel: _label, ...rest }) => rest)}>
          Clear the destination
        </button>
      </div>
    );
  }
  if (notice?.kind === 'filtered' || data.groups.length > 0) {
    return (
      <div class="tf-empty">
        <div class="tf-empty__title">Your route filters hide every transfer</div>
        <div class="tf-muted">Trip settings has the routes and directions this search leaves out.</div>
        <button
          type="button"
          class="tf-btn-outline tf-btn-secondary"
          onClick={() => update(({ firstRoutes: _first, secondRoutes: _second, off: _off, ...rest }) => rest)}
        >
          Show every route
        </button>
      </div>
    );
  }
  return (
    <div class="tf-empty">
      <div class="tf-empty__title">
        Nothing from {summary.from} gets within a short walk of {toName}
      </div>
      <div class="tf-muted">{maxWalk < 650 ? 'A longer walk between stops, in Settings, may find one.' : 'Try a stop or route closer to where you start.'}</div>
    </div>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
