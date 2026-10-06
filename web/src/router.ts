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
// can tell whether the one before is the app's, and an open sheet is an entry of its own, so the
// system back closes it rather than leaving the page under it. `state` rides along, as Nearby
// hands a picked stop to Home.
type Entry = { depth?: number; sheet?: number } & Record<string, unknown>;
const entry = () => (history.state ?? {}) as Entry;
const depth = () => entry().depth ?? 0;

// Addresses the pages under an open sheet took on while it was open, such as from Trip settings,
// by depth, put back when the rider returns to them.
const moved = new Map<number, string>();
addEventListener('popstate', () => {
  const path = moved.get(depth());
  if (path === undefined || entry().sheet !== undefined) return;
  moved.delete(depth());
  history.replaceState(history.state, '', path);
});

export function navigate(path: string, options: { replace?: boolean; state?: Record<string, unknown> } = {}) {
  const current = entry();
  if (current.sheet !== undefined && options.replace) {
    // Changed from inside a sheet: the sheet keeps its entry, and the page under it takes the
    // new address once the sheet closes.
    history.replaceState(current, '', path);
    moved.set(depth() - 1, path);
  } else if (current.sheet !== undefined || options.replace) {
    // A page left from inside a sheet takes the sheet's entry, so back returns to the page that
    // was under the sheet.
    history.replaceState({ ...options.state, depth: depth() }, '', path);
  } else {
    history.pushState({ ...options.state, depth: depth() + 1 }, '', path);
  }
  dispatchEvent(new PopStateEvent('popstate'));
}

// Back, as the system back does, when the entry before is the app's. Otherwise, as on a page
// opened from a link, `fallback` in this page's place.
export function goBack(fallback = '/') {
  if (depth() > 0) history.back();
  else navigate(fallback, { replace: true });
}

let sheets = 0;

// An entry for a sheet opening over the page, with the page's address. Returns its id.
export function openSheetEntry() {
  const id = ++sheets;
  history.pushState({ ...entry(), depth: depth() + 1, sheet: id }, '');
  return id;
}

// Whether the entry is a sheet's still open, by its id.
export const isSheetEntry = (id: number) => entry().sheet === id;

export function usePage() {
  const [page, setPage] = useState(() => parsePage(location));
  useEffect(() => {
    const update = () => setPage(parsePage(location));
    addEventListener('popstate', update);
    return () => removeEventListener('popstate', update);
  }, []);
  return page;
}
