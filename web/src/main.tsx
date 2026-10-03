import { render } from 'preact';
import { Home } from './components/Home.tsx';
import { Nearby } from './components/Nearby.tsx';
import { Settings } from './components/Settings.tsx';
import { Trip } from './components/Trip.tsx';
import { navigate, usePage } from './router.ts';
import { SettingsProvider } from './settings.tsx';
import { searchId } from './storage.ts';
import './styles.css';

function App() {
  const page = usePage();
  const link = (path: string) => (event: MouseEvent) => {
    event.preventDefault();
    navigate(path);
  };
  return (
    <SettingsProvider>
      <a class="skip-link" href="#main">
        Skip to content
      </a>
      <header class="site-header">
        <a href="/" class="site-title" onClick={link('/')}>
          Transfers
        </a>
        <nav aria-label="Main">
          <a href="/nearby" onClick={link('/nearby')} aria-current={page.name === 'nearby' ? 'page' : undefined}>
            Nearby
          </a>
          <a href="/settings" onClick={link('/settings')} aria-current={page.name === 'settings' ? 'page' : undefined}>
            Settings
          </a>
        </nav>
      </header>
      <main id="main">
        {page.name === 'home' && <Home />}
        {page.name === 'trip' && <Trip key={searchId(page.search)} search={page.search} />}
        {page.name === 'nearby' && <Nearby />}
        {page.name === 'settings' && <Settings />}
      </main>
      <footer class="site-footer">
        Data provided by <a href="https://511.org">511.org</a> and BART. Times are Pacific.
      </footer>
    </SettingsProvider>
  );
}

render(<App />, document.getElementById('app')!);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
}
