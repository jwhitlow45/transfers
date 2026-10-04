import { type ComponentChildren, type FunctionComponent, createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { Stop } from '../../shared/api.ts';
import { DataCredit } from './components/DataCredit.tsx';
import { Sheet } from './components/Sheet.tsx';
import { stopPage } from './view.ts';

// A vehicle the rider asked to follow to a stop. The title is what they tapped, such as "49 at
// 8:12", so the sheet names it before the map arrives. The color is the route's on the page they
// tapped it on, where results pick colors that tell routes apart.
export type Tracked = { trip: string; stop: string; title: string; color?: string };

type MapComponent = FunctionComponent<{ tracked: Tracked }>;

const TrackContext = createContext<(tracked: Tracked) => void>(() => {});

// The live map is its own chunk, fetched the first time a rider opens one, so pages without a
// map open never download it.
let loading: Promise<MapComponent> | null = null;
const loadMap = () => (loading ??= import('./components/TrackMap.tsx').then((module) => module.TrackMap));

// Holds the one tracking sheet for every screen. It renders no element of its own, so the sheet
// sits directly in the app shell, where swipe back leaves sheets alone.
export function TrackProvider({ children }: { children: ComponentChildren }) {
  const [tracked, setTracked] = useState<Tracked | null>(null);
  const [map, setMap] = useState<{ Map: MapComponent } | null>(null);
  const [failed, setFailed] = useState(false);
  // The sheet sits above every screen, so it closes when the rider goes back or moves to another
  // screen, as a sheet inside the screen would.
  useEffect(() => {
    const close = () => setTracked(null);
    addEventListener('popstate', close);
    return () => removeEventListener('popstate', close);
  }, []);
  const open = (next: Tracked) => {
    setTracked(next);
    setFailed(false);
    loadMap().then(
      (Map) => setMap({ Map }),
      () => setFailed(true),
    );
  };
  return (
    <TrackContext.Provider value={open}>
      {children}
      {tracked && (
        // 511's agreement asks for its credit beside its data, and the page's own credit is under
        // the sheet.
        <Sheet title={tracked.title} footer={<DataCredit />} onClose={() => setTracked(null)}>
          {map ? (
            <map.Map key={`${tracked.trip}|${tracked.stop}`} tracked={tracked} />
          ) : failed ? (
            // Browsers remember a failed load of a script chunk and refuse it again until the page
            // reloads, so a reload is the way to retry. Online, a likely cause is a new version of
            // the site, whose server no longer has the map file this page asks for, but a weak
            // connection underground also reads as online.
            <p class="tf-muted">
              {navigator.onLine ? 'The map could not load. Transfers may have been updated since this page opened. ' : 'The map could not load while offline. Once back online, '}
              <button type="button" class="tf-time-link" onClick={() => location.reload()}>
                {navigator.onLine ? 'Reload the page' : 'reload the page'}
              </button>
              {navigator.onLine ? ' to open the map.' : '.'}
            </p>
          ) : (
            <p class="tf-muted">Loading the map…</p>
          )}
        </Sheet>
      )}
    </TrackContext.Provider>
  );
}

// A vehicle's time at a stop, which opens its live map. BART reports no train positions, so a
// BART time opens the station's page on bart.gov instead, which lists its trains. 511 sends no
// positions for the ferry either, and it has no page per stop, so a ferry time is plain text.
export function TimeLink({ trip, stop, title, color, children }: { trip: string; stop: Stop | undefined; title: string; color?: string; children: ComponentChildren }) {
  const open = useContext(TrackContext);
  if (!stop || trip.startsWith('GF:')) return <>{children}</>;
  if (trip.startsWith('BA:')) {
    const page = stopPage(stop);
    if (!page) return <>{children}</>;
    return (
      <a class="tf-time-link" href={page} target="_blank" rel="noopener">
        {children}
        <span class="tf-sr">, trains on bart.gov</span>
      </a>
    );
  }
  return (
    <button type="button" class="tf-time-link" onClick={() => open({ trip, stop: stop.key, title, ...(color ? { color } : {}) })}>
      {children}
      <span class="tf-sr">, follow on a map</span>
    </button>
  );
}
