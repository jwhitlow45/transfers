import { useRef } from 'preact/hooks';
import { useVerticalDrag } from '../gestures.ts';
import { IconSliders } from '../icons/ui.tsx';

// How far up a swipe on the bar goes before it opens a sheet, or how fast, in px per ms.
const OPEN_PX = 28;
const OPEN_FLING = 0.4;

// Thumb-reach controls on the results screen. Swiping up on the bar opens the sheet of the
// button the swipe started on, or the transfer window from anywhere else.
// windowText is null when nothing on the page has a transfer window, such as when the route
// already stops where the rider is.
export function BottomBar({ windowText, onWindow, onSettings }: { windowText: string | null; onWindow: () => void; onSettings: () => void }) {
  const bar = useRef<HTMLElement>(null);
  const swipe = useRef<{ origin: Element; opened: boolean } | null>(null);
  const open = () => {
    if (!swipe.current || swipe.current.opened) return;
    swipe.current.opened = true;
    if (windowText === null || swipe.current.origin.closest('.tf-bottombar__settings')) onSettings();
    else onWindow();
  };
  useVerticalDrag(() => bar.current, {
    claim: (direction, origin) => {
      swipe.current = { origin, opened: false };
      return direction === 'up';
    },
    move: (dy) => dy <= -OPEN_PX && open(),
    end: (release) => release && -release.velocity >= OPEN_FLING && open(),
  });
  return (
    <nav class="tf-bottombar" aria-label="Trip controls" ref={bar}>
      <div class="tf-grabber" aria-hidden="true" />
      <div class="tf-bottombar__inner">
        {windowText !== null && (
          <button type="button" class="tf-btn-outline tf-bottombar__window" onClick={onWindow}>
            <span class="tf-muted">Transfer window</span>
            <strong>{windowText}</strong>
          </button>
        )}
        <button type="button" class="tf-btn-outline tf-bottombar__settings" onClick={onSettings} aria-label="Trip settings">
          <IconSliders />
        </button>
      </div>
    </nav>
  );
}
