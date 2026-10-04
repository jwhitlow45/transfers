import { useEffect, useRef, useState } from 'preact/hooks';
import { getJson } from './api.ts';
import { loadCached } from './storage.ts';

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
  // When the shown data was fetched, in milliseconds.
  fetchedAt: number | null;
  feed: FeedState;
  refresh: () => void;
};

// A quick refresh would flash the header's bar for a frame, so it stays up at least this long.
const MIN_REFRESH_MS = 800;

// Fetches `url` now and every `intervalMs` while the page is visible. Shows the last response
// for the same URL at once (from this session or storage), so returning or going offline
// never blanks the screen.
export function usePoll<T>(url: string | null, intervalMs = 30_000, initial: T | null = null): Polled<T> {
  const [state, setState] = useState<Omit<Polled<T>, 'refresh'>>(() => {
    const cached = url ? loadCached<T>(url) : null;
    const data = initial ?? cached?.data ?? null;
    return { data, error: null, fetchedAt: initial ? Date.now() : (cached?.fetchedAt ?? null), feed: initial ? 'live' : data ? 'refreshing' : 'loading' };
  });
  const tick = useRef<() => void>(() => {});
  const seeded = useRef(Boolean(initial));

  useEffect(() => {
    if (!url) return;
    let controller: AbortController | null = null;
    let settle: ReturnType<typeof setTimeout> | undefined;
    if (!seeded.current) {
      // A changed setting is a new URL. Until its answer arrives, the previous results stay up
      // as refreshing, which beats flashing an empty screen.
      const cached = loadCached<T>(url);
      if (cached) setState((current) => ({ ...current, data: cached.data, fetchedAt: cached.fetchedAt }));
    }

    const fetchNow = async () => {
      controller?.abort();
      controller = new AbortController();
      const started = Date.now();
      setState((current) => ({ ...current, feed: current.data ? 'refreshing' : 'loading' }));
      try {
        const data = await getJson<T>(url, { signal: controller.signal, remember: true });
        const wait = Math.max(0, MIN_REFRESH_MS - (Date.now() - started));
        clearTimeout(settle);
        settle = setTimeout(() => setState({ data, error: null, fetchedAt: Date.now(), feed: 'live' }), wait);
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        const offline = !navigator.onLine || error instanceof TypeError;
        setState((current) => ({ ...current, error: offline ? null : (error as Error).message, feed: offline ? 'offline' : 'live' }));
      }
    };
    tick.current = () => void fetchNow();
    // Data the server put in the page is fresh, so the first fetch waits for the first refresh.
    if (!seeded.current) void fetchNow();
    seeded.current = false;

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void fetchNow();
    }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void fetchNow();
    };
    const onOffline = () => setState((current) => ({ ...current, feed: 'offline' }));
    document.addEventListener('visibilitychange', onVisible);
    addEventListener('online', onVisible);
    addEventListener('offline', onOffline);
    return () => {
      controller?.abort();
      clearTimeout(settle);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      removeEventListener('online', onVisible);
      removeEventListener('offline', onOffline);
    };
  }, [url, intervalMs]);

  return { ...state, refresh: () => tick.current() };
}
