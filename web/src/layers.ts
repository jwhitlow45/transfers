import { createContext } from 'preact';
import { useContext, useLayoutEffect, useRef } from 'preact/hooks';

// Whether a screen is the one showing, rather than kept under it so going back finds it as it was
// (see main.tsx). A screen under another does not poll or follow swipes.
export const ScreenActive = createContext(true);
export const useScreenActive = () => useContext(ScreenActive);

// What a sheet over the whole app, such as a live map's, asks of the app: `hold` makes every page
// behind it inert until the function it returns is called, and `covered` says the pin bar's panel
// is open over the sheet, which is then inert as the pages are (see Sheet.tsx).
export const AppSheets = createContext<{ hold: () => () => void; covered: boolean }>({ hold: () => () => {}, covered: false });

// Runs when a screen kept under another shows again, to read what the screen it was under may have
// changed in storage, such as a search saved or a trip pinned there. Before paint, so the old state
// never shows.
export function useShownAgain(callback: () => void) {
  const active = useScreenActive();
  const latest = useRef(callback);
  latest.current = callback;
  const was = useRef(active);
  useLayoutEffect(() => {
    if (active && !was.current) latest.current();
    was.current = active;
  }, [active]);
  return active;
}
