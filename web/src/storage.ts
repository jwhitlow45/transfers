// Everything the app remembers lives in this browser only. Storage can be missing or full
// (private windows, cleared site data), so every read falls back to defaults and every write
// may fail quietly. Values are plain objects so they could move to an account later.

import { MAX_MINUTES } from '../../shared/api.ts';

const PREFIX = 'transfers:';

function read<T>(key: string, fallback: T): T {
  try {
    const text = localStorage.getItem(PREFIX + key);
    return text === null ? fallback : (JSON.parse(text) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Full or blocked storage loses this value, nothing more.
  }
}

export type DeviceSettings = {
  // Meters per second.
  walkSpeed: number;
  // The longest walk between two street stops that counts as a transfer, in meters.
  maxWalk: number;
  // Default transfer window in minutes, or null to use each transfer's own estimate.
  min: number | null;
  max: number | null;
  hide: number;
  theme: 'system' | 'light' | 'dark';
  // How departure cards start out: all open, each group's soonest open, or all closed.
  cards: 'expanded' | 'first' | 'collapsed';
  // Whether route chips show their vehicle pictogram.
  modeIcons: boolean;
};

export const DEFAULT_SETTINGS: DeviceSettings = { walkSpeed: 1.4, maxWalk: 300, min: null, max: null, hide: 0, theme: 'system', cards: 'expanded', modeIcons: true };

// Minutes as the time settings allow them. Settings and searches saved before the 30 minute cap
// can hold more, which the server would quietly treat as 30 while the page said otherwise.
export const clampMinutes = (minutes: number) => Math.min(MAX_MINUTES, Math.max(0, Math.round(minutes)));

function clampTimes<T extends { min?: number | null; max?: number | null; hide?: number }>(item: T): T {
  const clamped = { ...item };
  if (typeof clamped.min === 'number') clamped.min = clampMinutes(clamped.min);
  if (typeof clamped.max === 'number') clamped.max = clampMinutes(clamped.max);
  if (typeof clamped.hide === 'number') clamped.hide = clampMinutes(clamped.hide);
  return clamped;
}

export function loadSettings(): DeviceSettings {
  return clampTimes({ ...DEFAULT_SETTINGS, ...read<Partial<DeviceSettings>>('settings', {}) });
}

export function saveSettings(settings: DeviceSettings) {
  write('settings', settings);
}

// A search as the rider set it up. Labels are kept so lists render without a request.
export type Search = {
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  min?: number;
  max?: number;
  hide?: number;
  dest?: string;
  destLabel?: string;
  firstRoutes?: string[];
  secondRoutes?: string[];
  // Transfer points the rider turned off, by pointId.
  off?: string[];
  // At a shared downtown station: ride from, or catch, only BART ("BA") or only Muni Metro ("SF").
  fromSystem?: 'BA' | 'SF';
  toSystem?: 'BA' | 'SF';
};

// color tells saved searches apart at a glance. Older saves lack one until their lines are known.
export type SavedSearch = Search & { id: string; name: string; color?: string };
export type RecentSearch = Search & { at: number; via?: string };

export const searchId = (search: Search) => `${search.from}>${search.to}`;

export function loadSaved(): SavedSearch[] {
  return read<SavedSearch[]>('saved', []).map(clampTimes);
}

export function saveSaved(saved: SavedSearch[]) {
  write('saved', saved);
}

export function saveSearch(search: Search, name: string, color?: string) {
  const saved = loadSaved().filter((item) => item.id !== searchId(search));
  const entry: SavedSearch = { ...search, id: searchId(search), name, ...(color ? { color } : {}) };
  saveSaved([...saved, entry]);
  return entry;
}

export function removeSaved(id: string) {
  saveSaved(loadSaved().filter((item) => item.id !== id));
}

export const findSaved = (search: Search) => loadSaved().find((item) => item.id === searchId(search)) ?? null;

// Keeps a saved search's settings in step with the trip screen, which owns them while open.
export function updateSaved(search: Search) {
  saveSaved(loadSaved().map((item) => (item.id === searchId(search) ? { ...search, id: item.id, name: item.name, ...(item.color ? { color: item.color } : {}) } : item)));
}

// What the search screen's fields held when the rider left it, so coming back restores them.
export function loadFields<T>() {
  try {
    const text = sessionStorage.getItem(`${PREFIX}fields`);
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

export function saveFields(fields: unknown) {
  try {
    sessionStorage.setItem(`${PREFIX}fields`, JSON.stringify(fields));
  } catch {
    // Without session storage the fields start empty, nothing more.
  }
}

export function loadRecent(): RecentSearch[] {
  return read<RecentSearch[]>('recent', []);
}

export function removeRecent(id: string) {
  write('recent', loadRecent().filter((item) => searchId(item) !== id));
}

export function rememberRecent(search: Search, via?: string) {
  const recent = loadRecent().filter((item) => searchId(item) !== searchId(search));
  write('recent', [{ ...search, at: Date.now(), ...(via ? { via } : {}) }, ...recent].slice(0, 8));
}

// The last response for each request, shown at once on return or while offline.
export function loadCached<T>(url: string) {
  return read<{ data: T; fetchedAt: number } | null>(`cache:${url}`, null);
}

export function saveCached(url: string, data: unknown, fetchedAt = Date.now()) {
  write(`cache:${url}`, { data, fetchedAt });
}
