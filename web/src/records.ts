import { useState } from 'preact/hooks';
import type { Route } from '../../shared/api.ts';
import type { ToastMessage } from './components/Toast.tsx';
import { useShownAgain } from './layers.ts';
import type { ViewAlert } from './lib/alerts.ts';
import { defaultSavedColor } from './lib/color.ts';
import { changePin, keepPinSearch, usePin } from './pins.ts';
import { type Pin, type Search, dismissNotice, findSaved, loadDismissed, loadSaved, removeSaved, restoreNotice, saveSaved, saveSearch } from './storage.ts';

type Show = (message: Omit<ToastMessage, 'id'>) => void;

// What this device keeps for the search a page shows, which a trip's results and a stop's arrivals
// read and change alike: whether it is saved, what is pinned to it, and the notices dismissed
// everywhere. Saving and dismissing say so with Undo. Kept under a page it opens (see main.tsx),
// the page reads them again on the way back, for changes made there. The pin is the app's, which
// its pin bar shows on every page, so it is followed wherever it changes (see pins.ts).
export function useSearchRecords(search: Search, show: Show) {
  const [saved, setSaved] = useState(() => findSaved(search));
  const pin = usePin(search);
  const [dismissed, setDismissed] = useState(loadDismissed);
  useShownAgain(() => {
    setSaved(findSaved(search));
    setDismissed(loadDismissed());
  });
  return {
    saved,
    pin,
    // The pin kept with the search as it stands now (see keepPinSearch).
    keepPin: () => keepPinSearch(search),
    dismissedIds: new Set(dismissed.map(({ id }) => id)),
    // Pinning from a row or a map's sheet. Unpinning, and pinning in place of another, say so with
    // Undo (see changePin).
    pinByRider: (next: Pin | null, routes: Record<string, Route> | undefined, bell = false) => changePin(search, next, routes, bell),
    // Saved by `name`, in the color of its line, or removed with its name, color and settings,
    // which Undo puts back in its place.
    toggleSaved: (name: string, lineColor: string | null) => {
      if (saved) {
        const undo = unsave(saved.id);
        setSaved(null);
        show({ text: 'Removed from Saved', about: 'unsaved', undo: () => setSaved(undo()) });
        return;
      }
      const added = saveWithColor(search, name, lineColor);
      setSaved(added);
      show({
        text: 'Saved to Home',
        about: 'saved',
        undo: () => {
          removeSaved(added.id);
          setSaved(null);
        },
      });
    },
    // Hidden here and on every other search until the Notices page puts it back.
    dismiss: ({ id, kicker, title, body, meta, url, severity }: ViewAlert) => {
      dismissNotice({ id, kicker, title, body, meta, url, severity });
      setDismissed(loadDismissed());
      show({
        text: 'Notice dismissed',
        about: 'notice',
        undo: () => {
          restoreNotice(id);
          setDismissed(loadDismissed());
        },
      });
    },
  };
}

// Removes a saved search, and returns how to put it back where it was, name, color and settings
// and all, among the saved searches as they are by then.
export function unsave(id: string) {
  const all = loadSaved();
  const index = all.findIndex((item) => item.id === id);
  const removed = all[index] ?? null;
  removeSaved(id);
  return () => {
    if (!removed) return null;
    const rest = loadSaved().filter((item) => item.id !== id);
    saveSaved([...rest.slice(0, index), removed, ...rest.slice(index)]);
    return removed;
  };
}

// Saves a search in its line's color, or where another saved search is near that color, one of
// the set that is not.
export function saveWithColor(search: Search, name: string, lineColor: string | null) {
  const taken = loadSaved().map(({ color }) => color).filter((color) => color !== undefined);
  return saveSearch(search, name, defaultSavedColor(lineColor, taken));
}
