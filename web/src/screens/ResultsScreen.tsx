import { useEffect, useMemo, useState } from 'preact/hooks';
import type { TripResponse } from '../../../shared/api.ts';
import { apiUrl, takeInitialData } from '../api.ts';
import { AlertList } from '../components/AlertList.tsx';
import { FeedOutages, LiveBanners } from '../components/Banners.tsx';
import { OutageSheet, OutageTag } from '../components/Outages.tsx';
import { PinnedCard } from '../components/PinnedCard.tsx';
import { BottomBar } from '../components/BottomBar.tsx';
import { DataCredit } from '../components/DataCredit.tsx';
import { DirectionSwitcher, SystemSwitcher } from '../components/DirectionSwitcher.tsx';
import { ScreenHeader, TripChain } from '../components/ResultsHeader.tsx';
import { RouteChip } from '../components/RouteChip.tsx';
import { SkeletonResults } from '../components/SkeletonResults.tsx';
import { Toast, useToast } from '../components/Toast.tsx';
import { useSearchRecords } from '../records.ts';
import { TransferPointGroup } from '../components/TransferPointGroup.tsx';
import { type SearchUpdate, TRIP_SETTINGS, TripSettingsSheet } from '../components/TripSettingsSheet.tsx';
import { useSwipeBack } from '../gestures.ts';
import { useNow, usePinnedTrip, usePoll } from '../hooks.ts';
import { walkMinutes, weekdayClock } from '../format.ts';
import { viewAlerts } from '../lib/alerts.ts';
import { type StationOutages, groupStops, outagesByStation } from '../lib/outages.ts';
import { ringsBell } from '../lib/eggs.ts';
import { liveClock } from '../lib/freshness.ts';
import { IconFilter, IconFlag, IconHidden } from '../icons/ui.tsx';
import { type CardContext, chooseDirection, directionChoices, hintKey, orderGroups, pageColors, pointId, scaleFor, timeScale, visibleDepartures } from '../lib/results.ts';
import { summarize } from '../lib/summary.ts';
import { cameBackTo, goBack, navigate, tripPath } from '../router.ts';
import { matchesServerDefaults, useSettings } from '../settings.tsx';
import { type Pin, type Search, clearPinHint, rememberRecent, takePinHint, updateSaved } from '../storage.ts';
import { shortStopName, spokenRoute } from '../view.ts';
import { AppLink } from '../components/AppLink.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { failureOf } from '../lib/failure.ts';

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
  // Open again when the rider comes back from a page they left it for, such as Settings.
  const [settingsOpen, setSettingsOpen] = useState(() => cameBackTo()?.sheet === TRIP_SETTINGS);
  const { toast, show: showToast, clear: clearToast } = useToast();
  // Whether it is saved, the trip pinned to these results, which the results request follows too,
  // and the notices dismissed (see useSearchRecords).
  const records = useSearchRecords(search, showToast);
  const { saved, pin, changePin } = records;
  // Cards the rider opened or closed, by group and trip. Others start as the device's setting
  // says: all open, each group's soonest open, or all closed. Kept across refreshes, which reuse
  // trip ids.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const openAtFirst = (first: boolean) => settings.cards === 'expanded' || (settings.cards === 'first' && first);
  const isExpanded = (card: string, first: boolean) => toggled[card] ?? openAtFirst(first);
  const toggleCard = (card: string, first: boolean) => setToggled((current) => ({ ...current, [card]: !(current[card] ?? openAtFirst(first)) }));
  // Kept with the search as it stands, so Home can show the pin and open these results.
  useEffect(() => {
    if (pin) changePin(pin);
  }, [tripPath(search)]);
  const url = apiUrl.trip(search, settings, showHidden, pin);
  // Results the server put in the page answer this request only if nothing differs from its defaults.
  const initial = useMemo(() => {
    const page = initialData;
    initialData = null;
    // Nor do they follow a pinned trip.
    const matches = page && page.from === search.from && tripTo(page.to) === search.to && matchesServerDefaults(settings) && !search.firstRoutes && !search.secondRoutes && !pin;
    return matches ? { data: page, fetchedAt: initialAt } : null;
  }, []);
  // Stored under the search's own address, so pinning adds no stored copy of its own.
  const { data, error, fetchedAt, feed, settled, answered, refresh } = usePoll<TripResponse>(url, 30_000, initial, apiUrl.trip(search, settings, showHidden));
  // Every time on the page is the server's, so the clock is too.
  const { now, fresh, showStale, secondsSinceUpdate } = liveClock({ data, fetchedAt, settled }, deviceNow);
  const summary = summarize(search, data, now);

  useEffect(() => {
    if (data) rememberRecent(search, summary.via ?? undefined);
  }, [Boolean(data), summary.via]);

  // The pinned trip as its vehicles run now. When it ends moves with them, and with a new
  // destination, and decides when it unpins itself.
  const { pinned, unpinAt, expired } = usePinnedTrip(pin, data, answered, search, settings, now, changePin);
  // Whether this visit shows how to pin, counted once per visit, until the rider first pins.
  const [hint, setHint] = useState(() => !pin && takePinHint());
  // Pinning says what happened, with Undo, and stops showing how to pin.
  const pinFromResults = (next: Pin | null) => {
    if (next) {
      clearPinHint();
      setHint(false);
    }
    records.pinWithUndo(next, data?.routes, next !== null && ringsBell(next, data));
  };
  // Notices the rider dismissed stay hidden here and on every other search, until the Notices
  // page puts them back.
  const { dismissedIds, dismiss } = records;
  const allAlerts = data ? viewAlerts(data, summary.boarding, { elevators: settings.stepFree, escalators: settings.escalatorOutages }) : [];
  const alerts = allAlerts.filter(({ id }) => !dismissedIds.has(id));
  const dismissedHere = allAlerts.length - alerts.length;

  useSwipeBack(() => goBack());

  const update: SearchUpdate = (change) => {
    const next = change(search);
    if (saved) updateSaved(next);
    navigate(tripPath(next), { replace: true });
  };
  const toggleSaved = () => records.toggleSaved(`${summary.from} to ${summary.to}`, summary.lineColor);

  const groups = summary.groups;
  const scaleMinutes = scaleFor(groups, now);
  // Groups with something to catch first, then by the soonest departure.
  const ordered = orderGroups(groups, now, showHidden, search.dest);
  // Elevator and escalator outages: each transfer point tags those where it gets off or changes,
  // and the rest, such as where the rider starts or is going, lead the results. Each opens what
  // BART says about it.
  const [outagesOpen, setOutagesOpen] = useState<StationOutages | null>(null);
  const tagged = new Set(ordered.flatMap((group) => [...groupStops(group)]));
  const untagged = outagesByStation((data?.access ?? []).filter(({ stops }) => !stops.some((stop) => tagged.has(stop))));
  // The first card with connections says how to pin.
  const hintGroup = hint ? ordered.find((group) => group.kind !== 'walk') : undefined;
  // Route filters can leave every transfer point with nothing to catch. Each would then say nothing
  // connects, which is not so, and offer hidden connections, which the filters hide too, so the
  // page says the filters are why instead. A window too narrow says so in its group, with Widen.
  const filtering = Boolean(search.firstRoutes?.length || search.secondRoutes?.length);
  const filteredOut = filtering && groups.length > 0 && groups.every((group) => !group.widen && visibleDepartures(group, now, showHidden).every(({ canceled }) => canceled));
  const routeNames = (keys: string[] | undefined) => keys?.map((key) => (data?.routes[key] ? spokenRoute(data.routes[key]!) : null)).filter(Boolean).join(' or ');
  const firstNames = routeNames(search.firstRoutes);
  const secondNames = routeNames(search.secondRoutes);
  const filterText =
    firstNames && secondNames
      ? `Showing only the ${firstNames}, then the ${secondNames}`
      : firstNames
        ? `Showing only trips that start on the ${firstNames}`
        : secondNames
          ? `Showing only transfers to the ${secondNames}`
          : 'Showing only some routes';
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
  // A request the server refused, such as for a stop no longer in the schedule, is no live time.
  // With no results at all, there is nothing to set or save either.
  const failure = failureOf(error, 'Results');
  const failed = error !== null && !data;
  const window = summary.window ?? { min: search.min ?? 3, max: search.max ?? 12 };
  const hide = search.hide ?? settings.hide;
  // The header chip takes the same color its group gives it, which may have stepped away from a clash.
  const toColor = summary.toRoute && data ? context.colorOf(summary.toRoute.key) : undefined;
  const toChip = summary.toRoute ? <RouteChip route={summary.toRoute} {...(toColor ? { color: toColor } : {})} /> : <span>{summary.to}</span>;
  // The return trip heads back by the transfer point the rider pinned, or else the first ride the
  // page lists, past the points and routes they turned off.
  const backPoint = pin?.first ? { alight: pin.first.alight, board: pin.second.board } : ordered.find((group) => group.kind !== 'walk');
  const wayBackUrl = apiUrl.wayBack(url, backPoint && { alight: backPoint.alight, board: backPoint.board });
  const destinationsUrl = apiUrl.destinations(url);

  return (
    <>
      <div class="tf-scroll">
        <ScreenHeader
          title={<TripChain from={summary.from} via={summary.via} to={toChip} />}
          feed={feed}
          secondsSinceUpdate={secondsSinceUpdate}
          stale={showStale}
          failed={failure}
          // What changes the results that the page shows nowhere else. The bottom bar has the transfer
          // window, and hidden connections shown are plain in the rows (J, 2026-10-08).
          items={[
            ...(hide > 0 ? [{ key: 'hide', icon: <IconHidden />, short: `<${hide}m`, full: `Hiding departures that leave in under ${hide} minutes` }] : []),
            ...(filtering
              ? [{ key: 'routes', icon: <IconFilter />, short: 'Filtered', full: `${filterText}. Trip settings has the rest` }]
              : []),
            // At the end of the line, where its name has the rest of it, cut short where that is too
            // little (J, 2026-10-08).
            ...(search.dest
              ? [{ key: 'dest', icon: <IconFlag />, short: shortStopName(data?.stops[search.dest], search.destLabel?.replace(/ \(\w+\)$/, '') ?? search.dest), full: `Showing when each departure gets you to ${search.destLabel ?? search.dest}. Trip settings changes it` }]
              : []),
          ]}
          accent={saved?.color}
          onRefresh={refresh}
        />
        <main class="tf-page" id="main">
          <LiveBanners feed={feed} fresh={fresh} showStale={showStale} secondsSinceUpdate={secondsSinceUpdate} />
          {data && <FeedOutages feeds={data.feeds} routeKeys={groups.flatMap(({ routes }) => routes)} routes={data.routes} />}
          {failure && (
            <EmptyState alert title={failure.text}>
              <AppLink class="tf-link-button" href="/" back>
                Search again
              </AppLink>
            </EmptyState>
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
          ) : data && (groups.length === 0 || filteredOut) ? (
            <EmptyTrip data={data} search={search} summary={summary} maxWalk={settings.maxWalk} update={update} />
          ) : (
            data && (
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
            )
          )}
          <DataCredit />
        </main>
      </div>
      <BottomBar windowText={summary.windowText} saved={saved !== null} failed={failed} onBack={() => goBack()} onOpen={() => setSettingsOpen(true)} onToggleSaved={toggleSaved}>
        <Toast message={toast} onDone={clearToast} />
      </BottomBar>
      {outagesOpen && data && <OutageSheet outages={outagesOpen} data={data} onClose={() => setOutagesOpen(null)} />}
      {settingsOpen && (
        <TripSettingsSheet
          search={search}
          data={data}
          window={window}
          savedName={saved?.name ?? null}
          chain={summary.chain}
          destinationsUrl={destinationsUrl}
          wayBackUrl={wayBackUrl}
          deviceHide={settings.hide}
          showHidden={showHidden}
          update={update}
          onSave={toggleSaved}
          onShowHidden={setShowHidden}
          onCopied={() => showToast({ text: 'Link copied', about: 'notice' })}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  );
}

// Why nothing showed up, in the rider's terms, with the one thing that might help.
function EmptyTrip({ data, search, summary, maxWalk, update }: { data: TripResponse; search: Search; summary: ReturnType<typeof summarize>; maxWalk: number; update: SearchUpdate }) {
  const notice = data.notice;
  const route = summary.toRoute;
  // "the 48", or a BART line by its color.
  const toName = route ? (route.agency === 'BA' ? `the ${route.name} line` : `the ${summary.to}`) : summary.to;
  const again = (next: number | null, place: string) => (next ? `${place} starts again ${weekdayClock(next)}.` : `${place} does not run in the next few days.`);
  if (notice?.kind === 'idle' && notice.side === 'to') {
    return (
      <EmptyState title={route ? `${capitalize(toName)} isn't running now` : `Nothing boards at ${summary.to} right now`}>
        <div class="tf-muted">{again(notice.next, route ? 'Service' : 'Service there')}</div>
      </EmptyState>
    );
  }
  if (notice?.kind === 'idle') {
    return (
      <EmptyState title={`Nothing from ${summary.from} connects to ${toName} at this hour`}>
        <div class="tf-muted">{again(notice.next, `Service from ${summary.from}`)}</div>
      </EmptyState>
    );
  }
  if (notice?.kind === 'walkable') {
    return (
      <EmptyState title={notice.meters < 15 ? `${shortStopName(data.stops[notice.stop], notice.stop)} is where you start` : `${shortStopName(data.stops[notice.stop], notice.stop)} is a ${walkMinutes(notice.meters)}\u00a0min walk from ${summary.from}`}>
        {notice.meters >= 15 && <div class="tf-muted">Walking there is about as quick as any ride.</div>}
      </EmptyState>
    );
  }
  if (notice?.kind === 'destination') {
    return (
      <EmptyState title={`Nothing from here reaches ${search.destLabel ?? 'your destination'}`}>
        <div class="tf-muted">No route you could transfer to goes on to that stop.</div>
        <button type="button" class="tf-btn-outline tf-btn-secondary" onClick={() => update(({ dest: _dest, destLabel: _label, ...rest }) => rest)}>
          Clear the destination
        </button>
      </EmptyState>
    );
  }
  if (notice?.kind === 'filtered' || data.groups.length > 0) {
    return (
      <EmptyState title="No transfers to show with your route filters">
        <div class="tf-muted">Trip settings has the routes and directions this search leaves out.</div>
        <button
          type="button"
          class="tf-btn-outline tf-btn-secondary"
          onClick={() => update(({ firstRoutes: _first, secondRoutes: _second, off: _off, ...rest }) => rest)}
        >
          Show every route
        </button>
      </EmptyState>
    );
  }
  return (
    <EmptyState title={`Nothing from ${summary.from} gets within a short walk of ${toName}`}>
      <div class="tf-muted">{maxWalk < 650 ? 'A longer walk between stops, in Settings, may find one.' : 'Try a stop or route closer to where you start.'}</div>
    </EmptyState>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
