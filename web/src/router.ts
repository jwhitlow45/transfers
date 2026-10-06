import { useEffect, useState } from 'preact/hooks';
import { type Search, clampMinutes } from './storage.ts';

export type Page =
  | { name: 'home' }
  | { name: 'trip'; search: Search }
  | { name: 'nearby' }
  | { name: 'settings' }
  | { name: 'notices' };

// Trip links carry the whole search, so a saved link or home screen shortcut opens it directly:
// /t/BA:901209/SF:13477?min=3&max=12
export function tripPath(search: Search) {
  const params = new URLSearchParams();
  params.set('fl', search.fromLabel);
  params.set('tl', search.toLabel);
  if (search.min !== undefined) params.set('min', String(search.min));
  if (search.max !== undefined) params.set('max', String(search.max));
  if (search.hide !== undefined) params.set('hide', String(search.hide));
  if (search.dest) params.set('dest', search.dest);
  if (search.destLabel) params.set('dl', search.destLabel);
  if (search.firstRoutes?.length) params.set('r1', search.firstRoutes.join(','));
  if (search.secondRoutes?.length) params.set('r2', search.secondRoutes.join(','));
  if (search.off?.length) params.set('off', search.off.join(','));
  if (search.fromSystem) params.set('fm', search.fromSystem);
  if (search.toSystem) params.set('tm', search.toSystem);
  return `/t/${encodeURIComponent(search.from)}/${encodeURIComponent(search.to)}?${params}`;
}

export function parsePage(location: Location): Page {
  const trip = location.pathname.match(/^\/t\/([^/]+)\/([^/]+)$/);
  if (trip) {
    const params = new URLSearchParams(location.search);
    const number = (name: string) => {
      const value = params.get(name);
      return value === null || value === '' || Number.isNaN(Number(value)) ? undefined : Number(value);
    };
    const search: Search = {
      from: decodeURIComponent(trip[1]!),
      to: decodeURIComponent(trip[2]!),
      fromLabel: params.get('fl') ?? decodeURIComponent(trip[1]!),
      toLabel: params.get('tl') ?? decodeURIComponent(trip[2]!),
    };
    const min = number('min');
    const max = number('max');
    const hide = number('hide');
    if (min !== undefined) search.min = clampMinutes(min);
    if (max !== undefined) search.max = clampMinutes(max);
    if (hide !== undefined) search.hide = clampMinutes(hide);
    const dest = params.get('dest');
    if (dest) {
      search.dest = dest;
      search.destLabel = params.get('dl') ?? dest;
    }
    const first = params.get('r1');
    const second = params.get('r2');
    if (first) search.firstRoutes = first.split(',');
    if (second) search.secondRoutes = second.split(',');
    const off = params.get('off');
    if (off) search.off = off.split(',');
    const system = (value: string | null) => (value === 'BA' || value === 'SF' ? value : undefined);
    const fromSystem = system(params.get('fm'));
    const toSystem = system(params.get('tm'));
    if (fromSystem) search.fromSystem = fromSystem;
    if (toSystem) search.toSystem = toSystem;
    return { name: 'trip', search };
  }
  if (location.pathname === '/nearby') return { name: 'nearby' };
  if (location.pathname === '/settings') return { name: 'settings' };
  if (location.pathname === '/notices') return { name: 'notices' };
  return { name: 'home' };
}

// Each history entry the app makes counts how many of its own entries lie behind it, so back
// can tell whether the one before is the app's, and has a key of its own. An open sheet is an
// entry of its own too, so the system back closes it rather than leaving the page under it, and
// it knows the key of that page's entry (`under`). `state` rides along, as Nearby hands a picked
// stop to Home.
type Entry = { depth?: number; key?: string; sheet?: true; under?: string } & Record<string, unknown>;
const entry = () => (history.state ?? {}) as Entry;
const depth = () => entry().depth ?? 0;
let keys = 0;
// Unique across reloads of the tab, whose history outlives the page.
const newKey = () => `${Date.now().toString(36)}-${++keys}`;

// Addresses the pages under an open sheet took on while it was open, such as from Trip settings,
// by the page entry's key, put back when the rider returns to it. Kept for the tab's session where
// it can be, so a reload with the sheet open loses none. Keys are never reused, so one left behind,
// as when the rider jumps back past that page, can never touch another.
const MOVED = 'transfers:moved';
let moved: Record<string, string> = {};
try {
  moved = JSON.parse(sessionStorage.getItem(MOVED) ?? '{}') as Record<string, string>;
} catch {
  // Without storage, they last as long as the page.
}
const setMoved = (all: Record<string, string>) => {
  // The latest few are all a tab needs.
  moved = Object.fromEntries(Object.entries(all).slice(-20));
  try {
    sessionStorage.setItem(MOVED, JSON.stringify(moved));
  } catch {
    // Without storage, they last as long as the page.
  }
};
// The entries of the sheets open now, by key. Any other sheet's entry, which a reload with a sheet
// open or the browser's Forward button lands on, has no sheet left to close, so it steps back to
// the page under it.
const openSheets = new Set<string>();
addEventListener('popstate', () => {
  const { key = '', sheet } = entry();
  if (sheet) {
    if (!openSheets.has(key)) history.back();
    return;
  }
  const { [key]: path, ...others } = moved;
  if (path === undefined) return;
  setMoved(others);
  history.replaceState(history.state, '', path);
});
// The entry the page opened on gets a key, for a sheet over it to name.
if (!entry().key) history.replaceState({ ...entry(), key: newKey() }, '');
if (entry().sheet) history.back();

export function navigate(path: string, options: { replace?: boolean; state?: Record<string, unknown> } = {}) {
  const current = entry();
  if (current.sheet && options.replace) {
    // Changed from inside a sheet: the sheet keeps its entry, and the page under it takes the
    // new address once the sheet closes.
    history.replaceState(current, '', path);
    if (current.under) setMoved({ ...moved, [current.under]: path });
  } else if (current.sheet || options.replace) {
    // A page left from inside a sheet takes the sheet's entry, so back returns to the page that
    // was under the sheet.
    history.replaceState({ ...options.state, depth: depth(), key: newKey() }, '', path);
  } else {
    history.pushState({ ...options.state, depth: depth() + 1, key: newKey() }, '', path);
  }
  dispatchEvent(new PopStateEvent('popstate'));
}

// Back, as the system back does, when the entry before is the app's. Otherwise, as on a page
// opened from a link, `fallback` in this page's place.
export function goBack(fallback = '/') {
  if (depth() > 0) history.back();
  else navigate(fallback, { replace: true });
}

// An entry for a sheet opening over the page, with the page's address. Returns its key.
export function openSheetEntry() {
  // A page entry from before keys were kept, in a tab open since, gets one now.
  if (!entry().key) history.replaceState({ ...entry(), key: newKey() }, '');
  const page = entry();
  const key = newKey();
  history.pushState({ ...page, depth: depth() + 1, key, sheet: true, under: page.key }, '');
  openSheets.add(key);
  return key;
}

// The sheet with this entry has closed.
export const closeSheetEntry = (key: string) => openSheets.delete(key);

// Whether the entry is a sheet's still open, by its key.
export const isSheetEntry = (key: string) => entry().sheet === true && entry().key === key;

export function usePage() {
  const [page, setPage] = useState(() => parsePage(location));
  useEffect(() => {
    const update = () => setPage(parsePage(location));
    addEventListener('popstate', update);
    return () => removeEventListener('popstate', update);
  }, []);
  return page;
}
