import { type ComponentChildren, type FunctionComponent, createContext } from 'preact';
import { useContext, useState } from 'preact/hooks';
import type { Stop } from '../../shared/api.ts';
import { Sheet } from './components/Sheet.tsx';
import { stopPage } from './view.ts';

// A vehicle the rider asked to follow to a stop. The title is what they tapped, such as "49 at
// 8:12", so the sheet names it before the map arrives. The color is the route's on the page they
// tapped it on, where results pick colors that tell routes apart.
export type Tracked = { trip: string; stop: string; title: string; color?: string };

type MapComponent = FunctionComponent<{ tracked: Tracked }>;

const TrackContext = createContext<(tracked: Tracked) => void>(() => {});

// The live map is its own chunk, fetched the first time a rider opens one, so pages without a
// map open never download it. A failed fetch is forgotten, so the next tap tries again.
let loading: Promise<MapComponent> | null = null;
const loadMap = () =>
  (loading ??= import('./components/TrackMap.tsx').then(
    (module) => module.TrackMap,
    (error: unknown) => {
      loading = null;
      throw error;
    },
  ));

// Holds the one tracking sheet for every screen. It renders no element of its own, so the sheet
// sits directly in the app shell, where swipe back leaves sheets alone.
export function TrackProvider({ children }: { children: ComponentChildren }) {
  const [tracked, setTracked] = useState<Tracked | null>(null);
  const [map, setMap] = useState<{ Map: MapComponent } | null>(null);
  const [failed, setFailed] = useState(false);
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
        <Sheet title={tracked.title} onClose={() => setTracked(null)}>
          {map ? <map.Map key={`${tracked.trip}|${tracked.stop}`} tracked={tracked} /> : <p class="tf-muted">{failed ? 'The map could not load. Check your connection and try again.' : 'Loading the map…'}</p>}
        </Sheet>
      )}
    </TrackContext.Provider>
  );
}

// A vehicle's time at a stop, which opens its live map. BART reports no train positions, so a
// BART time opens the station's page on bart.gov instead, which lists its trains.
export function TimeLink({ trip, stop, title, color, children }: { trip: string; stop: Stop | undefined; title: string; color?: string; children: ComponentChildren }) {
  const open = useContext(TrackContext);
  if (!stop) return <>{children}</>;
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
