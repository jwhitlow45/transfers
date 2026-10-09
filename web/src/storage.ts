// Everything the app remembers lives in this browser only. Storage can be missing or full
// (private windows, cleared site data), so every read falls back to defaults and every write
// may fail quietly. Values are plain objects so they could move to an account later.

import { MAX_MINUTES, type PinRequest, type PinnedTrip } from '../../shared/api.ts';

const PREFIX = 'transfers:';

// `session` keeps a value for this tab only, as sessionStorage does.
type Area = 'device' | 'session';
const area = (where: Area) => (where === 'session' ? sessionStorage : localStorage);

export function readStored<T>(key: string, fallback: T, where: Area = 'device'): T {
  try {
    const text = area(where).getItem(PREFIX + key);
    return text === null ? fallback : (JSON.parse(text) as T);
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: unknown, where: Area = 'device') {
  try {
    area(where).setItem(PREFIX + key, JSON.stringify(value));
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
  // A rider who needs elevators: their outages at the trip's stations tagged on the results, and
  // more time to change at stations.
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
  return clampTimes({ ...DEFAULT_SETTINGS, ...readStored<Partial<DeviceSettings>>('settings', {}) });
}

export function saveSettings(settings: DeviceSettings) {
  writeStored('settings', settings);
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

// A stop's arrivals, with no transfer (J, 2026-10-09), kept as a search with no To, so saving it,
// pinning one of its arrivals, and its place among recent searches work as for a trip.
export const stopSearch = (stop: string, label: string): Search => ({ from: stop, to: '', fromLabel: label, toLabel: '' });
export const isStopSearch = (search: Pick<Search, 'to'>) => search.to === '';

// A trip pinned to a search's results, kept until the rider unpins it or, with that setting on,
// a while after it ends. The vehicle to transfer to and where it is boarded, with the first
// vehicle and where it is left unless the route is already at From, each with when it was
// scheduled there (see PinRequest). Kept by From and To only, so it stays through other changes to
// the search, and follows a new destination. Pins saved before the first vehicle's time was kept
// lack it, and their `at` is when the second was due, predictions included. `ends` is when the trip
// ends by the latest times seen: arriving at the destination, or with none set, boarding the second
// vehicle.
// `search` is the search it is pinned to as it stands now, so Home can show the pin and open its
// results. Pins saved before it was kept lack it. `last` is the trip's times as last seen.
// An arrival pinned at a stop, with no transfer, has no first vehicle, and `arrival` keeps what its
// card says while the stop's times are away: the route and where it is going.
export type Pin = PinRequest & { ends: number; search?: Search; last?: PinnedTrip; arrival?: { route: string; headsign: string } };

export function loadPin(search: Search): Pin | null {
  return readStored<Record<string, Pin>>('pins', {})[searchId(search)] ?? null;
}

// Every pin Home can show, with its search.
export function loadPins(): (Pin & { search: Search })[] {
  return Object.values(readStored<Record<string, Pin>>('pins', {})).filter((pin): pin is Pin & { search: Search } => pin.search !== undefined);
}

export function savePin(search: Search, pin: Pin | null) {
  const { [searchId(search)]: _old, ...others } = readStored<Record<string, Pin>>('pins', {});
  writeStored('pins', pin ? { ...others, [searchId(search)]: pin } : others);
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
  // How it showed, so the Notices page shows it the same. Absent on older saves.
  severity?: 'severe' | 'warning' | 'info';
  at: number;
};

// A dismissed notice is forgotten after this long, so the list does not grow without end. Not
// when the agency's notice ends: for one that recurs, such as nightly, that is only the end of
// tonight's, and it would come back tomorrow.
export const DISMISSED_DAYS = 60;

export function loadDismissed(): DismissedNotice[] {
  const now = Date.now() / 1000;
  return readStored<DismissedNotice[]>('dismissed', []).filter(({ at }) => now - at < DISMISSED_DAYS * 86_400);
}

// Dismissed now, or with `at`, put back as dismissed then, as Undo after Restore does.
export function dismissNotice(notice: Omit<DismissedNotice, 'at'>, at = Math.floor(Date.now() / 1000)) {
  const others = loadDismissed().filter(({ id }) => id !== notice.id);
  writeStored('dismissed', [...others, { ...notice, at }].sort((a, b) => b.at - a.at));
}

export function restoreNotice(id: string) {
  writeStored('dismissed', loadDismissed().filter((notice) => notice.id !== id));
}

export function restoreAllNotices() {
  writeStored('dismissed', []);
}

// Results tell a rider that tapping a connection pins it on their first few visits, until they
// first pin one. Each call counts a visit and says whether to show the hint on it.
const PIN_HINT_VISITS = 3;

export function takePinHint() {
  const left = readStored<number>('pinHint', PIN_HINT_VISITS);
  if (left <= 0) return false;
  writeStored('pinHint', left - 1);
  return true;
}

export function clearPinHint() {
  writeStored('pinHint', 0);
}

export function loadSaved(): SavedSearch[] {
  return readStored<SavedSearch[]>('saved', []).map(clampTimes);
}

export function saveSaved(saved: SavedSearch[]) {
  writeStored('saved', saved);
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
export const loadFields = <T>() => readStored<T | null>('fields', null, 'session');

export const saveFields = (fields: unknown) => writeStored('fields', fields, 'session');

export function loadRecent(): RecentSearch[] {
  return readStored<RecentSearch[]>('recent', []);
}

// Stops and routes picked from search, by key, with what tells them apart ("Muni · Stop 13477 ·
// Eastbound"), so recent ones offered in an empty field say it too. The latest 30.
export type PickedStop = { key: string; label: string; meta: string; short: string };
export function loadPicked(): Record<string, PickedStop> {
  return readStored<Record<string, PickedStop>>('picked', {});
}
export function rememberPicked(picked: PickedStop) {
  const { [picked.key]: _old, ...others } = loadPicked();
  writeStored('picked', Object.fromEntries([...Object.entries(others), [picked.key, { key: picked.key, label: picked.label, meta: picked.meta, short: picked.short }]].slice(-30)));
}

// The whole list back as it was, as when a removal is undone.
export function saveRecent(recent: RecentSearch[]) {
  writeStored('recent', recent);
}

export function removeRecent(id: string) {
  writeStored('recent', loadRecent().filter((item) => searchId(item) !== id));
}

export function rememberRecent(search: Search, via?: string) {
  const recent = loadRecent().filter((item) => searchId(item) !== searchId(search));
  writeStored('recent', [{ ...search, at: Date.now(), ...(via ? { via } : {}) }, ...recent].slice(0, 8));
}

// The last response for each request, shown at once on return or while offline.
export function loadCached<T>(url: string) {
  return readStored<{ data: T; fetchedAt: number } | null>(`cache:${url}`, null);
}

export function saveCached(url: string, data: unknown, fetchedAt = Date.now()) {
  writeStored(`cache:${url}`, { data, fetchedAt });
}

// Forgets every stored response, keeping settings and saved and recent searches.
export function clearCached() {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(`${PREFIX}cache:`)) localStorage.removeItem(key);
  } catch {
    // Storage the browser blocks holds nothing to clear.
  }
}
