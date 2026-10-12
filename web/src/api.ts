import type { PinRequest } from '../../shared/api.ts';
import { writePin } from '../../shared/params.ts';
import type { Position } from './lib/location.ts';
import { DEFAULT_SETTINGS, type DeviceSettings, type Pin, type Search, saveCached } from './storage.ts';
import { noticeBuild } from './update.ts';

// The server tags each response, and a refresh that lands before the server's next feed
// refresh comes back as an empty 304.
const etags = new Map<string, { etag: string; data: unknown }>();

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// `cacheAs` keeps the answer in storage under that key, for the next visit and offline.
export async function getJson<T>(url: string, options: { signal?: AbortSignal; cacheAs?: string } = {}): Promise<T> {
  const known = etags.get(url);
  const response = await fetch(url, {
    ...(options.signal ? { signal: options.signal } : {}),
    // Tells the server this page takes the time from the header, so unchanged data can match.
    headers: { 'X-Reads-Generated-At': '1', ...(known ? { 'If-None-Match': known.etag } : {}) },
  });
  noticeBuild(response.headers.get('X-Build'));
  // When the server sent this, for working out how far this device's clock is off. The body's
  // own time is old whenever the data is: on a 304, and on a 200 the browser rebuilt from its
  // cache after checking with the server. Behind a proxy that drops the header, the standard
  // Date header, in whole seconds like the body's, stands in.
  const generatedAt = Number(response.headers.get('X-Generated-At')) || Math.floor(Date.parse(response.headers.get('Date') ?? '') / 1000) || 0;
  const stamped = (data: T) => (generatedAt && typeof data === 'object' && data !== null && 'generatedAt' in data ? ({ ...data, generatedAt } as T) : data);
  if (response.status === 304 && known) return stamped(known.data as T);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new HttpError(response.status, body?.error ?? `The server answered ${response.status}`);
  }
  const data = stamped((await response.json()) as T);
  const etag = response.headers.get('ETag');
  if (etag) etags.set(url, { etag, data });
  if (options.cacheAs) saveCached(options.cacheAs, data);
  return data;
}

// Data the server put inside the page for a saved trip link, used once on startup.
export function takeInitialData<T>(): T | null {
  const element = document.getElementById('initial');
  if (!element?.textContent) return null;
  element.remove();
  try {
    return JSON.parse(element.textContent) as T;
  } catch {
    return null;
  }
}

// The params of `url` named in `names`, for asking another endpoint with only what decides it.
const only = (url: string, names: string[]) => new URLSearchParams([...new URLSearchParams(url.split('?')[1])].filter(([name]) => names.includes(name)));

// Where each of the server's answers is asked for, so every page asks for one alike, and shares the
// stored answer of the same question.
export const apiUrl = {
  // A search's transfers: its own settings first, then the device's.
  trip(search: Search, settings: DeviceSettings, showHidden: boolean, pin: Pin | null = null) {
    const params = new URLSearchParams({ from: search.from, to: search.to });
    const min = search.min ?? settings.min;
    const max = search.max ?? settings.max;
    const hide = search.hide ?? settings.hide;
    if (min !== null && min !== undefined) params.set('min', String(min));
    if (max !== null && max !== undefined) params.set('max', String(max));
    if (hide) params.set('hide', String(hide));
    if (settings.maxWalk !== DEFAULT_SETTINGS.maxWalk) params.set('walk', String(settings.maxWalk));
    if (settings.walkSpeed !== DEFAULT_SETTINGS.walkSpeed) params.set('speed', String(settings.walkSpeed));
    if (search.dest) params.set('dest', search.dest);
    if (search.firstRoutes?.length) params.set('r1', search.firstRoutes.join(','));
    if (search.secondRoutes?.length) params.set('r2', search.secondRoutes.join(','));
    if (search.fromSystem) params.set('fm', search.fromSystem);
    if (search.toSystem) params.set('tm', search.toSystem);
    if (showHidden) params.set('hidden', '1');
    if (settings.stepFree) params.set('stepfree', '1');
    if (settings.escalatorOutages) params.set('escalators', '1');
    if (pin) writePin(params, pin);
    return `/api/trip?${params}`;
  },
  // The destinations a trip can have, which depend only on its ends and the rider's walk, so
  // changing what results show asks nothing again.
  destinations: (tripUrl: string) => `/api/destinations?${only(tripUrl, ['from', 'to', 'walk', 'speed', 'fm', 'tm'])}`,
  // The way back by the transfer point `point`, asked with only what decides it, so moving a
  // slider in the sheet asks nothing again.
  wayBack(tripUrl: string, point: { alight: string; board: string } | undefined) {
    const params = only(tripUrl, ['from', 'to', 'dest', 'walk', 'speed', 'fm', 'tm', 'r1', 'r2']);
    if (point) {
      params.set('wa', point.alight);
      params.set('wb', point.board);
    }
    return `/api/way-back?${params}`;
  },
  // A stop's arrivals, which its page, its saved card, and a pinned arrival all ask for, the pin's
  // vehicle with them when one is pinned there.
  stop(stop: string, pin: PinRequest | null = null) {
    const params = new URLSearchParams({ stop });
    if (pin) writePin(params, pin);
    return `/api/stop?${params}`;
  },
  // Rounded to about 10 m, so small GPS jitter reuses the same request.
  nearby: ({ lat, lon }: Position) => `/api/nearby?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`,
  // Stops, and routes too for To, by name or number, nearest first when the rider shared where they are.
  search: (query: string, routes: boolean, near: Position | null) =>
    `/api/search?${new URLSearchParams({ q: query, kind: routes ? 'any' : 'stop', ...(near ? { lat: near.lat.toFixed(4), lon: near.lon.toFixed(4) } : {}) })}`,
  // Trips between two ends as the API names them (see shared/journeys.ts), the points by the names
  // the rider saw, walking at the rider's own speed.
  journeys: (from: string, to: string, fromLabel: string, toLabel: string, settings: Pick<DeviceSettings, 'walkSpeed'>) =>
    `/api/journeys?${new URLSearchParams({ from, to, fl: fromLabel, tl: toLabel, ...(settings.walkSpeed !== DEFAULT_SETTINGS.walkSpeed ? { speed: String(settings.walkSpeed) } : {}) })}`,
};
