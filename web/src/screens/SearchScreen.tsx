import { useEffect, useState } from 'preact/hooks';
import type { SearchResponse, TripResponse } from '../../../shared/api.ts';
import { getJson } from '../api.ts';
import { DataCredit } from '../components/DataCredit.tsx';
import { RecentList } from '../components/RecentList.tsx';
import { SavedSearchCard } from '../components/SavedSearchCard.tsx';
import { SearchFields } from '../components/SearchFields.tsx';
import { type SearchHit, StopResults, hitMeta, hitName } from '../components/StopResults.tsx';
import { clock } from '../format.ts';
import { useNow, usePoll } from '../hooks.ts';
import { IconGear, IconLocation } from '../icons/ui.tsx';
import { defaultSavedColor } from '../lib/color.ts';
import { ageText, freshness } from '../lib/freshness.ts';
import { summarize } from '../lib/summary.ts';
import { navigate, tripPath } from '../router.ts';
import { tripApiUrl, useSettings } from '../settings.tsx';
import { type SavedSearch, loadFields, loadRecent, loadSaved, removeRecent, removeSaved, saveFields, saveSaved, searchId } from '../storage.ts';
import { chipLabel, dayLabel, shortStopName } from '../view.ts';

// A picked stop or route. `short` is what headers and lists call it.
export type Picked = { key: string; label: string; meta: string; short: string };
type FieldState = { query: string; picked?: Picked };

function pickedFrom(hit: SearchHit, response: SearchResponse): Picked {
  if (hit.type === 'route') {
    const route = response.routes[hit.route];
    return { key: `route:${hit.route}`, label: hitName(hit, response), meta: hitMeta(hit, response), short: route ? chipLabel(route) : hit.route };
  }
  return { key: hit.key, label: hit.name, meta: hitMeta(hit, response), short: shortStopName(hit) + (hit.code ? ` (${hit.code})` : '') };
}

export function SearchScreen() {
  const now = useNow();
  // Nearby hands a picked stop over through history state. Otherwise the fields come back as the
  // rider left them, such as on returning from results.
  const [initial] = useState(() => {
    const kept = loadFields<{ from: FieldState; to: FieldState }>() ?? { from: { query: '' }, to: { query: '' } };
    const prefill = (history.state ?? {}) as { from?: Picked; to?: Picked };
    return {
      from: prefill.from ? { query: prefill.from.label, picked: prefill.from } : kept.from,
      to: prefill.to ? { query: prefill.to.label, picked: prefill.to } : kept.to,
    };
  });
  const [from, setFrom] = useState<FieldState>(initial.from);
  const [to, setTo] = useState<FieldState>(initial.to);
  useEffect(() => saveFields({ from, to }), [from, to]);
  const [focus, setFocus] = useState<'from' | 'to' | null>(null);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [saved, setSaved] = useState(loadSaved);
  // Bumped when a recent search is removed, so the list reads storage again.
  const [, setRecentVersion] = useState(0);

  const active = focus === 'from' ? from : focus === 'to' ? to : null;
  const query = active && !active.picked ? active.query.trim() : '';
  useEffect(() => {
    if (!query) {
      setResponse(null);
      return;
    }
    const controller = new AbortController();
    // Waits for a pause in typing, so each keystroke does not cost a request.
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query, kind: focus === 'to' ? 'any' : 'stop' });
      getJson<SearchResponse>(`/api/search?${params}`, { signal: controller.signal }).then(setResponse, () => {});
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, focus]);

  const pick = (hit: SearchHit) => {
    if (!response) return;
    const picked = pickedFrom(hit, response);
    (focus === 'from' ? setFrom : setTo)({ query: picked.label, picked });
    setFocus(null);
    setResponse(null);
  };
  const go = () => {
    if (!from.picked || !to.picked) return;
    navigate(tripPath({ from: from.picked.key, to: to.picked.key, fromLabel: from.picked.short, toLabel: to.picked.short }));
  };
  const updateSaved = (next: SavedSearch[]) => {
    saveSaved(next);
    setSaved(next);
  };
  const recent = loadRecent()
    .filter((search) => !saved.some((item) => item.id === searchId(search)))
    .map((search) => ({
      id: searchId(search),
      label: `${search.fromLabel} → ${search.toLabel}`,
      sub: [search.via && `via ${search.via}`, dayLabel(search.at, now)].filter(Boolean).join(' · '),
      href: tripPath(search),
    }));
  const showingResults = Boolean(query && response);

  return (
    <div class="tf-scroll">
      <main class="tf-page tf-page--form" id="main">
        <div class="tf-search-head">
          <h1>Transfers</h1>
          <span class="tf-search-head__end">
            <span class="tf-muted">{clock(now / 1000)}</span>
            <a class="tf-btn-icon tf-muted" href="/settings" aria-label="Settings" onClick={(event) => (event.preventDefault(), navigate('/settings'))}>
              <IconGear />
            </a>
          </span>
        </div>
        <SearchFields
          from={{ query: from.query, ...(from.picked ? { meta: from.picked.meta } : {}) }}
          to={{ query: to.query, ...(to.picked ? { meta: to.picked.meta } : {}) }}
          onFrom={(value) => setFrom({ query: value })}
          onTo={(value) => setTo({ query: value })}
          onFocus={setFocus}
          canSwap={!to.picked?.key.startsWith('route:')}
          onSwap={() => {
            setFrom(to);
            setTo(from);
          }}
        />
        {(from.query || to.query) && (
          <button type="button" class="tf-btn-primary" disabled={!(from.picked && to.picked)} onClick={go}>
            Find transfers
          </button>
        )}
        {showingResults ? (
          <StopResults query={query} response={response!} onPick={pick} includesRoutes={focus === 'to'} />
        ) : (
          <>
            <a class="tf-btn-outline tf-btn-secondary tf-nearby-button" href="/nearby" onClick={(event) => (event.preventDefault(), navigate('/nearby'))}>
              <IconLocation />
              Show nearby routes
            </a>
            {saved.length > 0 && (
              <section class="tf-section" aria-labelledby="saved-heading">
                <h2 id="saved-heading">Saved</h2>
                <div class="tf-saved-grid">
                  {saved.map((search) => (
                    <SavedTrip
                      key={search.id}
                      search={search}
                      now={now}
                      onEdit={(change) => updateSaved(loadSaved().map((item) => (item.id === search.id ? { ...item, ...change } : item)))}
                      onColorless={(lineColor) => {
                        // Saved before colors existed: take one now, avoiding the rest.
                        const all = loadSaved();
                        const taken = all.filter(({ id, color }) => id !== search.id && color).map(({ color }) => color!);
                        updateSaved(all.map((item) => (item.id === search.id && !item.color ? { ...item, color: defaultSavedColor(lineColor, taken) } : item)));
                      }}
                      onRemove={() => {
                        removeSaved(search.id);
                        setSaved(loadSaved());
                      }}
                    />
                  ))}
                </div>
              </section>
            )}
            <RecentList
              items={recent}
              onOpen={(item) => navigate(item.href)}
              onRemove={(item) => {
                removeRecent(item.id);
                setRecentVersion((version) => version + 1);
              }}
            />
            <DataCredit />
          </>
        )}
      </main>
    </div>
  );
}

// Polls its own trip, so the card counts down live and opening it shows cached results at once.
function SavedTrip({ search, now, onEdit, onColorless, onRemove }: {
  search: SavedSearch;
  now: number;
  onEdit: (change: { name: string; color: string | undefined }) => void;
  onColorless: (lineColor: string | null) => void;
  onRemove: () => void;
}) {
  const { settings } = useSettings();
  const { data, feed, fetchedAt } = usePoll<TripResponse>(tripApiUrl(search, settings, false), 30_000);
  const summary = summarize(search, data, now);
  const fresh = freshness(now, fetchedAt, data?.dataAt ?? null);
  useEffect(() => {
    if (!search.color && data) onColorless(summary.lineColor);
  }, [Boolean(data), search.color]);
  return (
    <SavedSearchCard
      name={search.name}
      color={search.color}
      chain={summary.chain}
      windowText={summary.windowText}
      next={summary.next}
      loading={!data && feed === 'loading'}
      severeAlerts={summary.severeAlerts}
      staleText={fresh.stale ? `Live times ${ageText(fresh.ageSeconds!)} old` : null}
      href={tripPath(search)}
      onOpen={() => navigate(tripPath(search))}
      onEdit={onEdit}
      onRemove={onRemove}
    />
  );
}
