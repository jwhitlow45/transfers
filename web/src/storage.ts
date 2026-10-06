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
  // Animations: as the device's reduce motion setting says, always, or never.
  motion: 'system' | 'on' | 'off';
  // Whether results show the connections they hide, marked with why. A viewing choice kept for
  // every trip, so it holds across page loads.
  showHidden: boolean;
  // Whether a live map zooms in once the vehicle leaves the rider's stop.
  mapFitOnBoard: boolean;
  // A rider who needs elevators: their outages at the trip's stations first, and more time to
  // change at stations.
  stepFree: boolean;
  // A rider who relies on escalators: their outages at the trip's stations too.
  escalatorOutages: boolean;
  // Whether a pinned trip unpins itself, and how many minutes after it ends.
  autoUnpin: boolean;
  unpinAfter: number;
};

export const DEFAULT_SETTINGS: DeviceSettings = {
  walkSpeed: 1.4,
  maxWalk: 300,
  min: null,
  max: null,
  hide: 0,
  theme: 'system',
  cards: 'expanded',
  modeIcons: true,
  motion: 'system',
  showHidden: false,
  mapFitOnBoard: true,
  stepFree: false,
  escalatorOutages: false,
  autoUnpin: true,
  unpinAfter: 30,
};

// The longest a pinned trip can stay after it ends before unpinning itself.
export const MAX_UNPIN_MINUTES = 120;

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
// renamed: the rider gave it a name of their own. Saved before this was kept, it is unknown.
export type SavedSearch = Search & { id: string; name: string; color?: string; renamed?: boolean };
export type RecentSearch = Search & { at: number; via?: string };

export const searchId = (search: Search) => `${search.from}>${search.to}`;

// A trip pinned to a search's results, kept until the rider unpins it or, with that setting on,
// a while after it ends. The vehicle to transfer to and where it is boarded, with the first
// vehicle and where it is left unless the route is already at From. Kept by From and To only, so
// it stays through other changes to the search, and follows a new destination. `at` is when the
// second vehicle was due where it is boarded when pinned, which tells the server which day's run
// is meant. `ends` is when the trip ends by the latest times seen: arriving at the destination,
// or with none set, boarding the second vehicle.
// `search` is the search it is pinned to as it stands now, so Home can show the pin and open its
// results. Pins saved before it was kept lack it.
export type Pin = { first?: { trip: string; alight: string }; second: { trip: string; board: string }; at: number; ends: number; search?: Search };

export function loadPin(search: Search): Pin | null {
  return read<Record<string, Pin>>('pins', {})[searchId(search)] ?? null;
}

// Every pin Home can show, with its search.
export function loadPins(): (Pin & { search: Search })[] {
  return Object.values(read<Record<string, Pin>>('pins', {})).filter((pin): pin is Pin & { search: Search } => pin.search !== undefined);
}

export function savePin(search: Search, pin: Pin | null) {
  const { [searchId(search)]: _old, ...others } = read<Record<string, Pin>>('pins', {});
  write('pins', pin ? { ...others, [searchId(search)]: pin } : others);
}

// A notice the rider dismissed, kept as it read then, so the Notices page can show it and put it
// back. Notices are dismissed by id, so one is gone from every search that would show it.
export type DismissedNotice = {
  id: string;
  kicker: string;
  title: string;
  body: string | null;
  meta: string;
  url?: string | null;
  // How it showed, for the note that says it was dismissed or restored. Absent on older saves.
  severity?: 'severe' | 'warning' | 'info';
  outage?: 'elevator' | 'escalator';
  at: number;
  until: number | null;
};

// A dismissed notice is forgotten once the agency says it has ended, or after this long, so the
// list does not grow without end.
const DISMISSED_DAYS = 60;

export function loadDismissed(): DismissedNotice[] {
  const now = Date.now() / 1000;
  return read<DismissedNotice[]>('dismissed', []).filter(({ at, until }) => (until === null || until > now) && now - at < DISMISSED_DAYS * 86_400);
}

export function dismissNotice(notice: Omit<DismissedNotice, 'at'>) {
  write('dismissed', [{ ...notice, at: Math.floor(Date.now() / 1000) }, ...loadDismissed().filter(({ id }) => id !== notice.id)]);
}

export function restoreNotice(id: string) {
  write('dismissed', loadDismissed().filter((notice) => notice.id !== id));
}

export function restoreAllNotices() {
  write('dismissed', []);
}

// Results tell a rider that tapping a connection pins it on their first few visits, until they
// first pin one. Each call counts a visit and says whether to show the hint on it.
const PIN_HINT_VISITS = 3;

export function takePinHint() {
  const left = read<number>('pinHint', PIN_HINT_VISITS);
  if (left <= 0) return false;
  write('pinHint', left - 1);
  return true;
}

export function clearPinHint() {
  write('pinHint', 0);
}

export function loadSaved(): SavedSearch[] {
  return read<SavedSearch[]>('saved', []).map(clampTimes);
}

export function saveSaved(saved: SavedSearch[]) {
  write('saved', saved);
}

export function saveSearch(search: Search, name: string, color?: string) {
  const saved = loadSaved().filter((item) => item.id !== searchId(search));
  const entry: SavedSearch = { ...search, id: searchId(search), name, renamed: false, ...(color ? { color } : {}) };
  saveSaved([...saved, entry]);
  return entry;
}

export function removeSaved(id: string) {
  saveSaved(loadSaved().filter((item) => item.id !== id));
}

export const findSaved = (search: Search) => loadSaved().find((item) => item.id === searchId(search)) ?? null;

// Keeps a saved search's settings in step with the trip screen, which owns them while open.
export function updateSaved(search: Search) {
  saveSaved(
    loadSaved().map((item) =>
      item.id === searchId(search)
        ? { ...search, id: item.id, name: item.name, ...(item.color ? { color: item.color } : {}), ...(item.renamed !== undefined ? { renamed: item.renamed } : {}) }
        : item,
    ),
  );
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

// Forgets every stored response, keeping settings and saved and recent searches.
export function clearCached() {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(`${PREFIX}cache:`)) localStorage.removeItem(key);
  } catch {
    // Storage the browser blocks holds nothing to clear.
  }
}
