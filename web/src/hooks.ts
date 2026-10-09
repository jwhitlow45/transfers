import { useEffect, useRef, useState } from 'preact/hooks';
import { getJson } from './api.ts';
import { usePeeking } from './gestures.ts';
import { useScreenActive } from './layers.ts';
import type { StopResponse, TripResponse } from '../../shared/api.ts';
import { pinnedEnd, pinnedNow, samePin } from './lib/pinned.ts';
import { pinnedArrival } from './lib/stop-pins.ts';
import { type DeviceSettings, type Pin, type Search, loadCached, loadPin, saveCached } from './storage.ts';

// The device clock, ticking every second so countdowns move offline too.
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  // A screen kept under another stands still, rather than render every second unseen, until it
  // shows again or a swipe back uncovers it (see main.tsx).
  const active = useScreenActive();
  const peeking = usePeeking();
  const live = active || peeking;
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, live]);
  return now;
}

export type FeedState = 'live' | 'refreshing' | 'loading' | 'offline';

export type Polled<T> = {
  data: T | null;
  error: string | null;
  // When the shown data arrived, in milliseconds on this device's clock.
  fetchedAt: number | null;
  feed: FeedState;
  // False until the refresh after opening, or after coming back into view, has finished or had
  // five seconds. Data shown then is usually old, and a warning about it would flash for the
  // second the refresh takes, so warnings wait for this.
  settled: boolean;
  // False until the refresh after opening, or after coming back into view (to the app, or to a
  // screen kept under another), has answered or failed, however long that takes. Data shown before
  // then may be from long ago, or older than what another screen has since saved, so nothing that
  // cannot be undone, such as unpinning a trip, is decided from it. A stored answer young enough to
  // show without refreshing is no exception.
  answered: boolean;
  refresh: () => void;
};

// The header's refresh bar stays up at least this long, so a quick refresh does not flash it.
const MIN_REFRESH_MS = 800;
// A request still unanswered after this is given up on, so a stalled connection underground
// cannot stop refreshing.
const REQUEST_TIMEOUT_MS = 15_000;
const SETTLE_MS = 5000;

// The server's answer for `url`, asked once each time it changes, and not while it is null. It
// keeps the last answer until the next comes. `current` says it answers `url`, and `failed` that
// the request for it did not. A request given up for a newer one is no failure.
export function useFetch<T>(url: string | null) {
  const [answer, setAnswer] = useState<{ url: string | null; data: T | null; failed: boolean }>({ url: null, data: null, failed: false });
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    getJson<T>(url, { signal: controller.signal }).then(
      (data) => setAnswer({ url, data, failed: false }),
      () => controller.signal.aborted || setAnswer((last) => ({ ...last, url, failed: true })),
    );
    return () => controller.abort();
  }, [url]);
  return { data: answer.data, current: url !== null && answer.url === url, failed: answer.failed };
}

// Fetches `url` every `intervalMs` while the page is visible. Shows the last response for the
// same URL at once (from this session or storage), so returning or going offline never blanks
// the screen. That response counts as a fetch: the first one comes a full `intervalMs` after it
// arrived, at once only when there is none or it is that old, so changing pages refreshes nothing
// that is not due (J, 2026-10-08). Each page keeps its own rhythm after that, so devices never
// line up into bursts.
// `initial` is a response that arrived with the page, and when it arrived. `remember` false keeps
// responses out of storage, for data that is no use on a later visit. A string keeps them under
// that key rather than the URL, so requests that differ only in what changes with every use, such
// as a pinned trip, share one stored copy rather than leaving one each.
export function usePoll<T>(url: string | null, intervalMs = 30_000, initial: { data: T; fetchedAt: number } | null = null, remember: boolean | string = true): Polled<T> {
  const key = remember === true ? url : remember || null;
  // A stored answer younger than a refresh is as good as one just fetched, for showing (see answered).
  const [fresh] = useState(() => {
    const cached = !initial && key ? loadCached<T>(key) : null;
    return cached !== null && Date.now() - cached.fetchedAt < intervalMs;
  });
  const [state, setState] = useState<Omit<Polled<T>, 'refresh' | 'settled' | 'answered'>>(() => {
    const cached = key ? loadCached<T>(key) : null;
    const data = initial?.data ?? cached?.data ?? null;
    return { data, error: null, fetchedAt: initial?.fetchedAt ?? cached?.fetchedAt ?? null, feed: initial || fresh ? 'live' : data ? 'refreshing' : 'loading' };
  });
  const [settled, setSettled] = useState(Boolean(initial) || fresh);
  const [answered, setAnswered] = useState(Boolean(initial));
  const tick = useRef<() => void>(() => {});
  // Under another screen, kept for going back to, it does not poll (see main.tsx). A refresh
  // missed meanwhile comes once it shows again.
  const active = useScreenActive();
  const activeRef = useRef(active);
  activeRef.current = active;
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const unsettle = () => {
    setSettled(false);
    clearTimeout(hold.current);
    hold.current = setTimeout(() => setSettled(true), SETTLE_MS);
  };
  const shown = useRef(false);
  // A fetch due while covered, as when a setting changed the request, waits until the screen shows.
  const missed = useRef(false);
  useEffect(() => {
    if (!shown.current) return void (shown.current = true);
    // Covered, its times grow old unseen, and the screen it was under may have newer ones, so
    // nothing acts on them until a refresh made once it shows again has answered. That is the next
    // one due, so going back costs no request while the times are still fresh.
    if (!active) return setAnswered(false);
    // Old times showing again count as unsettled, as on coming back to the app, until the refresh
    // sent now answers.
    if (missed.current || (state.fetchedAt !== null && Date.now() - state.fetchedAt >= intervalMs)) {
      unsettle();
      tick.current();
    }
  }, [active]);
  // When the page's own response arrived, until the first refresh is planned from it.
  const seeded = useRef(initial?.fetchedAt ?? null);

  useEffect(() => {
    // The page's own response is used once, so a later visit finds it with the rest.
    if (initial && key) saveCached(key, initial.data, initial.fetchedAt);
    if (!initial) hold.current = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(hold.current);
  }, []);

  useEffect(() => {
    if (!url) return;
    let controller: AbortController | null = null;
    let settle: ReturnType<typeof setTimeout> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const plan = (delay: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => (document.visibilityState === 'visible' && activeRef.current ? void fetchNow() : plan(intervalMs)), delay);
    };
    const cached = seeded.current === null && key ? loadCached<T>(key) : null;
    // A changed setting is a new URL. Until its answer arrives, the previous results stay up as
    // refreshing, which beats flashing an empty screen.
    if (cached) setState((current) => ({ ...current, data: cached.data, fetchedAt: cached.fetchedAt }));

    // A refresh that answers while the page is hidden is old by the time the page is back, and the
    // one sent then answers for it.
    const answer = () => {
      if (document.visibilityState === 'visible' && activeRef.current) setAnswered(true);
    };
    const fetchNow = async () => {
      missed.current = false;
      controller?.abort();
      controller = new AbortController();
      // The next refresh is set before this one is sent, so one that never answers still leaves
      // the next on its way.
      plan(intervalMs);
      const started = Date.now();
      const request = controller;
      // A plain timer rather than AbortSignal.timeout, which older iPhones lack.
      let timedOut = false;
      const giveUp = setTimeout(() => {
        timedOut = true;
        request.abort();
      }, REQUEST_TIMEOUT_MS);
      setState((current) => ({ ...current, feed: current.data ? 'refreshing' : 'loading' }));
      try {
        const data = await getJson<T>(url, { signal: request.signal, ...(key ? { cacheAs: key } : {}) });
        // New data shows at once. Only the refresh bar lingers.
        setState({ data, error: null, fetchedAt: Date.now(), feed: 'refreshing' });
        answer();
        clearTimeout(settle);
        settle = setTimeout(() => setState((current) => ({ ...current, feed: 'live' })), Math.max(0, MIN_REFRESH_MS - (Date.now() - started)));
      } catch (error) {
        // Aborted for a newer request or for leaving the page: that one takes over.
        if ((error as Error).name === 'AbortError' && !timedOut) return;
        // A timeout or a network failure both mean the server could not be reached.
        const unreachable = timedOut || !navigator.onLine || error instanceof TypeError;
        setState((current) => ({ ...current, error: unreachable ? null : (error as Error).message, feed: unreachable ? 'offline' : 'live' }));
        answer();
      } finally {
        clearTimeout(giveUp);
        setSettled(true);
      }
    };
    tick.current = () => void fetchNow();
    // Data the server put in the page, or a stored answer, waits a full refresh from when it
    // arrived.
    const since = seeded.current ?? cached?.fetchedAt ?? null;
    if (since === null || Date.now() - since >= intervalMs) {
      if (activeRef.current) void fetchNow();
      else missed.current = true;
    } else {
      plan(intervalMs - (Date.now() - since));
      // A refresh cut short by this change, such as a card's slower pace once scrolled away, has
      // answered for the time being.
      setState((current) => (current.feed === 'refreshing' ? { ...current, feed: 'live' } : current));
    }
    seeded.current = null;
    const onVisible = () => {
      // Hidden, the page stops refreshing, so what it shows is old by the time it is back, until the
      // refresh sent then answers.
      setAnswered(false);
      if (document.visibilityState !== 'visible' || !activeRef.current) return;
      unsettle();
      void fetchNow();
    };
    const onOffline = () => setState((current) => ({ ...current, feed: 'offline' }));
    document.addEventListener('visibilitychange', onVisible);
    addEventListener('online', onVisible);
    addEventListener('offline', onOffline);
    return () => {
      controller?.abort();
      clearTimeout(settle);
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      removeEventListener('online', onVisible);
      removeEventListener('offline', onOffline);
    };
  }, [url, intervalMs]);

  return { ...state, settled, answered, refresh: () => tick.current() };
}

// A pinned trip as its vehicles run now (see pinnedNow). Keeps the pin's end and last times
// current, and unpins it the set time after its end, counted from the latest times, with that
// setting on (see useKeptPin). `now` is milliseconds on the server's clock.
export function usePinnedTrip(pin: Pin | null, data: TripResponse | null, answered: boolean, search: Search, settings: DeviceSettings, now: number, change: (pin: Pin | null) => void) {
  const { pinned, fresh } = pin ? pinnedNow(pin, data, search.dest) : { pinned: null, fresh: false };
  const ends = pinned ? pinnedEnd(pinned) : null;
  const seen = fresh && pinned ? JSON.stringify(pinned) : null;
  const kept = useKeptPin(pin, answered, search, settings, now, change, {
    seen,
    known: pin ? JSON.stringify(pin.last) : null,
    latest: () => ({ ...pin!, last: pinned!, ...(ends !== null ? { ends } : {}) }),
    end: ends ?? pin?.ends ?? null,
  });
  return { pinned, ...kept };
}

// An arrival pinned at a stop as it comes (see stopPinOf): keeps its end as the latest times move
// it, and unpins it the set time after it arrives, with that setting on, as a trip is (see
// useKeptPin).
export function useStopPin(pin: Pin | null, data: StopResponse | null, answered: boolean, search: Search, settings: DeviceSettings, now: number, change: (pin: Pin | null) => void) {
  const found = pin ? pinnedArrival(pin, data) : null;
  const seen = found?.arrival?.at ?? null;
  const kept = useKeptPin(pin, answered, search, settings, now, change, { seen, known: pin?.ends ?? null, latest: () => ({ ...pin!, ends: seen! }), end: seen ?? pin?.ends ?? null });
  return { found, ...kept };
}

// What every pin shares as its times come: when the latest answer has seen it anew (`seen`, unlike
// `known`, what the pin holds), its times are written back (`latest`), and the set time after its
// `end` it unpins, with that setting on. Only once `answered` (see Polled), so times from long ago
// cannot unpin a trip that is running late, nor be written over newer ones another screen saved.
// Only the screen showing changes the pin, and only while it is still the one stored: a screen
// kept under another may hold one the rider has since replaced there (see main.tsx).
function useKeptPin(pin: Pin | null, answered: boolean, search: Search, settings: DeviceSettings, now: number, change: (pin: Pin | null) => void, { seen, known, latest, end }: { seen: string | number | null; known: string | number | null; latest: () => Pin; end: number | null }) {
  const active = useScreenActive();
  const changeOwn = (next: Pin | null) => {
    const stored = loadPin(search);
    if (active && pin && stored && samePin(stored, pin)) change(next);
  };
  useEffect(() => {
    if (!answered || !pin || seen === null || seen === known) return;
    changeOwn(latest());
  }, [seen, active, answered]);
  const unpinAt = pin && settings.autoUnpin && end !== null ? (end + settings.unpinAfter * 60) * 1000 : null;
  const expired = answered && unpinAt !== null && now >= unpinAt;
  useEffect(() => {
    if (expired) changeOwn(null);
  }, [expired, active]);
  return { unpinAt, expired };
}
