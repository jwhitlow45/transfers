import { useEffect, useRef, useState } from 'preact/hooks';
import { getJson } from './api.ts';
import type { TripResponse } from '../../shared/api.ts';
import { pinnedEnd, pinnedNow } from './lib/pinned.ts';
import { type DeviceSettings, type Pin, loadCached, saveCached } from './storage.ts';

// The device clock, ticking every second so countdowns move offline too.
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
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
  // False until the refresh after opening, or after coming back into view, has answered or failed,
  // however long that takes. Data shown before then may be from long ago, so nothing that cannot be
  // undone, such as unpinning a trip, is decided from it.
  answered: boolean;
  refresh: () => void;
};

// The header's refresh bar stays up at least this long, so a quick refresh does not flash it.
const MIN_REFRESH_MS = 800;
// A request still unanswered after this is given up on, so a stalled connection underground
// cannot stop refreshing.
const REQUEST_TIMEOUT_MS = 15_000;
const SETTLE_MS = 5000;

// Fetches `url` now and every `intervalMs` while the page is visible. Shows the last response
// for the same URL at once (from this session or storage), so returning or going offline
// never blanks the screen. Fetches come every `intervalMs` from when the page opened, and
// never faster when data is old. Pages opening at different times keep their own rhythm, so
// devices never line up into bursts.
// `initial` is a response that arrived with the page, and when it arrived. `remember` false keeps
// responses out of storage, for data that is no use on a later visit. A string keeps them under
// that key rather than the URL, so requests that differ only in what changes with every use, such
// as a pinned trip, share one stored copy rather than leaving one each.
export function usePoll<T>(url: string | null, intervalMs = 30_000, initial: { data: T; fetchedAt: number } | null = null, remember: boolean | string = true): Polled<T> {
  const key = remember === true ? url : remember || null;
  const [state, setState] = useState<Omit<Polled<T>, 'refresh' | 'settled' | 'answered'>>(() => {
    const cached = key ? loadCached<T>(key) : null;
    const data = initial?.data ?? cached?.data ?? null;
    return { data, error: null, fetchedAt: initial?.fetchedAt ?? cached?.fetchedAt ?? null, feed: initial ? 'live' : data ? 'refreshing' : 'loading' };
  });
  const [settled, setSettled] = useState(Boolean(initial));
  const [answered, setAnswered] = useState(Boolean(initial));
  const tick = useRef<() => void>(() => {});
  // When the page's own response arrived, until the first refresh is planned from it.
  const seeded = useRef(initial?.fetchedAt ?? null);
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const unsettle = () => {
    setSettled(false);
    clearTimeout(hold.current);
    hold.current = setTimeout(() => setSettled(true), SETTLE_MS);
  };

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
      timer = setTimeout(() => (document.visibilityState === 'visible' ? void fetchNow() : plan(intervalMs)), delay);
    };
    if (seeded.current === null && key) {
      // A changed setting is a new URL. Until its answer arrives, the previous results stay up
      // as refreshing, which beats flashing an empty screen.
      const cached = loadCached<T>(key);
      if (cached) setState((current) => ({ ...current, data: cached.data, fetchedAt: cached.fetchedAt }));
    }

    const fetchNow = async () => {
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
        setAnswered(true);
        clearTimeout(settle);
        settle = setTimeout(() => setState((current) => ({ ...current, feed: 'live' })), Math.max(0, MIN_REFRESH_MS - (Date.now() - started)));
      } catch (error) {
        // Aborted for a newer request or for leaving the page: that one takes over.
        if ((error as Error).name === 'AbortError' && !timedOut) return;
        // A timeout or a network failure both mean the server could not be reached.
        const unreachable = timedOut || !navigator.onLine || error instanceof TypeError;
        setState((current) => ({ ...current, error: unreachable ? null : (error as Error).message, feed: unreachable ? 'offline' : 'live' }));
        setAnswered(true);
      } finally {
        clearTimeout(giveUp);
        setSettled(true);
      }
    };
    tick.current = () => void fetchNow();
    // Data the server put in the page is fresh, so the first fetch waits a full refresh from
    // when it arrived.
    if (seeded.current === null) void fetchNow();
    else plan(Math.max(0, intervalMs - (Date.now() - seeded.current)));
    seeded.current = null;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') {
        // Hidden, the page stops refreshing, so what it shows is old by the time it is back.
        setAnswered(false);
        return;
      }
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
// setting on. Only once `answered` (see Polled), so times from long ago cannot unpin a trip that is
// running late. `now` is milliseconds on the server's clock.
export function usePinnedTrip(pin: Pin | null, data: TripResponse | null, answered: boolean, dest: string | undefined, settings: DeviceSettings, now: number, change: (pin: Pin | null) => void) {
  const { pinned, fresh } = pin ? pinnedNow(pin, data, dest) : { pinned: null, fresh: false };
  const ends = pinned ? pinnedEnd(pinned) : null;
  const seen = fresh && pinned ? JSON.stringify(pinned) : null;
  useEffect(() => {
    if (!pin || !pinned || seen === null || seen === JSON.stringify(pin.last)) return;
    change({ ...pin, last: pinned, ...(ends !== null ? { ends } : {}) });
  }, [seen]);
  const end = ends ?? pin?.ends ?? null;
  const unpinAt = pin && settings.autoUnpin && end !== null ? (end + settings.unpinAfter * 60) * 1000 : null;
  const expired = answered && unpinAt !== null && now >= unpinAt;
  useEffect(() => {
    if (expired) change(null);
  }, [expired]);
  return { pinned, unpinAt, expired };
}
