import { render } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ENTER_MS, motionOff, usePeeking } from './gestures.ts';
import { ScreenActive } from './layers.ts';
import { type Page, backGoesHome, cameBackTo, currentDepth, forgetLeft, usePage } from './router.ts';
import { NearbyScreen } from './screens/NearbyScreen.tsx';
import { NoticesScreen } from './screens/NoticesScreen.tsx';
import { ResultsScreen } from './screens/ResultsScreen.tsx';
import { SearchScreen } from './screens/SearchScreen.tsx';
import { SettingsScreen } from './screens/SettingsScreen.tsx';
import { SettingsProvider } from './settings.tsx';
import { searchId } from './storage.ts';
import { TrackProvider } from './track.tsx';
import './styles.css';

// The screen showing, and the one it was opened from, kept mounted under it, so that going back
// finds that one as the rider left it, scrolled and with any sheet still open, and a swipe back
// shows it under the screen it uncovers (J, 2026-10-08). A step forward slides the new screen in
// over it. Only one is kept: a screen two steps back is opened afresh.
type Layer = { id: number; page: Page; depth: number; homeKey: string };
// A trip rising over the one it takes the place of (tf-rise in styles.css).
const SWAP_MS = 260;
let layerIds = 0;

function useLayers(page: Page, peeking: boolean) {
  const make = (depth: number): Layer => ({ id: ++layerIds, page, depth, homeKey: history.state?.from || history.state?.to ? 'prefilled' : 'home' });
  // `motion` is how the screen showing arrived, until `until`: sliding in over the one under it, or
  // rising over `outgoing`, the one whose place it took, kept until then. `until` is Infinity while
  // the motion is held at its start (see below).
  const state = useRef<{ current: Layer; under: Layer | null; outgoing: Layer | null; motion: 'enter' | 'swap'; until: number; homePeek: number | null }>(null as never);
  if (!state.current) state.current = { current: make(currentDepth()), under: null, outgoing: null, motion: 'enter', until: 0, homePeek: null };
  const [, rerender] = useState(0);
  const s = state.current;
  if (s.current.page !== page) {
    const depth = currentDepth();
    s.outgoing = null;
    const same = (layer: Layer | null) => layer !== null && layer.page.name === page.name && (page.name !== 'trip' || (layer.page.name === 'trip' && searchId(layer.page.search) === searchId(page.search)));
    if (depth > s.current.depth) {
      s.under = s.current;
      s.current = make(depth);
      if (!motionOff()) [s.motion, s.until] = ['enter', Infinity];
    } else if (depth < s.current.depth) {
      // Back to the screen kept under, or to the Home a swipe back showed fresh under it.
      const kept = same(s.under) ? s.under! : page.name === 'home' && s.homePeek !== null ? { ...make(depth), id: s.homePeek } : null;
      s.current = kept ? { ...kept, page, depth } : make(depth);
      s.under = null;
      s.until = 0;
    } else if (page.name === 'home' && s.current.page.name !== 'home' && s.homePeek !== null) {
      // A swipe back from a screen opened by a link, which Home replaces: the Home it showed.
      s.current = { ...make(depth), id: s.homePeek };
    } else {
      // The same screen with a new address, as when a setting changes, or a sheet closes. Another
      // trip in its place, as its return trip opens, rises from the bottom over it, much as a step
      // forward slides in from the side, though the app is no deeper for it (J, 2026-10-08).
      const swap = page.name === 'trip' && s.current.page.name === 'trip' && searchId(page.search) !== searchId(s.current.page.search);
      if (swap && !motionOff()) {
        s.outgoing = s.current;
        s.current = make(depth);
        [s.motion, s.until] = ['swap', Infinity];
      } else s.current = { ...s.current, page, depth };
    }
  }
  const moving = Date.now() < s.until;
  const held = s.until === Infinity;
  // A motion starts held at its first frame, and runs once the new screen has painted. Its clock
  // would otherwise start as the screen is made, and the frame or two it takes to draw would skip
  // the motion's start, so it would jump halfway in. Released straight on the element, as a render
  // then would cost another frame.
  const app = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!held) return;
    const [motion, screen] = [s.motion, s.current.id];
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (s.until !== Infinity || s.motion !== motion || s.current.id !== screen) return;
        const lasts = motion === 'enter' ? ENTER_MS : SWAP_MS;
        s.until = Date.now() + lasts;
        app.current?.removeAttribute('data-held');
        setTimeout(() => rerender((count) => count + 1), lasts);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [held, s.current.id]);
  const entering = moving && s.motion === 'enter';
  const swapping = moving && s.motion === 'swap';
  if (!swapping) s.outgoing = null;
  // A swipe back to Home with nothing kept under: Home, opened fresh to show under the screen,
  // and kept as the Home landed on.
  const freshHome = !s.under && peeking && page.name !== 'home' && backGoesHome();
  if (freshHome && s.homePeek === null) s.homePeek = ++layerIds;
  if (!freshHome && page.name !== 'home') s.homePeek = null;
  const under = s.under ?? (freshHome ? { id: s.homePeek!, page: { name: 'home' } as Page, depth: 0, homeKey: 'home' } : null);
  return { current: s.current, under, outgoing: s.outgoing, entering, swapping, held, app };
}

function screenFor(layer: Layer) {
  const { page } = layer;
  if (page.name === 'home') return <SearchScreen key={layer.homeKey} />;
  if (page.name === 'trip') return <ResultsScreen key={searchId(page.search)} search={page.search} />;
  if (page.name === 'nearby') return <NearbyScreen />;
  if (page.name === 'settings') return <SettingsScreen />;
  return <NoticesScreen />;
}

function App() {
  const page = usePage();
  const peeking = usePeeking();
  const { current, under, outgoing, entering, swapping, held, app } = useLayers(page, peeking);
  // Back on a page left for another and opened afresh, it is scrolled where it was, before it
  // paints. Its own sheet reopens from the same record (see Left in router.ts).
  useLayoutEffect(() => {
    const back = cameBackTo();
    if (!back) return;
    const scroller = document.querySelector('.tf-app > .tf-layer > .tf-scroll');
    if (scroller) scroller.scrollTop = back.scroll;
    forgetLeft();
  }, [page]);
  // Each screen scrolls inside the app shell, so the page title is the only way a screen
  // change reaches a screen reader without moving focus.
  useEffect(() => {
    document.title = page.name === 'trip' ? `${page.search.fromLabel} to ${page.search.toLabel} · Transfers` : page.name === 'home' ? 'Transfers' : `${page.name[0]!.toUpperCase()}${page.name.slice(1)} · Transfers`;
  }, [page]);
  // Under first, then the screen showing, so a step either way never moves one in the page,
  // which would lose its scroll. One whose place the screen showing is taking lies between.
  const layers = [...(under ? [under] : []), ...(outgoing ? [outgoing] : []), current];
  return (
    <SettingsProvider>
      <div ref={app} class="tf-app" data-entering={entering ? 'true' : undefined} data-swapping={swapping ? 'true' : undefined} data-held={held ? 'true' : undefined} data-peeking={peeking ? 'true' : undefined}>
        <TrackProvider>
          {layers.map((layer) => {
            const showing = layer === current;
            return (
              <div key={layer.id} class={showing ? 'tf-layer' : layer === outgoing ? 'tf-outgoing' : 'tf-peek'} aria-hidden={showing ? undefined : 'true'} inert={!showing}>
                <ScreenActive.Provider value={showing}>{screenFor(layer)}</ScreenActive.Provider>
                {!showing && <div class="tf-peek__dim" />}
              </div>
            );
          })}
        </TrackProvider>
      </div>
    </SettingsProvider>
  );
}

render(<App />, document.getElementById('app')!);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
}
