import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Route, SearchResponse, StopResponse, TripResponse } from '../../../shared/api.ts';
import { apiUrl, getJson } from '../api.ts';
import { Collapse } from '../components/Collapse.tsx';
import { DataCredit } from '../components/DataCredit.tsx';
import { RecentList } from '../components/RecentList.tsx';
import { PinnedCard, PinnedFrame, waitingNote } from '../components/PinnedCard.tsx';
import { SavedSearchCard, SavedTripBody } from '../components/SavedSearchCard.tsx';
import { SearchFields } from '../components/SearchFields.tsx';
import { type SearchHit, StopResults, hitMeta, hitName } from '../components/StopResults.tsx';
import { Toast, useToast } from '../components/Toast.tsx';
import { ScreenHeader } from '../components/ResultsHeader.tsx';
import { clock, minutesUntil } from '../format.ts';
import { type Polled, useNow, usePinnedTrip, usePoll, useStopPin } from '../hooks.ts';
import { IconFold, IconGear, IconLocation } from '../icons/ui.tsx';
import { defaultSavedColor } from '../lib/color.ts';
import { ringsBell } from '../lib/eggs.ts';
import { pinToastText, samePin } from '../lib/pinned.ts';
import { homeStatus, liveClock, liveNote, type LiveReport } from '../lib/freshness.ts';
import { type LocationProblem, type Position, handOver, locate, locationProblemText } from '../lib/location.ts';
import { pageColors, scaleFor, timeScale } from '../lib/results.ts';
import { summarize } from '../lib/summary.ts';
import { tapForGerbils } from '../gerbils.ts';
import { unsave } from '../records.ts';
import { motionOff } from '../gestures.ts';
import { useScreenActive, useShownAgain } from '../layers.ts';
import { navigate, searchPath, stopPath } from '../router.ts';
import { StopPinCard } from '../components/StopPinCard.tsx';
import { RouteChip } from '../components/RouteChip.tsx';
import { useSettings } from '../settings.tsx';
import {
  type Pin,
  type SavedSearch,
  type Search,
  isStopSearch,
  loadDismissed,
  loadFields,
  loadPin,
  loadPins,
  loadPicked,
  loadRecent,
  loadSaved,
  removeRecent,
  rememberPicked,
  saveFields,
  savePin,
  saveRecent,
  saveSaved,
  searchId,
} from '../storage.ts';
import { chipLabel, dayLabel, stopLabel } from '../view.ts';
import { AppLink } from '../components/AppLink.tsx';
import { topUnderHeader } from '../lib/scroll.ts';
import { tripPath } from '../../../shared/paths.ts';
import { Flag } from '../components/StatusTag.tsx';
import { rowKey } from '../components/RouteCard.tsx';
import { endKind, HERE, HERE_LABEL } from '../lib/ends.ts';
import { placeEnd, type PlaceResult } from '../../../shared/journeys.ts';

// A picked stop, route, place, or the rider's location (see lib/ends.ts). `short` is what headers
// and lists call it.
export type Picked = { key: string; label: string; meta: string; short: string };
type FieldState = { query: string; picked?: Picked };

function pickedFrom(hit: SearchHit, response: SearchResponse): Picked {
  if (hit.type === 'route') {
    const route = response.routes[hit.route];
    return { key: `route:${hit.route}`, label: hitName(hit, response), meta: hitMeta(hit, response), short: route ? chipLabel(route) : hit.route };
  }
  return { key: hit.key, label: hit.name, meta: hitMeta(hit, response), short: stopLabel(hit) };
}

function pickedPlace(place: PlaceResult): Picked {
  return { key: placeEnd(place.id), label: place.name, meta: [place.kind, place.street].filter(Boolean).join(' · '), short: place.name };
}

// Where the phone says the rider is, looked up when the results open (see useJourneys).
const HERE_PICKED: Picked = { key: HERE, label: HERE_LABEL, meta: 'Where your phone says you are', short: HERE_LABEL };

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const dismissedIds = () => new Set(loadDismissed().map(({ id }) => id));

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
  // Both fields go up under the header when one is tapped, so the matches and recent stops below
  // them have the room the keyboard leaves (J, 2026-10-08). Once the page has redrawn with the room
  // below to scroll that far (tf-page--typing). iOS also shifts the whole page up as its keyboard
  // opens, to keep the field in view, which on top of this scroll would take the fields off the top,
  // so while the keyboard opens the page is put back and the fields settled again.
  const raiseFields = () => {
    const target = () => {
      const fields = document.querySelector<HTMLElement>('.tf-layer .tf-fields');
      return fields && topUnderHeader(fields, 8);
    };
    const settle = () => {
      if (window.scrollY !== 0) window.scrollTo(0, 0);
      const settled = target();
      if (settled && Math.abs(settled.scroller.scrollTop - settled.top) > 2) settled.scroller.scrollTo({ top: settled.top });
    };
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', settle);
    viewport?.addEventListener('scroll', settle);
    setTimeout(() => {
      viewport?.removeEventListener('resize', settle);
      viewport?.removeEventListener('scroll', settle);
      settle();
    }, 700);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const first = target();
        first?.scroller.scrollTo({ top: first.top, behavior: motionOff() ? 'auto' : 'smooth' });
        setTimeout(settle, 400);
      }),
    );
  };
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
  const { toast, show: showToast, clear: clearToast } = useToast();
  const updatePin = (search: Search, next: Pin | null) => {
    savePin(search, next && { ...next, search });
    setPins(loadPins());
  };
  // Pinning from a saved card, unpinning from a pinned card, or either from a map's sheet says so
  // with Undo, in the words results use (see pinToastText). A map's sheet holds this from when it
  // opened, so the pin it replaces is read as it is now. A toast of a pin finds its card.
  // `routes` names the vehicle a pin replaces, from the card's own times.
  const pinWithUndo = (search: Search, next: Pin | null, routes: Record<string, Route> | undefined, bell = false) => {
    const previous = loadPin(search);
    updatePin(search, next);
    showToast({ text: pinToastText(previous, next, routes, bell), about: next ? 'pin' : 'unpin', ...(next ? { pinned: searchId(search) } : {}), undo: () => updatePin(search, previous) });
  };
  // A saved search's new name or color, and its removal, which Undo puts back in its place.
  const editSaved = (id: string, change: { name: string; color: string | undefined }) =>
    updateSaved(loadSaved().map((item) => (item.id === id ? { ...item, ...change, renamed: change.name !== item.name ? true : item.renamed } : item)));
  const removeFromSaved = (id: string) => {
    // One tap removes a search and its name, color and settings, so it can be undone (J, 2026-10-08).
    const undo = unsave(id);
    setSaved(loadSaved());
    showToast({
      text: 'Removed from Saved',
      about: 'unsaved',
      undo: () => {
        undo();
        setSaved(loadSaved());
      },
    });
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
  // Notices dismissed on results leave the saved cards' counts.
  const [dismissed, setDismissed] = useState(dismissedIds);
  const showing = useScreenActive();
  // The browser asks for location permission on this tap, and Nearby opens once the phone has
  // answered, so the rider never lands on a screen still waiting for them.
  // Only the latest lookup answers, and none from before the rider left Home and came back.
  const [locating, setLocating] = useState<'idle' | 'asking' | LocationProblem>('idle');
  const lookups = useRef(0);
  const here = useRef(true);
  here.current = showing;
  useEffect(() => () => void (here.current = false), []);
  const findNearby = () => {
    const lookup = ++lookups.current;
    setLocating('asking');
    locate().then(
      (position) => {
        if (lookup !== lookups.current) return;
        setLocating('idle');
        // The rider may have opened something else while the phone looked, which Home stays under.
        if (!here.current) return;
        handOver(position);
        navigate('/nearby');
      },
      (problem: LocationProblem) => lookup === lookups.current && setLocating(problem),
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
      getJson<SearchResponse>(apiUrl.search(query, focus === 'to', near), { signal: controller.signal }).then(
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
    take(pickedFrom(hit, response));
  };
  const pickPlace = (place: PlaceResult) => take(pickedPlace(place));
  const take = (picked: Picked) => {
    rememberPicked(picked);
    const field = focus;
    (field === 'from' ? setFrom : setTo)({ query: picked.label, picked });
    setFocus(null);
    setResponse(null);
    // On to the other field, or the results, as Enter and a recent stop do.
    if (field) advance(field, picked);
  };
  // Home leaves once its suggestions have closed and the keyboard has gone, a frame later, as an
  // iPhone keeps a picture of the page left for its own back swipe, which would otherwise show Home
  // mid-search rather than as the rider comes back to it (J, 2026-10-09).
  const leave = (path: string) => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    requestAnimationFrame(() => requestAnimationFrame(() => navigate(path)));
  };
  // Transfers to a route, trips from or to a place or the rider, or both for two stops (see
  // searchPath).
  const open = (fromPicked: Picked, toPicked: Picked) => leave(searchPath({ from: fromPicked.key, to: toPicked.key, fromLabel: fromPicked.short, toLabel: toPicked.short }));
  const showArrivals = () => from.picked && leave(stopPath({ from: from.picked.key, fromLabel: from.picked.short }));
  // Catching a route takes a stop to start from, which a place or the rider's location is not.
  const routeFromNoStop = Boolean(to.picked && endKind(to.picked.key) === 'route' && from.picked && endKind(from.picked.key) !== 'stop');
  const go = () => {
    if (from.picked && to.picked && !routeFromNoStop) open(from.picked, to.picked);
  };

  // Enter takes the first match for what was typed, once its answer is in, then moves on: to the
  // other field, or to the results once both are picked (J, 2026-10-08). The stops along a route
  // named in From are a choice of side and direction, which Enter does not guess.
  const pendingEnter = useRef<'from' | 'to' | null>(null);
  // A stop picked in From moves on to To, even with To filled, as it may need changing too. One
  // picked in To opens the results once From is picked, and otherwise moves to From (J, 2026-10-08).
  const advance = (field: 'from' | 'to', picked: Picked) => {
    const fromPicked = field === 'from' ? picked : from.picked;
    const toPicked = field === 'to' ? picked : to.picked;
    if (field === 'from' || !fromPicked || !toPicked || (endKind(toPicked.key) === 'route' && endKind(fromPicked.key) !== 'stop'))
      return document.querySelector<HTMLElement>(`.tf-layer #${field === 'from' ? 'field-to' : 'field-from'}`)?.focus();
    // Saved now, as Home closes before its own saving would run, and the rider comes back to them.
    saveFields({ from: { query: fromPicked.label, picked: fromPicked }, to: { query: toPicked.label, picked: toPicked } });
    open(fromPicked, toPicked);
  };
  const takeFirst = (field: 'from' | 'to') => {
    const hit = response?.along?.length ? undefined : response?.results[0];
    const place = response?.along?.length ? undefined : response?.places?.[0];
    if (!response || (!hit && !place)) return;
    const picked = hit ? pickedFrom(hit, response) : pickedPlace(place!);
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
    if (!field || !here.current || !response || answeredFor.current !== `${field}|${(field === 'from' ? from : to).query.trim()}`) return;
    pendingEnter.current = null;
    takeFirst(field);
  }, [response]);
  // Kept under the screens it opens (see main.tsx), Home reads storage again on the way back, for
  // what changed there: a search saved or unsaved, a trip pinned, a notice dismissed, a new recent
  // search. A location lookup or Enter still waiting from before is dropped.
  useShownAgain(() => {
    pendingEnter.current = null;
    lookups.current++;
    setLocating('idle');
    setSaved(loadSaved());
    setPins(loadPins());
    setDismissed(dismissedIds());
    setRecentVersion((version) => version + 1);
  });
  const updateSaved = (next: SavedSearch[]) => {
    saveSaved(next);
    setSaved(next);
  };
  const recent = loadRecent()
    .filter((search) => !saved.some((item) => item.id === searchId(search)))
    .map((search) => ({
      id: searchId(search),
      // A stop's arrivals go by the stop alone.
      label: isStopSearch(search) ? search.fromLabel : `${search.fromLabel} → ${search.toLabel}`,
      sub: [isStopSearch(search) && 'Arrivals', search.via && `via ${search.via}`, dayLabel(search.at, now)].filter(Boolean).join(' · '),
      href: searchPath(search),
    }));
  // An empty field the rider is in offers the stops and routes of their recent and saved
  // searches, newest first, so the usual stop is one tap (J, 2026-10-08).
  const usual = (field: 'from' | 'to'): Picked[] => {
    const seen = new Set<string>();
    const known = loadPicked();
    return [...loadRecent(), ...saved].flatMap((search) => {
      const key = field === 'from' ? search.from : search.to;
      const label = field === 'from' ? search.fromLabel : search.toLabel;
      // A stop's arrivals have no To, and the rider's location has a row of its own.
      if (!key || key === HERE || seen.has(key)) return [];
      seen.add(key);
      return [known[key] ?? { key, label, meta: `${capitalize(endKind(key))} from a recent search`, short: label }];
    }).slice(0, 5);
  };
  const emptyField = Boolean(typing && focus && !(focus === 'from' ? from : to).query.trim());
  const usualShown = emptyField && focus ? usual(focus) : [];
  // An empty From offers where the rider is, for trips from there (J, 2026-10-12).
  const offerHere = emptyField && focus === 'from';
  const showingResults = Boolean(query && response) || usualShown.length > 0 || offerHere;

  return (
    <div class="tf-scroll">
      <Toast message={toast} page onDone={clearToast} />
      {/* The header the other screens have, so going to results moves neither the title nor the
          status line. The status line shows only with live cards, as Home asks for nothing else. */}
      <ScreenHeader
        title={
          <span
            onClick={() => {
              const on = tapForGerbils();
              if (on !== null) showToast({ text: on ? 'Gerbil mode on' : 'Gerbil mode off', about: 'notice' });
            }}
          >
            Transfers
          </span>
        }
        end={
          <span class="tf-header__end">
            <span class="tf-muted">{clock(now / 1000)}</span>
            <AppLink class="tf-btn-icon tf-muted" href="/settings" label="Settings">
              <IconGear />
            </AppLink>
          </span>
        }
        {...(liveStatus ? { feed: liveStatus.feed, secondsSinceUpdate: liveStatus.secondsSinceUpdate, stale: liveStatus.stale, onRefresh: () => setPulls((count) => count + 1) } : {})}
      />
      <main class={`tf-page tf-page--form${typing ? ' tf-page--typing' : ''}`} id="main">
        {pins.map((pin) => (
          // Marked with its search, for the toast of a trip pinned to find its card.
          <div key={searchId(pin.search)} class="tf-pin-slot" data-pin={searchId(pin.search)}>
            {isStopSearch(pin.search) ? (
              <StopPinHome pin={pin} name={saved.find(({ id }) => id === searchId(pin.search))?.name} now={now} pulls={pulls} onPin={(next, routes) => pinWithUndo(pin.search, next, routes)} onUpdate={(next) => updatePin(pin.search, next)} onReport={report} />
            ) : (
              <PinnedHome pin={pin} name={saved.find(({ id }) => id === searchId(pin.search))?.name} now={now} pulls={pulls} onPin={(next, routes) => pinWithUndo(pin.search, next, routes)} onUpdate={(next) => updatePin(pin.search, next)} onReport={report} />
            )}
          </div>
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
            raiseFields();
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
        {/* A From stop alone opens its arrivals, with no transfer (J, 2026-10-09). */}
        {(from.query || to.query) && !showingResults && (
          <div class="tf-find-row">
            <button type="button" class="tf-btn-outline tf-btn-secondary" disabled={!from.picked || endKind(from.picked.key) !== 'stop'} onClick={showArrivals} aria-describedby={from.picked ? undefined : 'find-hint'}>
              <span class="tf-find-row__long">Show arrivals</span>
              <span class="tf-find-row__short">Arrivals</span>
            </button>
            <button type="button" class="tf-btn-primary" disabled={!(from.picked && to.picked) || routeFromNoStop} onClick={go} aria-describedby="find-hint">
              {to.picked && endKind(to.picked.key) === 'route' ? 'Find transfers' : 'Find trips'}
            </button>
          </div>
        )}
        {/* What the dimmed button is waiting for, as typing alone does not pick a stop. */}
        {(from.query || to.query) && !showingResults && (!(from.picked && to.picked) || routeFromNoStop) && (
          <p class="tf-find-hint" id="find-hint">
            {routeFromNoStop
              ? 'To catch a route, start from a stop'
              : !from.picked && !to.picked
                ? 'Pick From and To from the lists'
                : !from.picked
                  ? 'Pick where you start from the list'
                  : 'Pick a stop, route or place to go to from the list'}
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
        {offerHere && (
          <div class="tf-results" role="region" aria-label="Your location">
            <button type="button" class="tf-result tf-result--here" onClick={() => choose('from', HERE_PICKED)}>
              <span class="tf-result__name">
                <IconLocation />
                {HERE_LABEL}
              </span>
              <span class="tf-result__dir">Trips from where your phone says you are</span>
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
        {query && response && <StopResults query={query} response={response} onPick={pick} onPickPlace={pickPlace} includesRoutes={focus === 'to'} near={near} />}
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
                {saved.map((search, index) =>
                  isStopSearch(search) ? (
                    <SavedStop
                      key={search.id}
                      search={search}
                      now={now}
                      pulls={pulls}
                      onMove={(step) => moveSaved(search.id, step)}
                      canMoveUp={index > 0}
                      canMoveDown={index < saved.length - 1}
                      onReport={report}
                      onEdit={(change) => editSaved(search.id, change)}
                      onRemove={() => removeFromSaved(search.id)}
                    />
                  ) : (
                  <SavedTrip
                    key={search.id}
                    search={search}
                    now={now}
                    dismissed={dismissed}
                    pulls={pulls}
                    onMove={(step) => moveSaved(search.id, step)}
                    canMoveUp={index > 0}
                    canMoveDown={index < saved.length - 1}
                    pin={pins.find((pin) => searchId(pin.search) === search.id) ?? null}
                    onPin={(pin, routes, bell) => pinWithUndo(search, pin, routes, bell)}
                    onReport={report}
                    onEdit={(change) => editSaved(search.id, change)}
                    onColorless={(lineColor) => {
                      // Saved before colors existed: take one now, avoiding the rest.
                      const all = loadSaved();
                      const taken = all.filter(({ id, color }) => id !== search.id && color).map(({ color }) => color!);
                      updateSaved(all.map((item) => (item.id === search.id && !item.color ? { ...item, color: defaultSavedColor(lineColor, taken) } : item)));
                    }}
                    onRemove={() => removeFromSaved(search.id)}
                  />
                  ),
                )}
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
              showToast({
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
    <div class="tf-about">
      <button type="button" class="tf-about__toggle" aria-expanded={open} aria-controls="how-it-works" onClick={() => setOpen(!open)}>
        How Transfers works
        <IconFold />
      </button>
      <Collapse open={open} id="how-it-works">
        <p>
          Pick a stop and the route you want to catch, or the stop where you will catch it. Transfers shows the next few departures you can catch, and under each one every
          vehicle from your stop that makes it within your transfer window, with live times from 511 and how long each transfer is.
        </p>
        <p>To get somewhere, pick where you start, a stop, a place, or your location, and where you are going. Trips shows the next few ways there, with any changes.</p>
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

// An arrival pinned at a stop, on Home with the pinned trips, following the stop's times as a
// pinned trip follows its results.
function StopPinHome({ pin, name, now, pulls, onPin, onUpdate, onReport }: {
  pin: Pin & { search: Search };
  // The saved stop's name, when the stop is saved.
  name: string | undefined;
  now: number;
  pulls: number;
  onPin: (pin: Pin | null, routes: Record<string, Route> | undefined) => void;
  onUpdate: (pin: Pin | null) => void;
  onReport: Report;
}) {
  const { settings } = useSettings();
  const { search } = pin;
  const polled = usePoll<StopResponse>(apiUrl.stop(search.from, pin), 30_000, null, apiUrl.stop(search.from));
  const { data, feed, answered } = polled;
  const live = useHomeLive(polled, `pin:${searchId(search)}`, pulls, onReport, now);
  const { expired } = useStopPin(pin, data, answered, search, settings, live.now, onUpdate);
  if (expired) return null;
  return <StopPinCard pin={pin} data={data} now={live.now} open={{ label: name ?? search.fromLabel, href: stopPath(search) }} offline={feed === 'offline'} stale={live.note} onPin={(next) => onPin(next, data?.routes)} />;
}

// A pinned trip, as at the top of its results, polling its own trip like a saved card does.
function PinnedHome({ pin, name, now, pulls, onPin, onUpdate, onReport }: {
  pin: Pin & { search: Search };
  // The saved search's name, when the trip is saved.
  name: string | undefined;
  now: number;
  pulls: number;
  onPin: (pin: Pin | null, routes: Record<string, Route> | undefined) => void;
  onUpdate: (pin: Pin | null) => void;
  onReport: Report;
}) {
  const { settings } = useSettings();
  const { search } = pin;
  const polled = usePoll<TripResponse>(apiUrl.trip(search, settings, false, pin), 30_000, null, apiUrl.trip(search, settings, false));
  const { data, feed, answered } = polled;
  const live = useHomeLive(polled, `pin:${searchId(search)}`, pulls, onReport, now);
  const serverNow = live.now;
  const { pinned, unpinAt, expired } = usePinnedTrip(pin, data, answered, search, settings, serverNow, onUpdate);
  const status = live.note;
  // A saved trip goes by the name the rider gave it, as its saved card does.
  const trip = { label: name ?? `${search.fromLabel} to ${search.toLabel}`, href: tripPath(search) };
  if (expired) return null;
  if (!data) {
    return (
      <PinnedFrame label="Pinned trip" open={trip} onUnpin={() => onPin(null, undefined)}>
        <p class="tf-pinned__note">{waitingNote(feed === 'offline')}</p>
      </PinnedFrame>
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
      onPin={(next) => onPin(next, data.routes)}
      trip={trip}
      stale={status}
    />
  );
}

// Polls its own trip, so the card counts down live and opening it shows cached results at once.
function SavedTrip({ search, now, dismissed, pulls, onMove, canMoveUp, canMoveDown, pin, onPin, onReport, onEdit, onColorless, onRemove }: {
  search: SavedSearch;
  now: number;
  // Ids of the notices the rider dismissed.
  dismissed: Set<string>;
  pulls: number;
  onMove: (step: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  // The trip pinned for this search, if any.
  pin: Pin | null;
  onPin: (pin: Pin | null, routes: Record<string, Route> | undefined, bell: boolean) => void;
  onReport: Report;
  onEdit: (change: { name: string; color: string | undefined }) => void;
  onColorless: (lineColor: string | null) => void;
  onRemove: () => void;
}) {
  const { settings } = useSettings();
  const slot = useRef<HTMLDivElement>(null);
  const polled = usePoll<TripResponse>(apiUrl.trip(search, settings, false), useOnScreen(slot) ? 30_000 : OFF_SCREEN_POLL_MS);
  const { data, feed } = polled;
  const live = useHomeLive(polled, `saved:${search.id}`, pulls, onReport, now);
  const summary = summarize(search, data, live.now, dismissed);
  const next = summary.next;
  const pinned = pin !== null && next !== null && samePin(pin, next.pin);
  useEffect(() => {
    if (!search.color && data) onColorless(summary.lineColor);
  }, [Boolean(data), search.color]);
  return (
    <div class="tf-saved-slot" ref={slot}>
      <SavedSearchCard
        name={search.name}
        color={search.color}
        onMove={onMove}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        pin={{
          pinned,
          ready: next !== null,
          label: `Pin the next connection for ${search.name}`,
          toggle: () => next && onPin(pinned ? null : next.pin, data?.routes, !pinned && ringsBell(next.pin, data)),
        }}
        href={tripPath(search)}
        onOpen={() => navigate(tripPath(search))}
        onEdit={onEdit}
        onRemove={onRemove}
      >
        <SavedTripBody
          chain={summary.chain}
          // A name the rider chose says nothing of the trip, and the default leaves out where to get
          // off. Searches saved before renames were kept compare against the default name.
          named={(search.renamed ?? search.name !== `${summary.from} to ${summary.to}`) || summary.via !== null}
          windowText={summary.windowText}
          next={next}
          loading={!data && feed === 'loading'}
          severeAlerts={summary.severeAlerts}
          nextService={summary.nextService}
          staleText={data ? live.note : null}
          unavailable={!data && feed === 'offline'}
        />
      </SavedSearchCard>
    </div>
  );
}

// A saved stop: its routes with something coming soonest, each with its next few arrivals, as many
// as a glance takes in. It opens the stop's arrivals.
function SavedStop({ search, now, pulls, onMove, canMoveUp, canMoveDown, onReport, onEdit, onRemove }: {
  search: SavedSearch;
  now: number;
  pulls: number;
  onMove: (step: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onReport: Report;
  onEdit: (change: { name: string; color: string | undefined }) => void;
  onRemove: () => void;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const polled = usePoll<StopResponse>(apiUrl.stop(search.from), useOnScreen(slot) ? 30_000 : OFF_SCREEN_POLL_MS);
  const { data, feed } = polled;
  const live = useHomeLive(polled, `saved:${search.id}`, pulls, onReport, now);
  const serverNow = live.now;
  const rows = (data?.rows ?? [])
    .map((row) => ({ row, minutes: row.arrivals.map(({ at }) => minutesUntil(at, serverNow)).filter((minutes) => minutes >= 0).slice(0, 3) }))
    .filter(({ minutes }) => minutes.length > 0)
    .slice(0, 3);
  return (
    <div class="tf-saved-slot" ref={slot}>
      <SavedSearchCard
        name={search.name}
        color={search.color}
        onMove={onMove}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        href={stopPath(search)}
        onOpen={() => navigate(stopPath(search))}
        onEdit={onEdit}
        onRemove={onRemove}
      >
        <span class="tf-saved-stop">
          {rows.map(({ row, minutes }) => {
            // BART's lines through one platform go by one chip, as their rider takes whichever comes.
            const routes = row.routes.map((key) => data!.routes[key]).filter((route) => route !== undefined);
            const chips = routes.filter((route, index) => routes.findIndex((other) => chipLabel(other) === chipLabel(route)) === index);
            return (
              <span key={rowKey(row)} class="tf-saved-stop__row">
                <span class="tf-saved-stop__routes">
                  {chips.map((route) => (
                    <RouteChip key={route.key} route={route} size="sm" />
                  ))}
                </span>
                <span class="tf-saved-stop__to">
                  <span aria-hidden="true">→ </span>
                  <span class="tf-sr">toward </span>
                  {row.headsign}
                </span>
                <span class="tf-saved-stop__in">
                  {minutes.map((value) => (value < 1 ? 'Now' : value)).join(', ')}
                  {minutes.at(-1)! >= 1 && ' min'}
                </span>
              </span>
            );
          })}
          {!data && feed === 'loading' && <span class="tf-saved-stop__row tf-skeleton__text" style={{ width: '14em' }} />}
          {!data && feed === 'offline' && <span class="tf-muted">Times can’t load right now</span>}
          {data && rows.length === 0 && <span class="tf-muted">Nothing coming soon</span>}
        </span>
        {live.note && data && (
          <Flag tone="caution" class="tf-saved__stale">
            {live.note}
          </Flag>
        )}
      </SavedSearchCard>
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

// A Home card's live times: refreshed by every pull, counted in the status line under the title,
// on the server's clock, with the note the card shows when they are not live (see liveNote).
function useHomeLive(polled: Polled<{ generatedAt: number; dataAt: number | null }>, key: string, pulls: number, onReport: Report, deviceNow: number) {
  useEffect(() => void (pulls && polled.refresh()), [pulls]);
  const clock = liveClock(polled, deviceNow);
  useLiveReport(onReport, key, { feed: polled.feed, fetchedAt: polled.fetchedAt, dataAt: polled.data?.dataAt ?? null, skew: clock.skew, settled: polled.settled });
  return { ...clock, note: liveNote(polled.feed, clock.fresh, polled.settled) };
}

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
