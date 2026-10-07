import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import { usePage } from './router.ts';
import { NearbyScreen } from './screens/NearbyScreen.tsx';
import { NoticesScreen } from './screens/NoticesScreen.tsx';
import { ResultsScreen } from './screens/ResultsScreen.tsx';
import { SearchScreen } from './screens/SearchScreen.tsx';
import { SettingsScreen } from './screens/SettingsScreen.tsx';
import { SettingsProvider } from './settings.tsx';
import { searchId } from './storage.ts';
import { TrackProvider } from './track.tsx';
import './styles.css';

function App() {
  const page = usePage();
  // Each screen scrolls inside the app shell, so the page title is the only way a screen
  // change reaches a screen reader without moving focus.
  useEffect(() => {
    document.title = page.name === 'trip' ? `${page.search.fromLabel} to ${page.search.toLabel} · Transfers` : page.name === 'home' ? 'Transfers' : `${page.name[0]!.toUpperCase()}${page.name.slice(1)} · Transfers`;
  }, [page]);
  return (
    <SettingsProvider>
      <div class="tf-app">
        <TrackProvider>
          {page.name === 'home' && <SearchScreen key={history.state?.from || history.state?.to ? 'prefilled' : 'home'} />}
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
