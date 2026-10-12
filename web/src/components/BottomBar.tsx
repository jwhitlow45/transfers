import type { ComponentChildren } from 'preact';
import { IconBack, IconBookmark, IconSliders } from '../icons/ui.tsx';

// Thumb-reach controls on the results screen: back, the trip's settings, and saving the search.
// Back and save sit here rather than in the header, so the header has room for the trip. The
// settings button shows the transfer window, the setting riders change most. There is no swipe
// up to open them: an iPhone's swipe home starts on this bar and opened them on the way out.
// windowText is null when nothing on the page has a transfer window, such as when the route
// already stops where the rider is.
// `children` sit just above the bar, such as a toast, and slide with it when swiping back.
// `failed` says the trip has no results to set or save, such as for a stop no longer in the
// schedule. A search saved before then can still be removed.
// A stop's arrivals have no trip settings, so without `onOpen` the bar has back and save alone.
export function BottomBar({ windowText, saved, failed = false, onBack, onOpen, onToggleSaved, children }: {
  windowText: string | null;
  saved: boolean;
  failed?: boolean;
  onBack: () => void;
  onOpen?: () => void;
  // Without it there is nothing to save, as for trips from a place or the rider's location, which
  // Home's saved cards cannot follow.
  onToggleSaved?: () => void;
  children?: ComponentChildren;
}) {
  return (
    <nav class="tf-bottombar" aria-label="Trip controls">
      {children}
      <div class="tf-bottombar__inner">
        <button type="button" class="tf-btn-outline tf-bottombar__icon" onClick={onBack} aria-label="Back to search">
          <IconBack />
        </button>
        {!onOpen && <span class="tf-bottombar__fill" />}
        {onOpen && <button type="button" class="tf-btn-outline tf-bottombar__open" disabled={failed} onClick={onOpen}>
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
        </button>}
        {onToggleSaved && (
          <button type="button" class="tf-btn-outline tf-bottombar__icon" disabled={failed && !saved} aria-pressed={saved} aria-label={saved ? 'Saved. Remove from saved searches' : 'Save this search'} onClick={onToggleSaved}>
            <IconBookmark filled={saved} />
          </button>
        )}
      </div>
    </nav>
  );
}
