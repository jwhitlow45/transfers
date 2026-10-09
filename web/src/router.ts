import { useEffect, useState } from 'preact/hooks';
import { type Search, clampMinutes, isStopSearch, readStored, stopSearch, writeStored } from './storage.ts';

export type Page =
  | { name: 'home' }
  | { name: 'trip'; search: Search }
  // A stop's arrivals, its search with no To (see stopSearch).
  | { name: 'stop'; search: Search }
  | { name: 'nearby' }
  | { name: 'settings' }
  | { name: 'notices' };

// Trip links carry the whole search, so a saved link or home screen shortcut opens it directly:
// /t/BA:901209/SF:13477?min=3&max=12
// A stop's arrivals: /stop/SF:13477?fl=24th+St+%26+Mission+St+(13477)
export const stopPath = (search: Pick<Search, 'from' | 'fromLabel'>) => `/stop/${encodeURIComponent(search.from)}?${new URLSearchParams({ fl: search.fromLabel })}`;

// A trip's own address, or a stop's for a search with no To.
export const searchPath = (search: Search) => (isStopSearch(search) ? stopPath(search) : tripPath(search));

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
  const stop = location.pathname.match(/^\/stop\/([^/]+)$/);
  if (stop) {
    const key = decodeURIComponent(stop[1]!);
    return { name: 'stop', search: stopSearch(key, new URLSearchParams(location.search).get('fl') ?? key) };
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
type Entry = { depth?: number; key?: string; sheet?: true; under?: string; back?: string; sheetName?: string } & Record<string, unknown>;
const entry = () => (history.state ?? {}) as Entry;
const depth = () => entry().depth ?? 0;
let keys = 0;
// Unique across reloads of the tab, whose history outlives the page.
const newKey = () => `${Date.now().toString(36)}-${++keys}`;

// Addresses the pages under an open sheet took on while it was open, such as from Trip settings,
// by the page entry's key, put back when the rider returns to it. Kept for the tab's session where
// it can be, so a reload with the sheet open loses none. Keys are never reused, so one left behind,
// as when the rider jumps back past that page, can never touch another. Without storage, they last
// as long as the page.
let moved = readStored<Record<string, string>>('moved', {}, 'session');
const setMoved = (all: Record<string, string>) => {
  // The latest few are all a tab needs.
  moved = Object.fromEntries(Object.entries(all).slice(-20));
  writeStored('moved', moved, 'session');
};
// How the rider left a page for another, by the page entry's key: how far it was scrolled, and the
// sheet open over it, such as Trip settings when its Settings link was followed, so that coming
// back finds the page as it was (J, 2026-10-08). Kept for the tab's session where it can be.
export type Left = { scroll: number; sheet?: string; sheetScroll?: number };
let left = readStored<Record<string, Left>>('left', {}, 'session');
const setLeft = (all: Record<string, Left>) => {
  left = Object.fromEntries(Object.entries(all).slice(-20));
  writeStored('left', left, 'session');
};
const remember = (current: Entry) => {
  const key = current.sheet ? current.under : current.key;
  const scroller = typeof document === 'undefined' ? null : document.querySelector('.tf-app > .tf-layer > .tf-scroll');
  if (!key || !scroller) return;
  const sheetBody = current.sheet ? document.querySelector('.tf-layer .tf-sheet__body') : null;
  const sheet = current.sheet && current.sheetName ? { sheet: current.sheetName, sheetScroll: sheetBody?.scrollTop ?? 0 } : {};
  setLeft({ ...left, [key]: { scroll: scroller.scrollTop, ...sheet } });
};
// How the page now showing was left, if the rider is back on it.
export const cameBackTo = (): Left | undefined => left[entry().key ?? ''];
export const forgetLeft = () => {
  const { [entry().key ?? '']: _done, ...others } = left;
  setLeft(others);
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
    // was under the sheet, whose address the sheet's entry has.
    if (current.sheet) remember(current);
    const back = current.sheet ? location.pathname : current.back;
    history.replaceState({ ...options.state, depth: depth(), key: newKey(), ...(back ? { back } : {}) }, '', path);
  } else {
    remember(current);
    history.pushState({ ...options.state, depth: depth() + 1, key: newKey(), back: location.pathname }, '', path);
  }
  dispatchEvent(new PopStateEvent('popstate'));
}

// Another page in place of this one, at the same depth, so the app stays one page deep from Home
// (J, 2026-10-08). From a sheet, the sheet closes on its own step back, and the page under it
// takes the address as it lands, as a change made inside a sheet does.
export function replacePage(path: string) {
  const current = entry();
  if (!current.sheet || !current.under) return navigate(path, { replace: true });
  setMoved({ ...moved, [current.under]: path });
  history.back();
}

// Back, as the system back does, when the entry before is the app's. Otherwise, as on a page
// opened from a link, `fallback` in this page's place.
export function goBack(fallback = '/') {
  if (depth() > 0) history.back();
  else navigate(fallback, { replace: true });
}

// The key of the entry showing, and for a sheet's entry, of the page under it.
export const currentKey = () => entry().key;
export const currentUnder = () => entry().under;

// How many of the app's entries lie behind the page showing, which grows by one with each step
// forward. A sheet's entry is a step over its page, so it counts as its page, and a change made from
// a sheet, such as a route filter, is the same page rather than a new one.
export const currentDepth = () => (entry().sheet ? depth() - 1 : depth());

// Whether back lands on Home: the page before is Home's, or there is none of the app's, and back
// falls back to Home. An entry from before the app kept `back` says nothing either way.
export const backGoesHome = () => (depth() > 0 ? entry().back === '/' : true);

// An entry for a sheet opening over the page, with the page's address, and the sheet's name, for
// the page to open it again on coming back (see Left). Returns its key.
export function openSheetEntry(name?: string) {
  // A page entry from before keys were kept, in a tab open since, gets one now.
  if (!entry().key) history.replaceState({ ...entry(), key: newKey() }, '');
  const page = entry();
  const key = newKey();
  history.pushState({ ...page, depth: depth() + 1, key, sheet: true, under: page.key, ...(name ? { sheetName: name } : {}) }, '');
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
