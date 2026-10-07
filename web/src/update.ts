import { useEffect, useState } from 'preact/hooks';
import { clearCached } from './storage.ts';

// A page left open, or kept by the service worker, can be older than the site. The build writes
// its id into the page (see vite.config.ts), and the server sends the id of the page it ships with
// every answer, so the page learns of a new version from requests it makes anyway.

// A deploy restarts the page and the API a few seconds apart, so a differing id counts only once
// it has held this long. A page loaded in between is not told to refresh into the same mismatch.
const SETTLE_MS = 15_000;

export function buildWatch(own: string | null, clock: () => number = Date.now) {
  let differingSince: number | null = null;
  let available = false;
  const listeners = new Set<() => void>();
  return {
    // With each answer's X-Build header.
    notice(build: string | null) {
      if (!own || !build || build === own) {
        differingSince = null;
        return;
      }
      differingSince ??= clock();
      if (available || clock() - differingSince < SETTLE_MS) return;
      available = true;
      for (const listener of listeners) listener();
    },
    get available() {
      return available;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

// This page's build id. The development server's page has none, so it is never told to refresh.
export const ownBuild = typeof document === 'undefined' ? null : (document.querySelector<HTMLMetaElement>('meta[name="build"]')?.content ?? null);
const watch = buildWatch(ownBuild);

export const noticeBuild = (build: string | null) => watch.notice(build);

export function useUpdateAvailable() {
  const [available, setAvailable] = useState(watch.available);
  useEffect(() => watch.subscribe(() => setAvailable(true)), []);
  return available;
}

// Drops the service worker and its copy of the site, and the stored responses, then reloads, so
// the page and its data come fresh from the server. Settings' Force refresh and the prompt for a
// new version both take this way, as the service worker would otherwise answer the reload with
// the copy it already has.
export async function forceRefresh() {
  try {
    const registrations = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(registrations.map((registration) => registration.unregister()));
    if ('caches' in window) await Promise.all((await caches.keys()).map((name) => caches.delete(name)));
  } catch {
    // A browser that refuses still reloads below, which fetches what it can.
  }
  clearCached();
  location.reload();
}
