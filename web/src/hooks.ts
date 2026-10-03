import { useEffect, useRef, useState } from 'preact/hooks';
import { getJson } from './api.ts';
import { loadCached } from './storage.ts';

// The current time, ticking every few seconds so countdowns move without re-rendering every frame.
export function useNow(intervalMs = 5000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export type Polled<T> = {
  data: T | null;
  error: string | null;
  // When the shown data was fetched, in milliseconds.
  fetchedAt: number | null;
  offline: boolean;
  loading: boolean;
  refresh: () => void;
};

// Fetches `url` now and every `intervalMs` while the page is visible. Shows the last response
// for the same URL at once (from this session or storage), so returning or going offline
// never blanks the screen.
export function usePoll<T>(url: string | null, intervalMs = 30_000, initial: T | null = null): Polled<T> {
  const cached = url ? loadCached<T>(url) : null;
  const [state, setState] = useState<Omit<Polled<T>, 'refresh'>>(() => ({
    data: initial ?? cached?.data ?? null,
    error: null,
    fetchedAt: initial ? Date.now() : (cached?.fetchedAt ?? null),
    offline: false,
    loading: !initial,
  }));
  const tick = useRef<() => void>(() => {});

  useEffect(() => {
    if (!url) return;
    let controller: AbortController | null = null;
    const stored = loadCached<T>(url);
    if (!initial) setState((current) => ({ ...current, data: stored?.data ?? null, fetchedAt: stored?.fetchedAt ?? null, loading: true }));

    const fetchNow = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const data = await getJson<T>(url, { signal: controller.signal, remember: true });
        setState({ data, error: null, fetchedAt: Date.now(), offline: false, loading: false });
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        const offline = !navigator.onLine || error instanceof TypeError;
        setState((current) => ({ ...current, error: offline ? null : (error as Error).message, offline, loading: false }));
      }
    };
    tick.current = () => void fetchNow();
    if (!initial) void fetchNow();

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void fetchNow();
    }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void fetchNow();
    };
    document.addEventListener('visibilitychange', onVisible);
    addEventListener('online', onVisible);
    return () => {
      controller?.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      removeEventListener('online', onVisible);
    };
    // `initial` only seeds the first render, so it is left out of the dependencies.
  }, [url, intervalMs]);

  return { ...state, refresh: () => tick.current() };
}
