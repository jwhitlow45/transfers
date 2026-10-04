import { useEffect, useMemo, useState } from 'preact/hooks';
import type { TripResponse } from '../../../shared/api.ts';
import { takeInitialData } from '../api.ts';
import { AlertList } from '../components/AlertList.tsx';
import { FeedOutageBanner, OfflineBanner } from '../components/Banners.tsx';
import { BottomBar } from '../components/BottomBar.tsx';
import { DataCredit } from '../components/DataCredit.tsx';
import { DirectionSwitcher } from '../components/DirectionSwitcher.tsx';
import { ScreenHeader, SaveButton, TripChain, liveStatusText } from '../components/ResultsHeader.tsx';
import { RouteChip } from '../components/RouteChip.tsx';
import { SkeletonResults } from '../components/SkeletonResults.tsx';
import { TransferPointGroup } from '../components/TransferPointGroup.tsx';
import { type SearchUpdate, TransferWindowSheet, TripSettingsSheet } from '../components/TripSettingsSheet.tsx';
import { useNow, usePoll } from '../hooks.ts';
import { viewAlerts } from '../lib/alerts.ts';
import { type CardContext, chooseDirection, directionChoices, groupColors, scaleFor } from '../lib/results.ts';
import { summarize } from '../lib/summary.ts';
import { navigate, tripPath } from '../router.ts';
import { matchesServerDefaults, tripApiUrl, useSettings } from '../settings.tsx';
import { type Search, findSaved, rememberRecent, removeSaved, saveSearch, updateSaved } from '../storage.ts';
import { agencyOnly, chipLabel, shortStopName } from '../view.ts';

const initialData = takeInitialData<TripResponse>();

export function ResultsScreen({ search }: { search: Search }) {
  const { settings } = useSettings();
  const now = useNow();
  const [showHidden, setShowHidden] = useState(false);
  const [sheet, setSheet] = useState<'none' | 'window' | 'settings'>('none');
  const [saved, setSaved] = useState(() => findSaved(search));
  // Cards the rider opened or closed, by departure. Others follow the default: each group's
  // soonest departure open, the rest closed. Kept across refreshes, which reuse trip ids.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const isExpanded = (trip: string, first: boolean) => toggled[trip] ?? first;
  const toggleCard = (trip: string, first: boolean) => setToggled((current) => ({ ...current, [trip]: !(current[trip] ?? first) }));
  const url = tripApiUrl(search, settings, showHidden);
  // Results the server put in the page answer this request only if nothing differs from its defaults.
  const initial = useMemo(() => {
    const matches = initialData && initialData.from === search.from && matchesServerDefaults(settings) && !search.firstRoutes && !search.secondRoutes;
    return matches ? initialData : null;
  }, []);
  const { data, error, fetchedAt, feed } = usePoll<TripResponse>(url, 30_000, initial);
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
      setSaved(saveSearch(search, `${summary.from} to ${summary.to}`));
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
    showHidden,
  };
  const secondsSinceUpdate = fetchedAt === null ? null : Math.max(0, Math.floor((now - fetchedAt) / 1000));
  const window = { min: search.min ?? groups[0]?.window.min ?? 3, max: search.max ?? groups[0]?.window.max ?? 12 };
  const footer = saved ? `Saved with “${saved.name}”` : 'Applies to this search. Save it to keep these settings.';
  const outages = (data?.feeds ?? []).filter(({ state }) => state === 'down' || state === 'stale');
  const liveAgencies = (data?.feeds ?? []).filter(({ state }) => state === 'live').map(({ agency }) => agencyOnly(agency));
  const routesOf = (agency: string) =>
    [...new Set(groups.flatMap(({ routes }) => routes).filter((key) => key.startsWith(`${agency}:`)).map((key) => (data?.routes[key] ? chipLabel(data.routes[key]!) : key)))].join(', ');
  // The header chip takes the same color its group gives it, which may have stepped away from a clash.
  const toColor = summary.toRoute && groups[0] ? groupColors(groups[0], data!)(summary.toRoute.key) : undefined;
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
          status={
            <>
              <span aria-hidden="true">·</span>
              <span>Transfer {summary.windowText}</span>
            </>
          }
          action={<SaveButton saved={saved !== null} onToggle={toggleSaved} />}
          onBack={() => navigate('/')}
        />
        <main class="tf-page" id="main">
          {feed === 'offline' && <OfflineBanner statusText={liveStatusText(feed, secondsSinceUpdate)} />}
          {outages.map(({ agency }) => (
            <FeedOutageBanner key={agency} agency={agencyOnly(agency)} routes={routesOf(agency)} liveAgencies={liveAgencies.join(' and ')} />
          ))}
          {error && (
            <div class="tf-empty" role="alert">
              <div class="tf-empty__title">{error}</div>
            </div>
          )}
          {data && <AlertList key={data.from} alerts={viewAlerts(data, summary.boarding)} />}
          {data &&
            directionChoices(data.groups, search.off ?? []).map((choice) => (
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
            <div class="tf-empty">
              <div class="tf-empty__title">No transfer between these stops</div>
              <div class="tf-muted">They may be too far apart to walk between, or no route links them. A longer walk in Settings may help.</div>
            </div>
          ) : (
            data && (
              <div class="tf-groups">
                {groups.map((group, index) => (
                  <TransferPointGroup
                    key={`${group.alight}>${group.board}>${group.direction}`}
                    group={group}
                    kicker={'route' in data.to && groups.length > 1 ? `Transfer point ${index + 1} of ${groups.length}` : null}
                    context={context}
                    isExpanded={isExpanded}
                    onToggle={toggleCard}
                    onWiden={(widened) => update((current) => ({ ...current, ...widened }))}
                    onShowHidden={() => setShowHidden(true)}
                  />
                ))}
              </div>
            )
          )}
          <DataCredit />
        </main>
      </div>
      <BottomBar windowText={summary.windowText} onWindow={() => setSheet('window')} onSettings={() => setSheet('settings')} />
      {sheet === 'window' && (
        <TransferWindowSheet
          search={search}
          window={window}
          footer={footer}
          showHidden={showHidden}
          update={update}
          onShowHidden={setShowHidden}
          onClose={() => setSheet('none')}
          onMore={() => setSheet('settings')}
        />
      )}
      {sheet === 'settings' && (
        <TripSettingsSheet
          search={search}
          data={data}
          window={window}
          footer={footer}
          chain={summary.chain}
          destinationsUrl={destinationsUrl}
          update={update}
          onClose={() => setSheet('none')}
        />
      )}
    </>
  );
}
