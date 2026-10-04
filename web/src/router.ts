import { useEffect, useState } from 'preact/hooks';
import type { Search } from './storage.ts';

export type Page =
  | { name: 'home' }
  | { name: 'trip'; search: Search }
  | { name: 'nearby' }
  | { name: 'settings' };

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
    if (min !== undefined) search.min = min;
    if (max !== undefined) search.max = max;
    if (hide !== undefined) search.hide = hide;
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
  return { name: 'home' };
}

export function navigate(path: string, options: { replace?: boolean } = {}) {
  if (options.replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}

export function usePage() {
  const [page, setPage] = useState(() => parsePage(location));
  useEffect(() => {
    const update = () => setPage(parsePage(location));
    addEventListener('popstate', update);
    return () => removeEventListener('popstate', update);
  }, []);
  return page;
}
