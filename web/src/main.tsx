import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ENTER_MS, motionOff, usePeeking } from './gestures.ts';
import { type Page, currentDepth, usePage } from './router.ts';
import { NearbyScreen } from './screens/NearbyScreen.tsx';
import { NoticesScreen } from './screens/NoticesScreen.tsx';
import { ResultsScreen } from './screens/ResultsScreen.tsx';
import { SearchScreen } from './screens/SearchScreen.tsx';
import { SettingsScreen } from './screens/SettingsScreen.tsx';
import { SettingsProvider } from './settings.tsx';
import { searchId } from './storage.ts';
import { TrackProvider } from './track.tsx';
import './styles.css';

// A step forward from Home, as to results, slides the new screen in over Home, which stays under
// it until it is in place (J, 2026-10-08). Back, by a swipe, slides it off again (useSwipeBack).
function useEntering(page: Page) {
  const last = useRef({ page, depth: currentDepth() });
  const until = useRef(0);
  const [, rerender] = useState(0);
  if (last.current.page !== page) {
    const depth = currentDepth();
    if (last.current.page.name === 'home' && page.name !== 'home' && depth > last.current.depth && !motionOff()) until.current = Date.now() + ENTER_MS;
    last.current = { page, depth };
  }
  const entering = Date.now() < until.current;
  useEffect(() => {
    if (!entering) return;
    const timer = setTimeout(() => rerender((count) => count + 1), until.current - Date.now());
    return () => clearTimeout(timer);
  }, [entering]);
  return entering;
}

function App() {
  const page = usePage();
  const peeking = usePeeking();
  const entering = useEntering(page);
  const home = page.name === 'home';
  // Home under another screen, as it slides in or is swiped back off.
  const under = !home && (peeking || entering);
  // Home is one mounted screen whether it shows or lies under another, so it keeps its scroll and
  // what it has loaded, and the one under a swipe back is the one the rider lands on.
  const homeKey = useRef('home');
  if (home) homeKey.current = history.state?.from || history.state?.to ? 'prefilled' : 'home';
  // Each screen scrolls inside the app shell, so the page title is the only way a screen
  // change reaches a screen reader without moving focus.
  useEffect(() => {
    document.title = page.name === 'trip' ? `${page.search.fromLabel} to ${page.search.toLabel} · Transfers` : page.name === 'home' ? 'Transfers' : `${page.name[0]!.toUpperCase()}${page.name.slice(1)} · Transfers`;
  }, [page]);
  return (
    <SettingsProvider>
      <div class="tf-app" data-entering={entering ? 'true' : undefined}>
        <TrackProvider>
          {(home || under) && (
            <div class={home ? 'tf-home-layer' : 'tf-peek'} aria-hidden={home ? undefined : 'true'} inert={!home}>
              <SearchScreen key={homeKey.current} />
              {under && <div class="tf-peek__dim" />}
            </div>
          )}
          {page.name === 'trip' && <ResultsScreen key={searchId(page.search)} search={page.search} />}
          {page.name === 'nearby' && <NearbyScreen />}
          {page.name === 'settings' && <SettingsScreen />}
          {page.name === 'notices' && <NoticesScreen />}
        </TrackProvider>
      </div>
    </SettingsProvider>
  );
}

render(<App />, document.getElementById('app')!);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
}
