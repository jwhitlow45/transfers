import { useRef } from 'preact/hooks';
import { useDrag } from '../gestures.ts';
import { IconBack, IconBookmark, IconSliders } from '../icons/ui.tsx';

// How far up a swipe on the bar goes before it opens the settings, or how fast, in px per ms.
const OPEN_PX = 28;
const OPEN_FLING = 0.4;

// Thumb-reach controls on the results screen: back, the trip's settings, and saving the search.
// Back and save sit here rather than in the header, so the header has room for the trip. The
// settings open from the wide button, or a swipe up, which shows the transfer window, the
// setting riders change most.
// windowText is null when nothing on the page has a transfer window, such as when the route
// already stops where the rider is.
export function BottomBar({ windowText, saved, onBack, onOpen, onToggleSaved }: {
  windowText: string | null;
  saved: boolean;
  onBack: () => void;
  onOpen: () => void;
  onToggleSaved: () => void;
}) {
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
        <button type="button" class="tf-btn-outline tf-bottombar__icon" onClick={onBack} aria-label="Back to search">
          <IconBack />
        </button>
        <button type="button" class="tf-btn-outline tf-bottombar__open" onClick={onOpen}>
          {/* The name stays when the narrowest screens hide the visible label. */}
          <span class="tf-sr">{windowText === null ? 'Trip settings' : 'Trip settings: '}</span>
          {windowText === null ? (
            <span class="tf-muted tf-bottombar__label" aria-hidden="true">
              Trip settings
            </span>
          ) : (
            // Phones have room beside back and save only for the short label.
            <span class="tf-muted tf-bottombar__label">
              <span class="tf-bottombar__long">Transfer window</span>
              <span class="tf-bottombar__short">Window</span>
            </span>
          )}
          <span class="tf-bottombar__value">
            {windowText !== null && <strong>{windowText}</strong>}
            <IconSliders />
          </span>
        </button>
        <button type="button" class="tf-btn-outline tf-bottombar__icon" aria-pressed={saved} aria-label={saved ? 'Saved. Remove from saved searches' : 'Save this search'} onClick={onToggleSaved}>
          <IconBookmark filled={saved} />
        </button>
      </div>
    </nav>
  );
}
