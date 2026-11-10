import { useEffect, useRef, useState } from 'preact/hooks';
import type { Route } from '../../shared/api.ts';
import { pinToastText } from './lib/pinned.ts';
import { type Pin, type Search, loadPin, loadPins, onPinsChange, savePin, searchId } from './storage.ts';

// The pins as stored, read again whenever one changes (see onPinsChange), here or in another tab.
function useStoredPins<T>(read: () => T) {
  const [value, setValue] = useState(read);
  useEffect(() => {
    // Kept as it is when nothing in it changed, so a write that changes another pin renders nothing here.
    const update = () => setValue((current) => (JSON.stringify(current) === JSON.stringify(read()) ? current : read()));
    // One may have changed between the first render and now.
    update();
    const stop = onPinsChange(update);
    const onStorage = (event: StorageEvent) => (event.key === null || event.key.endsWith(':pins')) && update();
    addEventListener('storage', onStorage);
    return () => {
      stop();
      removeEventListener('storage', onStorage);
    };
  }, []);
  return value;
}

// Every pin the bar can show, with its search.
export const usePins = () => useStoredPins(loadPins);

// What is pinned to a search, for its page to mark, as it stands wherever it was changed from: the
// page, the app's pin bar, or a map's sheet.
export const usePin = (search: Search) => useStoredPins(() => loadPin(search));

// Pins to a search, kept with the search as it stands, so the pin bar can name the pin and open
// its page. Null unpins.
export const setPin = (search: Search, pin: Pin | null) => savePin(search, pin && { ...pin, search });

// The pin on a search, written again with the search as it stands, as its page opens. Read as
// stored when written, not as the page read it when it first rendered, as the pin bar may have
// written the trip's latest times in between, and an older copy would put back older times.
export function keepPinSearch(search: Search) {
  const stored = loadPin(search);
  if (stored) setPin(search, stored);
}

export const pinId = (pin: { search: Search }) => searchId(pin.search);

// Home's pull to refresh reaches the pins too. Each polls in the app's pin bar, apart from the
// page (see PinBar.tsx), so the page asks through here, and every pin's poll answers.
const refreshers = new Set<() => void>();
export const refreshPins = () => refreshers.forEach((refresh) => refresh());
export function usePinRefresh(refresh: () => void) {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    const run = () => latest.current();
    refreshers.add(run);
    return () => void refreshers.delete(run);
  }, []);
}

// A pin the rider changed, for the app's one pin toast: what it says, and Undo.
export type PinToast = { text: string; about: 'pin' | 'unpin'; undo?: () => void };
let toastListener: ((toast: PinToast) => void) | null = null;
// The pin bar shows the toast, wherever the pin was changed from. Returns how to stop.
export function onPinToast(listener: (toast: PinToast) => void) {
  toastListener = listener;
  return () => {
    if (toastListener === listener) toastListener = null;
  };
}

// The rider pins or unpins, from a row, a saved card, a map's sheet, or the pin bar. Unpinning, and
// pinning in place of another, say so in a toast with Undo, which puts back whatever was pinned
// before (see pinToastText). A plain pin says nothing, but for a cable car's bell (`bell`, see
// lib/eggs.ts), which has nothing to undo. A map's sheet holds this from when it opened, so the pin it replaces
// is read as it is now. `routes` names the vehicle a pin replaces.
export function changePin(search: Search, next: Pin | null, routes?: Record<string, Route>, bell = false) {
  const previous = loadPin(search);
  setPin(search, next);
  const text = pinToastText(previous, next, routes, bell);
  if (text) toastListener?.({ text, about: next ? 'pin' : 'unpin', ...(previous ? { undo: () => setPin(search, previous) } : {}) });
}
