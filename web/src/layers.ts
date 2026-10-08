import { createContext } from 'preact';
import { useContext } from 'preact/hooks';

// Whether a screen is the one showing, rather than kept under it so going back finds it as it was
// (see main.tsx). A screen under another does not poll or follow swipes.
export const ScreenActive = createContext(true);
export const useScreenActive = () => useContext(ScreenActive);
