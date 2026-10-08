import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { SearchResponse, TripResponse } from '../../../shared/api.ts';
import { getJson } from '../api.ts';
import { Collapse } from '../components/Collapse.tsx';
import { DataCredit } from '../components/DataCredit.tsx';
import { RecentList } from '../components/RecentList.tsx';
import { OpenTrip, PinnedCard } from '../components/PinnedCard.tsx';
import { SavedSearchCard } from '../components/SavedSearchCard.tsx';
import { SearchFields } from '../components/SearchFields.tsx';
import { type SearchHit, StopResults, hitMeta, hitName } from '../components/StopResults.tsx';
import { Toast, type ToastMessage } from '../components/Toast.tsx';
import { ScreenHeader } from '../components/ResultsHeader.tsx';
import { clock } from '../format.ts';
import { useNow, usePinnedTrip, usePoll } from '../hooks.ts';
import { IconChevron, IconClose, IconGear, IconLocation, IconPin } from '../icons/ui.tsx';
import { defaultSavedColor } from '../lib/color.ts';
import { ringsBell } from '../lib/eggs.ts';
import { samePin } from '../lib/pinned.ts';
import { type LiveReport, ageText, clockSkewMs, freshness, homeStatus } from '../lib/freshness.ts';
import { type LocationProblem, type Position, handOver, locate, locationProblemText } from '../lib/location.ts';
import { pageColors, scaleFor, timeScale } from '../lib/results.ts';
import { summarize } from '../lib/summary.ts';
import { tapForGerbils } from '../gerbils.ts';
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
  loadPicked,
  loadRecent,
  loadSaved,
  removeRecent,
  rememberPicked,
  removeSaved,
  saveFields,
  savePin,
  saveRecent,
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
  // Each pull to refresh, which every live card answers by refreshing (J, 2026-10-08).
  const [pulls, setPulls] = useState(0);
  // Whether a field has the cursor, as `focus` stays on the last field used.
  const [typing, setTyping] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  // Which field and text the response answers, as "from|24th".
  const answeredFor = useRef('');
  const [saved, setSaved] = useState(loadSaved);
  // Pinned trips lead Home, so the one being taken is in sight as soon as the app opens.
  const [pins, setPins] = useState(loadPins);
  // How fresh each live card's times are, by card, for the status line under the title.
  const [reports, setReports] = useState<Record<string, LiveReport>>({});
  const report = useCallback((key: string, next: LiveReport | null) => {
    setReports(({ [key]: _old, ...others }) => (next ? { ...others, [key]: next } : others));
  }, []);
  const liveStatus = homeStatus(Object.values(reports), now);
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
  // Pinned from a saved card, which shows its trip pinned at the top. A pin it replaces can come back.
  const pinFromCard = (search: Search, next: Pin | null, bell: boolean) => {
    if (!next) return pinFromHome(search, null);
    const previous = loadPin(search);
    updatePin(search, next);
    setToast({ id: ++toastId.current, text: bell ? 'Ding ding! Pinned to the top' : 'Pinned to the top', about: 'pin', undo: () => updatePin(search, previous) });
  };
  // Saved searches in the order the rider set, one place at a time.
  const moveSaved = (id: string, step: -1 | 1) => {
    const all = loadSaved();
    const from = all.findIndex((item) => item.id === id);
    const to = from + step;
    if (from === -1 || to < 0 || to >= all.length) return;
    [all[from], all[to]] = [all[to]!, all[from]!];
    updateSaved(all);
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
  // With location already allowed, search puts the nearer of same-named stops first, such as a
  // street's two sides (J, 2026-10-08). Home never asks for permission for this.
  const [near, setNear] = useState<Position | null>(null);
  useEffect(() => {
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((status) => status.state === 'granted' && locate(5 * 60_000).then((position) => here.current && setNear(position)))
      .catch(() => {});
  }, []);
  // A search the server could not answer says so, rather than looking like no match. Retry asks
  // again (J, 2026-10-08).
  const [searchFailed, setSearchFailed] = useState(false);
  const [retries, setRetries] = useState(0);
  useEffect(() => {
    setSearchFailed(false);
    if (!query) {
      setResponse(null);
      return;
    }
    const controller = new AbortController();
    // Waits for a pause in typing, so each keystroke does not cost a request.
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query, kind: focus === 'to' ? 'any' : 'stop', ...(near ? { lat: near.lat.toFixed(4), lon: near.lon.toFixed(4) } : {}) });
      getJson<SearchResponse>(`/api/search?${params}`, { signal: controller.signal }).then(
        (answer) => {
          answeredFor.current = `${focus}|${query}`;
          setResponse(answer);
        },
        (error: Error) => {
          if (error.name !== 'AbortError') setSearchFailed(true);
        },
      );
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, focus, retries, near]);

  const pick = (hit: SearchHit) => {
    if (!response) return;
    const picked = pickedFrom(hit, response);
    rememberPicked(picked);
    const field = focus;
    (field === 'from' ? setFrom : setTo)({ query: picked.label, picked });
    setFocus(null);
    setResponse(null);
    // On to the other field, or the results, as Enter and a recent stop do.
    if (field) advance(field, picked);
  };
  const open = (fromPicked: Picked, toPicked: Picked) => navigate(tripPath({ from: fromPicked.key, to: toPicked.key, fromLabel: fromPicked.short, toLabel: toPicked.short }));
  const go = () => {
    if (from.picked && to.picked) open(from.picked, to.picked);
  };

  // Enter takes the first match for what was typed, once its answer is in, then moves on: to the
  // other field, or to the results once both are picked (J, 2026-10-08). The stops along a route
  // named in From are a choice of side and direction, which Enter does not guess.
  const pendingEnter = useRef<'from' | 'to' | null>(null);
  const advance = (field: 'from' | 'to', picked: Picked) => {
    const fromPicked = field === 'from' ? picked : from.picked;
    const toPicked = field === 'to' ? picked : to.picked;
    if (!fromPicked || !toPicked) return document.getElementById(field === 'from' ? 'field-to' : 'field-from')?.focus();
    // Saved now, as Home closes before its own saving would run, and the rider comes back to them.
    saveFields({ from: { query: fromPicked.label, picked: fromPicked }, to: { query: toPicked.label, picked: toPicked } });
    open(fromPicked, toPicked);
  };
  const takeFirst = (field: 'from' | 'to') => {
    const hit = response?.along?.length ? undefined : response?.results[0];
    if (!response || !hit) return;
    const picked = pickedFrom(hit, response);
    rememberPicked(picked);
    (field === 'from' ? setFrom : setTo)({ query: picked.label, picked });
    setFocus(null);
    setResponse(null);
    advance(field, picked);
  };
  const choose = (field: 'from' | 'to', picked: Picked) => {
    (field === 'from' ? setFrom : setTo)({ query: picked.label, picked });
    setFocus(null);
    advance(field, picked);
  };
  const enter = (field: 'from' | 'to') => {
    const value = field === 'from' ? from : to;
    if (value.picked) return advance(field, value.picked);
    const typed = value.query.trim();
    if (!typed) {
      const first = usual(field)[0];
      if (first) choose(field, first);
      return;
    }
    if (response && answeredFor.current === `${field}|${typed}`) takeFirst(field);
    else pendingEnter.current = field;
  };
  useEffect(() => {
    const field = pendingEnter.current;
    if (!field || !response || answeredFor.current !== `${field}|${(field === 'from' ? from : to).query.trim()}`) return;
    pendingEnter.current = null;
    takeFirst(field);
  }, [response]);
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
  // An empty field the rider is in offers the stops and routes of their recent and saved
  // searches, newest first, so the usual stop is one tap (J, 2026-10-08).
  const usual = (field: 'from' | 'to'): Picked[] => {
    const seen = new Set<string>();
    const known = loadPicked();
    return [...loadRecent(), ...saved].flatMap((search) => {
      const key = field === 'from' ? search.from : search.to;
      const label = field === 'from' ? search.fromLabel : search.toLabel;
      if (seen.has(key)) return [];
      seen.add(key);
      return [known[key] ?? { key, label, meta: key.startsWith('route:') ? 'Route from a recent search' : 'Stop from a recent search', short: label }];
    }).slice(0, 5);
  };
  const usualShown = typing && focus && !(focus === 'from' ? from : to).query.trim() ? usual(focus) : [];
  const showingResults = Boolean(query && response) || usualShown.length > 0;

  return (
    <div class="tf-scroll">
      <Toast message={toast} page onDone={() => setToast(null)} />
      {/* The header the other screens have, so going to results moves neither the title nor the
          status line. The status line shows only with live cards, as Home asks for nothing else. */}
      <ScreenHeader
        title={
          <span
            onClick={() => {
              const on = tapForGerbils();
              if (on !== null) setToast({ id: ++toastId.current, text: on ? 'Gerbil mode on' : 'Gerbil mode off', about: 'notice' });
            }}
          >
            Transfers
          </span>
        }
        end={
          <span class="tf-header__end">
            <span class="tf-muted">{clock(now / 1000)}</span>
            <a class="tf-btn-icon tf-muted" href="/settings" aria-label="Settings" onClick={(event) => (event.preventDefault(), navigate('/settings'))}>
              <IconGear />
            </a>
          </span>
        }
        {...(liveStatus ? { feed: liveStatus.feed, secondsSinceUpdate: liveStatus.secondsSinceUpdate, stale: liveStatus.stale, onRefresh: () => setPulls((count) => count + 1) } : {})}
      />
      <main class="tf-page tf-page--form" id="main">
        {pins.map((pin) => (
          <PinnedHome key={searchId(pin.search)} pin={pin} name={saved.find(({ id }) => id === searchId(pin.search))?.name} now={now} pulls={pulls} onPin={(next) => pinFromHome(pin.search, next)} onUpdate={(next) => updatePin(pin.search, next)} onReport={report} />
        ))}
        <SearchFields
          from={{ query: from.query, ...(from.picked ? { meta: from.picked.meta } : {}) }}
          to={{ query: to.query, ...(to.picked ? { meta: to.picked.meta } : {}) }}
          onFrom={(value) => {
            pendingEnter.current = null;
            setFrom({ query: value });
          }}
          onTo={(value) => {
            pendingEnter.current = null;
            setTo({ query: value });
          }}
          onEnter={enter}
          onFocus={(field) => {
            setFocus(field);
            setTyping(true);
          }}
          // Later, so a tap on a recent stop lands before the list goes.
          onBlur={() => setTimeout(() => setTyping(Boolean(document.activeElement?.closest('.tf-fields'))), 200)}
          canSwap={!to.picked?.key.startsWith('route:')}
          onSwap={() => {
            setFrom(to);
            setTo(from);
          }}
        />
        {/* Not over the suggestions, which a phone's keyboard leaves little room for. */}
        {(from.query || to.query) && !showingResults && (
          <button type="button" class="tf-btn-primary" disabled={!(from.picked && to.picked)} onClick={go} aria-describedby="find-hint">
            Find transfers
          </button>
        )}
        {/* What the dimmed button is waiting for, as typing alone does not pick a stop. */}
        {(from.query || to.query) && !showingResults && !(from.picked && to.picked) && (
          <p class="tf-find-hint" id="find-hint">
            {!from.picked && !to.picked ? 'Pick From and To from the lists' : !from.picked ? 'Pick a From stop from the list' : 'Pick a To stop or route from the list'}
          </p>
        )}
        {searchFailed && query && (
          <div class="tf-results tf-search-failed" role="alert">
            <span>Can’t reach search. Check your connection.</span>
            <button type="button" class="tf-btn-outline tf-btn-secondary" onClick={() => setRetries((count) => count + 1)}>
              Retry
            </button>
          </div>
        )}
        {usualShown.length > 0 && focus && <UsualStops picks={usualShown} onPick={(picked) => choose(focus, picked)} />}
        {/^gerbils?$/i.test(query) && (
          <div class="tf-results" role="status">
            <div class="tf-result">
              <span class="tf-result__name">Nearest gerbil</span>
              <span class="tf-result__dir">Under your seat. Mind the tail.</span>
            </div>
          </div>
        )}
        {query && response && <StopResults query={query} response={response} onPick={pick} includesRoutes={focus === 'to'} />}
        {/* Hidden rather than unmounted under the suggestions, so the saved cards keep their times
            and the status line above the fields stays put while the rider types. */}
        <div class="tf-home-rest" hidden={showingResults}>
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
                {saved.map((search, index) => (
                  <SavedTrip
                    key={search.id}
                    search={search}
                    now={now}
                    pulls={pulls}
                    onMove={(step) => moveSaved(search.id, step)}
                    canMoveUp={index > 0}
                    canMoveDown={index < saved.length - 1}
                    pin={pins.find((pin) => searchId(pin.search) === search.id) ?? null}
                    onPin={(pin, bell) => pinFromCard(search, pin, bell)}
                    onReport={report}
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
                      // One tap removes a search and its name, color and settings, so it can be
                      // undone (J, 2026-10-08).
                      const before = loadSaved();
                      removeSaved(search.id);
                      setSaved(loadSaved());
                      setToast({ id: ++toastId.current, text: 'Removed from Saved', about: 'unsaved', undo: () => updateSaved(before) });
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
              const before = loadRecent();
              removeRecent(item.id);
              setRecentVersion((version) => version + 1);
              setToast({
                id: ++toastId.current,
                text: 'Removed from Recent',
                about: 'notice',
                undo: () => {
                  saveRecent(before);
                  setRecentVersion((version) => version + 1);
                },
              });
            }}
          />
          <HowItWorks open={saved.length === 0 && recent.length === 0} />
          <DataCredit />
        </div>
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
function PinnedHome({ pin, name, now, pulls, onPin, onUpdate, onReport }: {
  pin: Pin & { search: Search };
  // The saved search's name, when the trip is saved.
  name: string | undefined;
  now: number;
  pulls: number;
  onPin: (pin: Pin | null) => void;
  onUpdate: (pin: Pin | null) => void;
  onReport: Report;
}) {
  const { settings } = useSettings();
  const { search } = pin;
  const { data, fetchedAt, feed, settled, answered, refresh } = usePoll<TripResponse>(tripApiUrl(search, settings, false, pin), 30_000, null, tripApiUrl(search, settings, false));
  useEffect(() => void (pulls && refresh()), [pulls]);
  const skew = clockSkewMs(data?.generatedAt, fetchedAt);
  useLiveReport(onReport, `pin:${searchId(search)}`, { feed, fetchedAt, dataAt: data?.dataAt ?? null, skew, settled });
  const serverNow = now + skew;
  const { pinned, unpinAt, expired } = usePinnedTrip(pin, data, answered, search.dest, settings, serverNow, onUpdate);
  // Times no longer live say so, as saved cards do, since Home has no banner to.
  const fresh = freshness(serverNow, fetchedAt === null ? null : fetchedAt + skew, data?.dataAt ?? null);
  const age = fresh.ageSeconds === null ? null : ageText(fresh.ageSeconds);
  const status = feed === 'offline' ? `Offline${age ? ` · times ${age} old` : ''}` : fresh.stale && settled && age ? `Live times ${age} old` : null;
  // A saved trip goes by the name the rider gave it, as its saved card does.
  const trip = { label: name ?? `${search.fromLabel} to ${search.toLabel}`, href: tripPath(search) };
  if (expired) return null;
  if (!data) {
    return (
      <section class="tf-pinned tf-pinned--opens" aria-label="Pinned trip">
        <OpenTrip trip={trip} />
        <div class="tf-pinned__head">
          <span class="tf-kicker tf-pinned__kicker">
            <IconPin filled size={13} />
            Pinned
          </span>
          <span class="tf-pinned__trip">{trip.label}</span>
          <button type="button" class="tf-pinned__unpin" onClick={() => onPin(null)}>
            <IconClose size={16} />
            Unpin
          </button>
        </div>
        <p class="tf-pinned__note">{feed === 'offline' ? 'Times can’t load right now. They show again once the phone is back online.' : 'Getting live predictions…'}</p>
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
function SavedTrip({ search, now, pulls, onMove, canMoveUp, canMoveDown, pin, onPin, onReport, onEdit, onColorless, onRemove }: {
  search: SavedSearch;
  now: number;
  pulls: number;
  onMove: (step: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  // The trip pinned for this search, if any.
  pin: Pin | null;
  onPin: (pin: Pin | null, bell: boolean) => void;
  onReport: Report;
  onEdit: (change: { name: string; color: string | undefined }) => void;
  onColorless: (lineColor: string | null) => void;
  onRemove: () => void;
}) {
  const { settings } = useSettings();
  const slot = useRef<HTMLDivElement>(null);
  const { data, feed, fetchedAt, settled, refresh } = usePoll<TripResponse>(tripApiUrl(search, settings, false), useOnScreen(slot) ? 30_000 : OFF_SCREEN_POLL_MS);
  useEffect(() => void (pulls && refresh()), [pulls]);
  const skew = clockSkewMs(data?.generatedAt, fetchedAt);
  useLiveReport(onReport, `saved:${search.id}`, { feed, fetchedAt, dataAt: data?.dataAt ?? null, skew, settled });
  // Read once per visit to Home: dismissing happens on results.
  const dismissed = useMemo(() => new Set(loadDismissed().map(({ id }) => id)), []);
  const summary = summarize(search, data, now + skew, dismissed);
  const fresh = freshness(now + skew, fetchedAt === null ? null : fetchedAt + skew, data?.dataAt ?? null);
  useEffect(() => {
    if (!search.color && data) onColorless(summary.lineColor);
  }, [Boolean(data), search.color]);
  return (
    <div class="tf-saved-slot" ref={slot}>
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
        nextService={summary.nextService}
        onMove={onMove}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        pinned={pin !== null && summary.next !== null && samePin(pin, summary.next.pin)}
        onPin={(next) => onPin(next, next !== null && ringsBell(next, data))}
        staleText={fresh.stale && settled ? `Live times ${ageText(fresh.ageSeconds!)} old` : null}
        unavailable={!data && feed === 'offline'}
        href={tripPath(search)}
        onOpen={() => navigate(tripPath(search))}
        onEdit={onEdit}
        onRemove={onRemove}
      />
    </div>
  );
}

// A saved card scrolled out of sight, or under the suggestions, refreshes this seldom, as no one
// is reading it. Back in sight, a refresh comes at once if its times are older than usual.
const OFF_SCREEN_POLL_MS = 120_000;

function useOnScreen(element: { current: Element | null }) {
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    if (!element.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry!.isIntersecting));
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  return onScreen;
}

type Report = (key: string, report: LiveReport | null) => void;

// Tells Home how fresh a card's times are, and that it has gone once it unmounts. Before paint,
// so the status line shows in the same frame as the cards.
function useLiveReport(onReport: Report, key: string, { feed, fetchedAt, dataAt, skew, settled }: LiveReport) {
  useLayoutEffect(() => onReport(key, { feed, fetchedAt, dataAt, skew, settled }), [key, feed, fetchedAt, dataAt, skew, settled]);
  useLayoutEffect(() => () => onReport(key, null), [key]);
}

// The stops and routes of recent searches, for an empty field. The first is the one Enter takes.
function UsualStops({ picks, onPick }: { picks: Picked[]; onPick: (picked: Picked) => void }) {
  return (
    <div class="tf-results" role="region" aria-label="Recent stops and routes">
      <div class="tf-results__label">Recent</div>
      <div role="list">
        {picks.map((picked, index) => (
          <div role="listitem" key={picked.key}>
            <button type="button" class={`tf-result${index === 0 ? ' tf-result--enter' : ''}`} onClick={() => onPick(picked)}>
              <span class="tf-result__name">
                {picked.label}
                {index === 0 && <span class="tf-sr"> (Enter picks this)</span>}
              </span>
              <span class="tf-result__dir">{picked.meta}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
