import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { SearchResponse, TripResponse } from '../../../shared/api.ts';
import { getJson } from '../api.ts';
import { Collapse } from '../components/Collapse.tsx';
import { DataCredit } from '../components/DataCredit.tsx';
import { RecentList } from '../components/RecentList.tsx';
import { PinnedCard } from '../components/PinnedCard.tsx';
import { SavedSearchCard } from '../components/SavedSearchCard.tsx';
import { SearchFields } from '../components/SearchFields.tsx';
import { type SearchHit, StopResults, hitMeta, hitName } from '../components/StopResults.tsx';
import { Toast, type ToastMessage } from '../components/Toast.tsx';
import { clock } from '../format.ts';
import { useNow, usePinnedTrip, usePoll } from '../hooks.ts';
import { IconChevron, IconGear, IconLocation, IconPin } from '../icons/ui.tsx';
import { defaultSavedColor } from '../lib/color.ts';
import { ageText, clockSkewMs, freshness } from '../lib/freshness.ts';
import { type LocationProblem, handOver, locate, locationProblemText } from '../lib/location.ts';
import { pageColors, scaleFor, timeScale } from '../lib/results.ts';
import { summarize } from '../lib/summary.ts';
import { navigate, tripPath } from '../router.ts';
import { tripApiUrl, useSettings } from '../settings.tsx';
import {
  type Pin,
  type SavedSearch,
  type Search,
  loadDismissed,
  loadFields,
  loadPin,
  loadPins,
  loadRecent,
  loadSaved,
  removeRecent,
  removeSaved,
  saveFields,
  savePin,
  saveSaved,
  searchId,
} from '../storage.ts';
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
  // Pinned trips lead Home, so the one being taken is in sight as soon as the app opens.
  const [pins, setPins] = useState(loadPins);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastId = useRef(0);
  const updatePin = (search: Search, next: Pin | null) => {
    savePin(search, next && { ...next, search });
    setPins(loadPins());
  };
  // Unpinned by the rider, rather than on its own, says so with Undo, as on results. A map's sheet
  // holds this from when it opened, so the pin it replaces is read as it is now.
  const pinFromHome = (search: Search, next: Pin | null) => {
    const previous = loadPin(search);
    updatePin(search, next);
    if (!next) setToast({ id: ++toastId.current, text: 'Unpinned', about: 'unpin', undo: () => updatePin(search, previous) });
  };
  // Bumped when a recent search is removed, so the list reads storage again.
  const [, setRecentVersion] = useState(0);
  // The browser asks for location permission on this tap, and Nearby opens once the phone has
  // answered, so the rider never lands on a screen still waiting for them.
  const [locating, setLocating] = useState<'idle' | 'asking' | LocationProblem>('idle');
  const here = useRef(true);
  useEffect(() => () => void (here.current = false), []);
  const findNearby = () => {
    setLocating('asking');
    locate().then(
      (position) => {
        // The rider may have opened something else while the phone looked.
        if (!here.current) return;
        handOver(position);
        navigate('/nearby');
      },
      (problem: LocationProblem) => setLocating(problem),
    );
  };

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
      <Toast message={toast} page onDone={() => setToast(null)} />
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
        {pins.map((pin) => (
          <PinnedHome key={searchId(pin.search)} pin={pin} now={now} onPin={(next) => pinFromHome(pin.search, next)} onUpdate={(next) => updatePin(pin.search, next)} />
        ))}
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
            <button type="button" class="tf-btn-outline tf-btn-secondary tf-nearby-button" onClick={findNearby} disabled={locating === 'asking'}>
              <IconLocation />
              {locating === 'asking' ? 'Finding you…' : 'Show nearby routes'}
            </button>
            {(locating === 'denied' || locating === 'unavailable') && (
              <div class="tf-near__problem" role="alert">
                {locationProblemText(locating)}
              </div>
            )}
            {saved.length > 0 && (
              <section class="tf-section" aria-labelledby="saved-heading">
                <h2 id="saved-heading">Saved</h2>
                <div class="tf-saved-grid">
                  {saved.map((search) => (
                    <SavedTrip
                      key={search.id}
                      search={search}
                      now={now}
                      onEdit={(change) =>
                        updateSaved(loadSaved().map((item) => (item.id === search.id ? { ...item, ...change, renamed: change.name !== item.name ? true : item.renamed } : item)))
                      }
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
            <HowItWorks open={saved.length === 0 && recent.length === 0} />
            <DataCredit />
          </>
        )}
      </main>
    </div>
  );
}

// What Transfers is for. Open on a first visit, and folded once the rider has searches of
// their own. A button and Collapse rather than <details>, whose opening Safari cannot animate.
function HowItWorks({ open: openAtFirst }: { open: boolean }) {
  const [open, setOpen] = useState(openAtFirst);
  return (
    <div class="tf-about" data-open={String(open)}>
      <button type="button" class="tf-about__toggle" aria-expanded={open} aria-controls="how-it-works" onClick={() => setOpen(!open)}>
        How Transfers works
        <IconChevron size={18} />
      </button>
      <Collapse open={open} id="how-it-works">
        <p>
          Pick where you start and the stop or route you are transferring to. Transfers shows the next few departures you can catch, and under each one every vehicle from
          your stop that makes it within your transfer window, with live times from 511 and how long each transfer is.
        </p>
        <p>
          It helps most going from frequent service to infrequent, such as BART to a bus that comes every 20 minutes, where the train you catch decides whether you make
          the bus.
        </p>
        <p>You set the transfer window, the shortest and longest transfer you will accept, so it shows tight connections a trip planner would leave out.</p>
        <p>Tap a connection to pin it to the top of its results, where it stays and updates live until you unpin it.</p>
      </Collapse>
    </div>
  );
}

// A pinned trip, as at the top of its results, polling its own trip like a saved card does.
function PinnedHome({ pin, now, onPin, onUpdate }: { pin: Pin & { search: Search }; now: number; onPin: (pin: Pin | null) => void; onUpdate: (pin: Pin | null) => void }) {
  const { settings } = useSettings();
  const { search } = pin;
  const { data, fetchedAt, feed, settled } = usePoll<TripResponse>(tripApiUrl(search, settings, false, pin), 30_000, null, tripApiUrl(search, settings, false));
  const skew = clockSkewMs(data?.generatedAt, fetchedAt);
  const serverNow = now + skew;
  const { pinned, unpinAt, expired } = usePinnedTrip(pin, data, search.dest, settings, serverNow, onUpdate);
  // Times no longer live say so, as saved cards do, since Home has no banner to.
  const fresh = freshness(serverNow, fetchedAt === null ? null : fetchedAt + skew, data?.dataAt ?? null);
  const age = fresh.ageSeconds === null ? null : ageText(fresh.ageSeconds);
  const status = feed === 'offline' ? `Offline${age ? ` · times ${age} old` : ''}` : fresh.stale && settled && age ? `Live times ${age} old` : null;
  const trip = { label: `${search.fromLabel} to ${search.toLabel}`, href: tripPath(search) };
  if (expired) return null;
  if (!data) {
    return (
      <section class="tf-pinned" aria-label="Pinned trip">
        <div class="tf-pinned__head">
          <span class="tf-kicker tf-pinned__kicker">
            <IconPin filled size={13} />
            Pinned
          </span>
          <a class="tf-pinned__trip" href={trip.href} onClick={(event) => (event.preventDefault(), navigate(trip.href))}>
            {trip.label}
          </a>
        </div>
        <p class="tf-pinned__note">Getting live predictions…</p>
      </section>
    );
  }
  const { groups } = summarize(search, data, serverNow);
  return (
    <PinnedCard
      pin={pin}
      pinned={pinned}
      data={data}
      destination={search.dest}
      colorOf={pageColors(groups, data)}
      pct={timeScale(serverNow, scaleFor(groups, serverNow))}
      now={serverNow}
      unpinAt={unpinAt}
      onPin={onPin}
      trip={trip}
      stale={status}
    />
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
  const { data, feed, fetchedAt, settled } = usePoll<TripResponse>(tripApiUrl(search, settings, false), 30_000);
  const skew = clockSkewMs(data?.generatedAt, fetchedAt);
  // Read once per visit to Home: dismissing happens on results.
  const dismissed = useMemo(() => new Set(loadDismissed().map(({ id }) => id)), []);
  const summary = summarize(search, data, now + skew, dismissed);
  const fresh = freshness(now + skew, fetchedAt === null ? null : fetchedAt + skew, data?.dataAt ?? null);
  useEffect(() => {
    if (!search.color && data) onColorless(summary.lineColor);
  }, [Boolean(data), search.color]);
  return (
    <SavedSearchCard
      name={search.name}
      color={search.color}
      chain={summary.chain}
      // A name the rider chose says nothing of the trip, and the default leaves out where to get
      // off. Searches saved before renames were kept compare against the default name.
      named={(search.renamed ?? search.name !== `${summary.from} to ${summary.to}`) || summary.via !== null}
      windowText={summary.windowText}
      next={summary.next}
      loading={!data && feed === 'loading'}
      severeAlerts={summary.severeAlerts}
      staleText={fresh.stale && settled ? `Live times ${ageText(fresh.ageSeconds!)} old` : null}
      href={tripPath(search)}
      onOpen={() => navigate(tripPath(search))}
      onEdit={onEdit}
      onRemove={onRemove}
    />
  );
}
