// Everything the app remembers lives in this browser only. Storage can be missing or full
// (private windows, cleared site data), so every read falls back to defaults and every write
// may fail quietly. Values are plain objects so they could move to an account later.

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
};

export const DEFAULT_SETTINGS: DeviceSettings = { walkSpeed: 1.4, maxWalk: 300, min: null, max: null, hide: 0, theme: 'system' };

export function loadSettings(): DeviceSettings {
  return { ...DEFAULT_SETTINGS, ...read<Partial<DeviceSettings>>('settings', {}) };
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
};

export type SavedSearch = Search & { id: string; name: string };
export type RecentSearch = Search & { at: number; via?: string };

export const searchId = (search: Search) => `${search.from}>${search.to}`;

export function loadSaved(): SavedSearch[] {
  return read<SavedSearch[]>('saved', []);
}

export function saveSaved(saved: SavedSearch[]) {
  write('saved', saved);
}

export function saveSearch(search: Search, name: string) {
  const saved = loadSaved().filter((item) => item.id !== searchId(search));
  const entry = { ...search, id: searchId(search), name };
  saveSaved([...saved, entry]);
  return entry;
}

export function removeSaved(id: string) {
  saveSaved(loadSaved().filter((item) => item.id !== id));
}

export const findSaved = (search: Search) => loadSaved().find((item) => item.id === searchId(search)) ?? null;

// Keeps a saved search's settings in step with the trip screen, which owns them while open.
export function updateSaved(search: Search) {
  saveSaved(loadSaved().map((item) => (item.id === searchId(search) ? { ...search, id: item.id, name: item.name } : item)));
}

export function loadRecent(): RecentSearch[] {
  return read<RecentSearch[]>('recent', []);
}

export function rememberRecent(search: Search, via?: string) {
  const recent = loadRecent().filter((item) => searchId(item) !== searchId(search));
  write('recent', [{ ...search, at: Date.now(), ...(via ? { via } : {}) }, ...recent].slice(0, 8));
}

// The last response for each request, shown at once on return or while offline.
export function loadCached<T>(url: string) {
  return read<{ data: T; fetchedAt: number } | null>(`cache:${url}`, null);
}

export function saveCached(url: string, data: unknown) {
  write(`cache:${url}`, { data, fetchedAt: Date.now() });
}
