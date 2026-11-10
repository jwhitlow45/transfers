import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Route, SearchResponse, StopResponse, TripResponse } from '../../../shared/api.ts';
import { apiUrl, getJson } from '../api.ts';
import { Collapse } from '../components/Collapse.tsx';
import { DataCredit } from '../components/DataCredit.tsx';
import { RecentList } from '../components/RecentList.tsx';
import { SavedSearchCard, SavedTripBody } from '../components/SavedSearchCard.tsx';
import { SearchFields } from '../components/SearchFields.tsx';
import { type SearchHit, StopResults, hitMeta, hitName, searchCount } from '../components/StopResults.tsx';
import { Toast, useToast } from '../components/Toast.tsx';
import { ScreenHeader } from '../components/ResultsHeader.tsx';
import { approxMinutes, atLeast, clock, minutesUntil, stillWaiting } from '../format.ts';
import { type Polled, useNow, usePoll } from '../hooks.ts';
import { IconFold, IconGear, IconLocation } from '../icons/ui.tsx';
import { defaultSavedColor } from '../lib/color.ts';
import { ringsBell } from '../lib/eggs.ts';
import { samePin } from '../lib/pinned.ts';
import { changePin, usePins } from '../pins.ts';
import { homeStatus, liveClock, liveNote, type LiveReport } from '../lib/freshness.ts';
import { type LocationProblem, type Position, handOver, locate, locationProblemText } from '../lib/location.ts';
import { type Later, laterSpoken, laterText, summarize } from '../lib/summary.ts';
import { tapForGerbils } from '../gerbils.ts';
import { unsave } from '../records.ts';
import { motionOff } from '../gestures.ts';
import { useScreenActive, useShownAgain } from '../layers.ts';
import { navigate, searchPath, stopPath } from '../router.ts';
import { RouteChip } from '../components/RouteChip.tsx';
import { useSettings } from '../settings.tsx';
import {
  type Pin,
  type SavedSearch,
  isStopSearch,
  loadDismissed,
  loadFields,
  loadPicked,
  loadRecent,
  loadSaved,
  removeRecent,
  rememberPicked,
  saveFields,
  saveRecent,
  saveSaved,
  searchId,
} from '../storage.ts';
import { chipLabel, dayLabel, stopLabel } from '../view.ts';
import { AppLink } from '../components/AppLink.tsx';
import { topUnderHeader } from '../lib/scroll.ts';
import { tripPath } from '../../../shared/paths.ts';
import { Warnline } from '../components/StatusTag.tsx';
import { Num } from '../components/Countdown.tsx';
import { rowKey } from '../components/RouteCard.tsx';

// A picked stop or route. `short` is what headers and lists call it.
export type Picked = { key: string; label: string; meta: string; short: string };
type FieldState = { query: string; picked?: Picked };

function pickedFrom(hit: SearchHit, response: SearchResponse): Picked {
  if (hit.type === 'route') {
    const route = response.routes[hit.route];
    return { key: `route:${hit.route}`, label: hitName(hit, response), meta: hitMeta(hit, response), short: route ? chipLabel(route) : hit.route };
  }
  return { key: hit.key, label: hit.name, meta: hitMeta(hit, response), short: stopLabel(hit) };
}

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
  // What is pinned, which the app's pin bar shows, for a saved card to mark its own.
  const pins = usePins();
  // How fresh each live card's times are, by card, for the status line under the title.
  const [reports, setReports] = useState<Record<string, LiveReport>>({});
  const report = useCallback((key: string, next: LiveReport | null) => {
    setReports(({ [key]: _old, ...others }) => (next ? { ...others, [key]: next } : others));
  }, []);
  const liveStatus = homeStatus(Object.values(reports), now);
  const { toast, show: showToast, clear: clearToast } = useToast();
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
  // Whether the saved cards show their editing: one Edit on the Saved heading turns it on for all
  // of them, in place of a pencil on each. With the last card removed, there is nothing to edit.
  const [editingSaved, setEditingSaved] = useState(false);
  useEffect(() => {
    if (saved.length === 0) setEditingSaved(false);
  }, [saved.length]);
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
  // An empty From offers the stops nearest the rider, first, once the phone says where they are,
  // which it is asked on a tap unless location is already allowed (J, 2026-10-12).
  const fromEmpty = Boolean(typing && focus === 'from' && !from.query.trim());
  const [nearAsk, setNearAsk] = useState<'idle' | 'asking' | LocationProblem>('idle');
  const [nearby, setNearby] = useState<SearchResponse | null>(null);
  useEffect(() => {
    if (!fromEmpty || !near) return;
    const controller = new AbortController();
    getJson<SearchResponse>(apiUrl.search('', false, near), { signal: controller.signal }).then(setNearby, () => {});
    return () => controller.abort();
  }, [fromEmpty, near]);
  // The tap takes focus from From, which would close the list the stops are to show in.
  const askNear = () => {
    document.querySelector<HTMLElement>('.tf-layer #field-from')?.focus();
    setNearAsk('asking');
    locate().then(
      (position) => {
        setNearAsk('idle');
        if (here.current) setNear(position);
      },
      (problem: LocationProblem) => setNearAsk(problem),
    );
  };
  const nearPicks = fromEmpty && near && nearby ? nearby.results.flatMap((hit) => (hit.type === 'stop' ? [{ picked: pickedFrom(hit, nearby), meters: hit.meters ?? 0 }] : [])) : [];
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
    const picked = pickedFrom(hit, response);
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
  const open = (fromPicked: Picked, toPicked: Picked) => leave(tripPath({ from: fromPicked.key, to: toPicked.key, fromLabel: fromPicked.short, toLabel: toPicked.short }));
  const showArrivals = () => from.picked && leave(stopPath({ from: from.picked.key, fromLabel: from.picked.short }));
  const go = () => {
    if (from.picked && to.picked) open(from.picked, to.picked);
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
    if (field === 'from' || !fromPicked || !toPicked) return document.querySelector<HTMLElement>(`.tf-layer #${field === 'from' ? 'field-to' : 'field-from'}`)?.focus();
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
      const first = (field === 'from' ? nearPicks[0]?.picked : undefined) ?? usual(field)[0];
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
  // what changed there: a search saved or unsaved, a notice dismissed, a new recent
  // search. A location lookup or Enter still waiting from before is dropped.
  useShownAgain(() => {
    pendingEnter.current = null;
    lookups.current++;
    setLocating('idle');
    setNearAsk('idle');
    setSaved(loadSaved());
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
      // A stop's arrivals have no To.
      if (!key || seen.has(key)) return [];
      seen.add(key);
      return [known[key] ?? { key, label, meta: key.startsWith('route:') ? 'Route from a recent search' : 'Stop from a recent search', short: label }];
    }).slice(0, 5);
  };
  const usualShown = typing && focus && !(focus === 'from' ? from : to).query.trim() ? usual(focus) : [];
  const showingResults = Boolean(query && response) || usualShown.length > 0 || fromEmpty;

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
          <>
            <span>{clock(now / 1000)}</span>
            <AppLink class="tf-btn-icon tf-muted" href="/settings" label="Settings">
              <IconGear />
            </AppLink>
          </>
        }
        {...(liveStatus ? { feed: liveStatus.feed, secondsSinceUpdate: liveStatus.secondsSinceUpdate, stale: liveStatus.stale, onRefresh: () => setPulls((count) => count + 1) } : {})}
      />
      <main class={`tf-page tf-page--form${typing ? ' tf-page--typing' : ''}`} id="main">
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
            <button type="button" class="tf-btn-outline tf-btn-secondary" disabled={!from.picked} onClick={showArrivals} aria-describedby={from.picked ? undefined : 'find-hint'}>
              <span class="tf-find-row__long">Show arrivals</span>
              <span class="tf-find-row__short">Arrivals</span>
            </button>
            <button type="button" class="tf-btn-primary" disabled={!(from.picked && to.picked)} onClick={go} aria-describedby="find-hint">
              Find transfers
            </button>
          </div>
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
        {fromEmpty &&
          (near ? (
            nearPicks.length > 0 && <NearStops picks={nearPicks} onPick={(picked) => choose('from', picked)} />
          ) : (
            <div class="tf-results" role="region" aria-label="Stops near you">
              <button type="button" class="tf-result tf-result--near" onClick={askNear} disabled={nearAsk === 'asking'}>
                <span class="tf-result__name">
                  <IconLocation />
                  {nearAsk === 'asking' ? 'Finding you…' : 'Stops near you'}
                </span>
                <span class="tf-result__dir">The stops closest to where your phone says you are</span>
              </button>
              {(nearAsk === 'denied' || nearAsk === 'unavailable') && (
                <div class="tf-near__problem" role="alert">
                  {locationProblemText(nearAsk)}
                </div>
              )}
            </div>
          ))}
        {usualShown.length > 0 && focus && <UsualStops picks={usualShown} enterTakesFirst={!(focus === 'from' && nearPicks.length > 0)} onPick={(picked) => choose(focus, picked)} />}
        {/^gerbils?$/i.test(query) && (
          <div class="tf-results" role="status">
            <div class="tf-result">
              <span class="tf-result__name">Nearest gerbil</span>
              <span class="tf-result__dir">Under your seat. Mind the tail.</span>
            </div>
          </div>
        )}
        {query && response && <StopResults query={query} response={response} onPick={pick} includesRoutes={focus === 'to'} />}
        {/* What a screen reader hears of each answer, mounted from the start, as a live region only
            speaks what changes in it. */}
        <div class="tf-sr" aria-live="polite">
          {query && response ? searchCount(query, response, focus === 'to') : ''}
        </div>
        {/* Hidden rather than unmounted under the suggestions, so the saved cards keep their times
            and the status line above the fields stays put while the rider types. */}
        <div class="tf-home-rest" hidden={showingResults}>
          <button type="button" class="tf-textbtn tf-nearby-button" onClick={findNearby} disabled={locating === 'asking'}>
            <IconLocation />
            {locating === 'asking' ? 'Finding you…' : 'Nearby routes'}
          </button>
          {(locating === 'denied' || locating === 'unavailable') && (
            <div class="tf-near__problem" role="alert">
              {locationProblemText(locating)}
            </div>
          )}
          {saved.length > 0 && (
            <section class="tf-section" aria-labelledby="saved-heading">
              {/* One Edit for every card: each then shows its name, color, order and removal. */}
              <div class="tf-section__head">
                <h2 id="saved-heading">Saved</h2>
                <button type="button" class="tf-textbtn" onClick={() => setEditingSaved(!editingSaved)}>
                  {editingSaved ? 'Done' : 'Edit'}
                </button>
              </div>
              <div class="tf-saved-grid" onKeyDown={(event) => event.key === 'Escape' && setEditingSaved(false)}>
                {saved.map((search, index) =>
                  isStopSearch(search) ? (
                    <SavedStop
                      key={search.id}
                      search={search}
                      now={now}
                      pulls={pulls}
                      editing={editingSaved}
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
                    editing={editingSaved}
                    onMove={(step) => moveSaved(search.id, step)}
                    canMoveUp={index > 0}
                    canMoveDown={index < saved.length - 1}
                    pin={pins.find((pin) => searchId(pin.search) === search.id) ?? null}
                    onPin={(pin, routes, bell) => changePin(search, pin, routes, bell)}
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
      <button type="button" class="tf-fold tf-fold--bare" aria-expanded={open} aria-controls="how-it-works" onClick={() => setOpen(!open)}>
        <span>How Transfers works</span>
        <IconFold />
      </button>
      <Collapse open={open} id="how-it-works">
        <p>
          Pick the stop where you start, then the route you want to catch or the stop you are going to. With nothing typed, From lists the stops near you.
        </p>
        <p>
          Catching a route, Transfers shows its next few departures you can make, and under each one every vehicle from your stop that gets you there in time, with how long
          each transfer is. A stop has two tabs. Trips shows the ways to get there: the routes that go straight there, or when none does, every way there with one transfer,
          soonest there first, and trips with more changes when nothing simpler works. Transfers shows what you can catch at that stop. The page opens on Transfers when a route
          already takes you there, and on Trips otherwise.
        </p>
        <p>
          You set the transfer window: the shortest and longest transfer you will accept. Trip planners pad transfers for lateness they cannot see, so they leave out tight
          connections you can make. Transfers compares live times from 511 on both vehicles instead, so it shows those connections, and how late each vehicle is running.
        </p>
        <p>
          It helps most going from frequent service to infrequent, such as BART to a bus that comes every 20 minutes, where the train you catch decides whether you make
          the bus.
        </p>
        <p>
          It is built for one bar of signal, such as underground. Each request asks only for what the page shows, so answers stay small and arrive when bigger ones would
          not. The last results show at once while new ones load, and extras like the live map load only when you open them.
        </p>
        <p>
          Settings has your walking speed and longest walk, whether BART's elevator and escalator outages show, and more time to change at stations if you use elevators.
        </p>
        <p>Tap a connection or an arrival to pin it. It stays at the top of every page and updates live until you unpin it. Tap a time to follow its vehicle on a map.</p>
      </Collapse>
    </div>
  );
}

// Polls its own trip, so the card counts down live and opening it shows cached results at once.
function SavedTrip({ search, now, dismissed, pulls, editing, onMove, canMoveUp, canMoveDown, pin, onPin, onReport, onEdit, onColorless, onRemove }: {
  search: SavedSearch;
  now: number;
  // Ids of the notices the rider dismissed.
  dismissed: Set<string>;
  pulls: number;
  editing: boolean;
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
  const togglePin = (on: boolean) => next && onPin(on ? next.pin : null, data?.routes, on && ringsBell(next.pin, data));
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
        editing={editing}
        openLabel={`Open ${search.name}`}
        pin={{
          pinned,
          ready: next !== null,
          what: `the next connection for ${search.name}`,
          toggle: () => togglePin(!pinned),
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
          trackPin={next ? { pinned, label: next.pinLabel, set: togglePin } : undefined}
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
function SavedStop({ search, now, pulls, editing, onMove, canMoveUp, canMoveDown, onReport, onEdit, onRemove }: {
  search: SavedSearch;
  now: number;
  pulls: number;
  editing: boolean;
  onMove: (step: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onReport: Report;
  onEdit: (change: { name: string; color: string | undefined }) => void;
  onRemove: () => void;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const { settings } = useSettings();
  const polled = usePoll<StopResponse>(apiUrl.stop(search.from, settings), useOnScreen(slot) ? 30_000 : OFF_SCREEN_POLL_MS);
  const { data, feed } = polled;
  const live = useHomeLive(polled, `saved:${search.id}`, pulls, onReport, now);
  const serverNow = live.now;
  const rows = (data?.rows ?? [])
    .map((row) => ({ row, times: row.arrivals.filter(({ at, notStarted }) => minutesUntil(at, serverNow) >= 0 || stillWaiting(at, serverNow, notStarted)).map(({ at, live, notStarted }) => ({ minutes: minutesUntil(at, serverNow), scheduled: !live, notStarted: notStarted === true })).slice(0, 3) }))
    .filter(({ times }) => times.length > 0)
    .slice(0, 3);
  return (
    <div class="tf-saved-slot" ref={slot}>
      <SavedSearchCard
        name={search.name}
        color={search.color}
        onMove={onMove}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        editing={editing}
        // A stop saved under a name of the rider's says which stop it is too.
        openLabel={`Arrivals at ${search.name === search.fromLabel ? search.name : `${search.name}, ${search.fromLabel}`}`}
        href={stopPath(search)}
        onOpen={() => navigate(stopPath(search))}
        onEdit={onEdit}
        onRemove={onRemove}
      >
        {/* One row for each route and direction: its next arrival in the number column, where it
            goes in full, and its later ones under that. */}
        {rows.map(({ row, times }) => {
          // BART's lines through one platform go by one chip, as their rider takes whichever comes.
          const routes = row.routes.map((key) => data!.routes[key]).filter((route) => route !== undefined);
          const chips = routes.filter((route, index) => routes.findIndex((other) => chipLabel(other) === chipLabel(route)) === index);
          const [first, ...later] = times as [Later, ...Later[]];
          const now = first.minutes < 1 && !first.scheduled && !first.notStarted;
          const count = Math.max(1, first.minutes);
          const spoken = `${chips.map(chipLabel).join(', ')} toward ${row.headsign}, ${now ? 'arriving now' : `in ${first.scheduled ? 'a scheduled ' : first.notStarted ? 'at least ' : ''}${count} minute${count === 1 ? '' : 's'}`}.${laterSpoken(later)}`;
          return (
            <div key={rowKey(row)} class="tf-row">
              <span class="tf-sr">{spoken}</span>
              <Num n={now ? 'Now' : first.notStarted ? atLeast(first.minutes) : approxMinutes(first.minutes, first.scheduled)} unit={now ? null : 'min'} />
              <div class="tf-rb" aria-hidden="true">
                <div class="tf-rb__main">
                  <div class="tf-l1">
                    {chips.map((route) => (
                      <RouteChip key={route.key} route={route} />
                    ))}
                    <span>→ {row.headsign}</span>
                  </div>
                  {later.length > 0 && <div class="tf-l2">{laterText(later)}</div>}
                </div>
              </div>
            </div>
          );
        })}
        {!data && feed === 'loading' && (
          <div class="tf-row">
            <span class="tf-sr">Getting live predictions…</span>
            <span class="tf-num" aria-hidden="true">
              <span class="tf-num__n tf-skeleton__text" style={{ width: '1.5em', height: '1em' }} />
              <span class="tf-num__u tf-skeleton__text" style={{ width: '2em' }} />
            </span>
            <div class="tf-rb" aria-hidden="true">
              <div class="tf-rb__main">
                <span class="tf-l1 tf-skeleton__text" style={{ width: '10em' }} />
                <span class="tf-l2 tf-skeleton__text" style={{ width: '7em' }} />
              </div>
            </div>
          </div>
        )}
        {((!data && feed === 'offline') || (data && rows.length === 0)) && (
          <div class="tf-row tf-row--note">
            <div class="tf-l2">{data ? 'Nothing coming soon' : 'Times can’t load right now'}</div>
          </div>
        )}
        {live.note && data && (
          <div class="tf-card__foot">
            <Warnline tone="caution">{live.note}</Warnline>
          </div>
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

// The stops nearest the rider, for an empty From, with how far each is. The first is the one Enter
// takes.
function NearStops({ picks, onPick }: { picks: { picked: Picked; meters: number }[]; onPick: (picked: Picked) => void }) {
  return (
    <div class="tf-results" role="region" aria-label="Stops near you">
      <div class="tf-results__label">Near you</div>
      <div role="list">
        {picks.map(({ picked, meters }, index) => (
          <div role="listitem" key={picked.key}>
            <button type="button" class={`tf-result${index === 0 ? ' tf-result--enter' : ''}`} onClick={() => onPick(picked)}>
              <span class="tf-result__name">
                {picked.label}
                {index === 0 && <span class="tf-sr"> (Enter picks this)</span>}
              </span>
              <span class="tf-result__dir">
                {meters}&nbsp;m away · {picked.meta}
              </span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// The stops and routes of recent searches, for an empty field. The first is the one Enter takes,
// unless the stops near the rider come first.
function UsualStops({ picks, enterTakesFirst, onPick }: { picks: Picked[]; enterTakesFirst: boolean; onPick: (picked: Picked) => void }) {
  return (
    <div class="tf-results" role="region" aria-label="Recent stops and routes">
      <div class="tf-results__label">Recent</div>
      <div role="list">
        {picks.map((picked, index) => (
          <div role="listitem" key={picked.key}>
            <button type="button" class={`tf-result${enterTakesFirst && index === 0 ? ' tf-result--enter' : ''}`} onClick={() => onPick(picked)}>
              <span class="tf-result__name">
                {picked.label}
                {enterTakesFirst && index === 0 && <span class="tf-sr"> (Enter picks this)</span>}
              </span>
              <span class="tf-result__dir">{picked.meta}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
