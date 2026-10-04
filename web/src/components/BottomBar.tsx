import { useRef } from 'preact/hooks';
import { useDrag } from '../gestures.ts';
import { IconSliders } from '../icons/ui.tsx';

// How far up a swipe on the bar goes before it opens the settings, or how fast, in px per ms.
const OPEN_PX = 28;
const OPEN_FLING = 0.4;

// Thumb-reach control on the results screen: one button, or a swipe up, opens the trip's
// settings. It shows the transfer window, the setting riders change most.
// windowText is null when nothing on the page has a transfer window, such as when the route
// already stops where the rider is.
export function BottomBar({ windowText, onOpen }: { windowText: string | null; onOpen: () => void }) {
  const bar = useRef<HTMLElement>(null);
  const opened = useRef(false);
  const open = () => {
    if (opened.current) return;
    opened.current = true;
    onOpen();
  };
  useDrag(() => bar.current, 'y', {
    claim: (direction) => {
      opened.current = false;
      return direction === 'up';
    },
    move: (dy) => dy <= -OPEN_PX && open(),
    end: (release) => release && -release.velocity >= OPEN_FLING && open(),
  });
  return (
    <nav class="tf-bottombar" aria-label="Trip controls" ref={bar}>
      <div class="tf-grabber" aria-hidden="true" />
      <div class="tf-bottombar__inner">
        <button type="button" class="tf-btn-outline tf-bottombar__open" onClick={onOpen}>
          {windowText !== null && <span class="tf-sr">Trip settings: </span>}
          <span class="tf-muted">{windowText === null ? 'Trip settings' : 'Transfer window'}</span>
          <span class="tf-bottombar__value">
            {windowText !== null && <strong>{windowText}</strong>}
            <IconSliders />
          </span>
        </button>
      </div>
    </nav>
  );
}
