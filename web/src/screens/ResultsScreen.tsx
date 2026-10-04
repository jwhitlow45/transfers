import { useEffect, useMemo, useState } from 'preact/hooks';
import type { TripResponse } from '../../../shared/api.ts';
import { takeInitialData } from '../api.ts';
import { AlertList } from '../components/AlertList.tsx';
import { FeedOutageBanner, OfflineBanner, StaleBanner } from '../components/Banners.tsx';
import { BottomBar } from '../components/BottomBar.tsx';
import { DataCredit } from '../components/DataCredit.tsx';
import { DirectionSwitcher, SystemSwitcher } from '../components/DirectionSwitcher.tsx';
import { ScreenHeader, SaveButton, TripChain, liveStatusText } from '../components/ResultsHeader.tsx';
import { RouteChip } from '../components/RouteChip.tsx';
import { SkeletonResults } from '../components/SkeletonResults.tsx';
import { TransferPointGroup } from '../components/TransferPointGroup.tsx';
import { type SearchUpdate, TripSettingsSheet } from '../components/TripSettingsSheet.tsx';
import { useNow, usePoll } from '../hooks.ts';
import { defaultSavedColor } from '../lib/color.ts';
import { viewAlerts } from '../lib/alerts.ts';
import { ageText, clockSkewMs, freshness } from '../lib/freshness.ts';
import { IconHidden, IconTransfer } from '../icons/ui.tsx';
import { type CardContext, chooseDirection, directionChoices, pageColors, pointId, scaleFor, visibleDepartures } from '../lib/results.ts';
import { summarize } from '../lib/summary.ts';
import { navigate, tripPath } from '../router.ts';
import { matchesServerDefaults, tripApiUrl, useSettings } from '../settings.tsx';
import { type Search, findSaved, loadSaved, rememberRecent, removeSaved, saveSearch, updateSaved } from '../storage.ts';
import { agencyOnly, chipLabel, shortStopName } from '../view.ts';

const initialData = takeInitialData<TripResponse>();

export function ResultsScreen({ search }: { search: Search }) {
  const { settings } = useSettings();
  const deviceNow = useNow();
  const [showHidden, setShowHidden] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saved, setSaved] = useState(() => findSaved(search));
  // Cards the rider opened or closed, by departure. Others start as the device's setting says:
  // all open, each group's soonest open, or all closed. Kept across refreshes, which reuse trip
  // ids.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const openAtFirst = (first: boolean) => settings.cards === 'expanded' || (settings.cards === 'first' && first);
  const isExpanded = (trip: string, first: boolean) => toggled[trip] ?? openAtFirst(first);
  const toggleCard = (trip: string, first: boolean) => setToggled((current) => ({ ...current, [trip]: !(current[trip] ?? openAtFirst(first)) }));
  const url = tripApiUrl(search, settings, showHidden);
  // Results the server put in the page answer this request only if nothing differs from its defaults.
  const initial = useMemo(() => {
    const matches = initialData && initialData.from === search.from && matchesServerDefaults(settings) && !search.firstRoutes && !search.secondRoutes;
    return matches ? initialData : null;
  }, []);
  const { data, error, fetchedAt, feed, settled, refresh } = usePoll<TripResponse>(url, 30_000, initial);
  // Every time on the page is the server's, so the clock is too.
  const skew = clockSkewMs(data?.generatedAt, fetchedAt);
  const now = deviceNow + skew;
  const fresh = freshness(now, fetchedAt === null ? null : fetchedAt + skew, data?.dataAt ?? null);
  const showStale = fresh.stale && settled;
  const summary = summarize(search, data, now);

  useEffect(() => {
    if (data) rememberRecent(search, summary.via ?? undefined);
  }, [Boolean(data), summary.via]);

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
  const context: CardContext = {
    data: data!,
    now,
    scaleMinutes,
    pct: (unixSeconds) => Math.max(0, Math.min(100, ((unixSeconds * 1000 - now) / 60_000 / scaleMinutes) * 100)),
    destinationName: search.dest ? shortStopName(data?.stops[search.dest], search.destLabel ?? '') : null,
    // Riding straight to a named stop, the arrival there is what the rider is after.
    toName: data && 'stop' in data.to ? shortStopName(data.stops[data.to.stop]) : null,
    showHidden,
    colorOf: data ? pageColors(groups, data) : () => '#55575a',
  };
  const secondsSinceUpdate = fresh.ageSeconds ?? (fetchedAt === null ? null : Math.max(0, Math.floor((now - fetchedAt) / 1000)));
  const window = summary.window ?? { min: search.min ?? 3, max: search.max ?? 12 };
  const hide = search.hide ?? settings.hide;
  // Groups with something to catch first, then by the soonest departure.
  const firstAt = (group: (typeof groups)[number]) => visibleDepartures(group, now, showHidden).find(({ canceled }) => !canceled)?.at ?? Infinity;
  const ordered = [...groups].sort((a, b) => firstAt(a) - firstAt(b));
  const footer = saved ? `Saved with “${saved.name}”` : 'Applies to this search. Save it to keep these settings.';
  const outages = (data?.feeds ?? []).filter(({ state }) => state === 'down' || state === 'stale');
  const liveAgencies = (data?.feeds ?? []).filter(({ state }) => state === 'live').map(({ agency }) => agencyOnly(agency));
  const routesOf = (agency: string) =>
    [...new Set(groups.flatMap(({ routes }) => routes).filter((key) => key.startsWith(`${agency}:`)).map((key) => (data?.routes[key] ? chipLabel(data.routes[key]!) : key)))].join(', ');
  // The header chip takes the same color its group gives it, which may have stepped away from a clash.
  const toColor = summary.toRoute && data ? context.colorOf(summary.toRoute.key) : undefined;
  const toChip = summary.toRoute ? <RouteChip route={summary.toRoute} {...(toColor ? { color: toColor } : {})} /> : <span>{summary.to}</span>;
  const params = new URLSearchParams(url.split('?')[1]);
  params.delete('hidden');
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
          action={<SaveButton saved={saved !== null} onToggle={toggleSaved} />}
          accent={saved?.color}
          onBack={() => navigate('/')}
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
              <a class="tf-link-button" href="/" onClick={(event) => (event.preventDefault(), navigate('/'))}>
                Search again
              </a>
            </div>
          )}
          {data && <AlertList key={data.from} alerts={viewAlerts(data, summary.boarding)} />}
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
      <BottomBar windowText={summary.windowText} onOpen={() => setSettingsOpen(true)} />
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
