import { type ComponentChildren, type FunctionComponent, createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { Stop } from '../../shared/api.ts';
import { DataCredit } from './components/DataCredit.tsx';
import { Sheet } from './components/Sheet.tsx';
import { IconPin } from './icons/ui.tsx';

// A vehicle the rider asked to follow to a stop. The title is what they tapped, such as "49 at
// 8:12", so the sheet names it before the map arrives. The color is the route's on the page they
// tapped it on, where results pick colors that tell routes apart. `marks` are the rider's stops
// on the way, in the order their journey makes them: where they get on, where they change, and
// where they are going, when they set a destination.
export type Mark = { stop: string; kind: 'yours' | 'transfer' | 'destination' };
// The vehicle the rider changes to, where they board it, its color on the page, the minutes the
// rider has to make it, and the destination they ride it to, when they set one. `min` is the
// shortest transfer the rider's window allows, for marking a tight one as results do. A hidden
// connection, outside the window already, has none.
// `scheduled`: `minutes` come from a time that is the schedule's alone, for the map to mark them
// while it has only those to show.
export type Transfer = { trip: string; stop: string; color?: string; minutes?: number; scheduled?: boolean; min?: number; destination?: string };
// `pin` pins the trip the rider opened the map from, when it is one trip they can pin, from the
// sheet's header: its state, kept as the page says while the sheet is open, what it pins for
// screen readers and for telling pins apart, and pinning or not.
export type PinAction = { pinned: boolean; label: string; set: (on: boolean) => void };
export type Tracked = { trip: string; stop: string; title: string; color?: string; marks?: Mark[]; transfer?: Transfer; pin?: PinAction };

type MapComponent = FunctionComponent<{ tracked: Tracked }>;

// `open` shows a vehicle's map. `syncPin` tells an open sheet that the trip a pin names, by its
// label, is pinned or not now.
type TrackApi = { open: (tracked: Tracked) => void; syncPin: (label: string, pinned: boolean) => void };
const TrackContext = createContext<TrackApi>({ open: () => {}, syncPin: () => {} });

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
  // The sheet's pin says what the page says. The page's toast shows above the sheet, so its Undo
  // can pin or unpin the trip the sheet shows, and the time links it was opened from then say so.
  const syncPin = (label: string, pinned: boolean) =>
    setTracked((current) => (current?.pin?.label === label && current.pin.pinned !== pinned ? { ...current, pin: { ...current.pin, pinned } } : current));
  const togglePin = (pin: PinAction) => {
    pin.set(!pin.pinned);
    syncPin(pin.label, !pin.pinned);
  };
  return (
    <TrackContext.Provider value={{ open, syncPin }}>
      {children}
      {tracked && (
        // 511's agreement asks for its credit beside its data, and the page's own credit is under
        // the sheet.
        <Sheet title={tracked.title} footer={<DataCredit />} action={tracked.pin && <SheetPin pin={tracked.pin} onToggle={togglePin} />} onClose={() => setTracked(null)}>
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

// A vehicle's time at a stop, which opens its live map. For BART and the ferry, which report no
// positions, the map places the vehicle by when it is due at its stops.
export function TimeLink({ trip, stop, title, color, marks, transfer, pin, children }: {
  trip: string;
  stop: Stop | undefined;
  title: string;
  color?: string;
  marks?: Mark[];
  transfer?: Transfer;
  pin?: PinAction;
  children: ComponentChildren;
}) {
  const { open, syncPin } = useContext(TrackContext);
  useEffect(() => {
    if (pin) syncPin(pin.label, pin.pinned);
  }, [pin?.pinned]);
  if (!stop) return <>{children}</>;
  return (
    <button
      type="button"
      class="tf-time-link"
      onClick={() => open({ trip, stop: stop.key, title, ...(color ? { color } : {}), ...(marks ? { marks } : {}), ...(transfer ? { transfer } : {}), ...(pin ? { pin } : {}) })}
    >
      {children}
      <span class="tf-sr">, follow on a map</span>
    </button>
  );
}

// Pins the trip from the map's sheet, beside Close. It sits in the sheet, not the map, so it works
// while the map loads or when it cannot. It says Pinned once pressed, as a pinned row does, and
// the page's toast, above the sheet, says what changed.
function SheetPin({ pin, onToggle }: { pin: PinAction; onToggle: (pin: PinAction) => void }) {
  return (
    <button type="button" class="tf-filter tf-sheet__pin" aria-pressed={pin.pinned} aria-label={`Pin ${pin.label}`} onClick={() => onToggle(pin)}>
      <IconPin filled={pin.pinned} size={16} />
      {pin.pinned ? 'Pinned' : 'Pin'}
    </button>
  );
}
