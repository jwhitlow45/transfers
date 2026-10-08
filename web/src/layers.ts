import { createContext } from 'preact';
import { useContext, useLayoutEffect, useRef } from 'preact/hooks';

// Whether a screen is the one showing, rather than kept under it so going back finds it as it was
// (see main.tsx). A screen under another does not poll or follow swipes.
export const ScreenActive = createContext(true);
export const useScreenActive = () => useContext(ScreenActive);

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
