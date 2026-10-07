import { useEffect, useState } from 'preact/hooks';
import { clearCached } from './storage.ts';

// A page left open, or kept by the service worker, can be older than the site. The build writes
// its id into the page (see vite.config.ts), and the server sends the id of the page it ships with
// every answer, so the page learns of a new version from requests it makes anyway.

// A deploy restarts the page and the API a few seconds apart, so a differing id counts only once
// it has held this long. A page loaded in between is not told to refresh into the same mismatch.
const SETTLE_MS = 15_000;

export function buildWatch(own: string | null, clock: () => number = Date.now) {
  // The newer id seen and since when. Another id, as from a second deploy, waits afresh.
  let candidate: { build: string; since: number } | null = null;
  let available = false;
  const listeners = new Set<() => void>();
  const set = (next: boolean) => {
    if (next === available) return;
    available = next;
    for (const listener of listeners) listener();
  };
  return {
    // With each answer's X-Build header. An answer without one, as from a server with no built
    // page, says nothing either way.
    notice(build: string | null) {
      if (!own || !build) return;
      // Back on this page's build, as after a rollback, there is nothing newer to load.
      if (build === own) {
        candidate = null;
        set(false);
        return;
      }
      if (candidate?.build !== build) candidate = { build, since: clock() };
      if (clock() - candidate.since >= SETTLE_MS) set(true);
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
  useEffect(() => watch.subscribe(() => setAvailable(watch.available)), []);
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
