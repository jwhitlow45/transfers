import type { ComponentChildren } from 'preact';
import type { FeedState } from '../hooks.ts';
import { IconBack, IconBookmark } from '../icons/ui.tsx';

export function liveStatusText(feed: FeedState, secondsSinceUpdate: number | null) {
  const ago = (seconds: number) => (seconds < 60 ? `${seconds} s ago` : `${Math.floor(seconds / 60)} min ago`);
  if (feed === 'offline') return secondsSinceUpdate === null ? 'Offline' : `Offline, updated ${ago(secondsSinceUpdate)}`;
  if (feed === 'loading') return 'Loading';
  if (feed === 'refreshing') return 'Refreshing…';
  return secondsSinceUpdate === null ? 'Live' : `Updated ${ago(secondsSinceUpdate)}`;
}

export function LiveStatus({ feed, secondsSinceUpdate, children }: { feed: FeedState; secondsSinceUpdate: number | null; children?: ComponentChildren }) {
  return (
    <div class="tf-livestatus" role="status">
      <span class={`tf-livestatus__state${feed === 'offline' ? ' tf-livestatus__state--offline' : ''}`}>
        <span class="tf-dot" />
        {liveStatusText(feed, secondsSinceUpdate)}
      </span>
      {children}
    </div>
  );
}

// Sticky header for every screen but search: back, a title, and the live status.
export function ScreenHeader({ title, feed, secondsSinceUpdate, status, action, accent, onBack }: {
  title: ComponentChildren;
  // A saved search's color, as a stripe along the top.
  accent?: string | undefined;
  feed?: FeedState;
  secondsSinceUpdate?: number | null;
  status?: ComponentChildren;
  action?: ComponentChildren;
  onBack: () => void;
}) {
  return (
    <header class="tf-header" style={accent ? { '--saved-color': accent } : undefined} data-accent={accent ? 'true' : undefined}>
      <div class="tf-header__row">
        <button type="button" class="tf-btn-icon" onClick={onBack} aria-label="Back to search">
          <IconBack />
        </button>
        <h1 class="tf-chain">{title}</h1>
        {action}
      </div>
      {feed && (
        <LiveStatus feed={feed} secondsSinceUpdate={secondsSinceUpdate ?? null}>
          {status}
        </LiveStatus>
      )}
      {(feed === 'refreshing' || feed === 'loading') && <div class="tf-refresh-bar" aria-hidden="true" />}
    </header>
  );
}

// The trip as a chain: From → where to get off (worked out by the app) → the second route.
export function TripChain({ from, via, to }: { from: string; via: string | null; to: ComponentChildren }) {
  return (
    <>
      <span>{from}</span>
      <span class="tf-chain__arrow" aria-hidden="true">
        →
      </span>
      {via && (
        <>
          <span class="tf-chain__derived" title="Transfer point worked out by Transfers">
            {via}
            <span class="tf-sr"> (transfer point found for you)</span>
          </span>
          <span class="tf-chain__arrow" aria-hidden="true">
            →
          </span>
        </>
      )}
      {to}
    </>
  );
}

export function SaveButton({ saved, onToggle }: { saved: boolean; onToggle: () => void }) {
  return (
    <button type="button" class="tf-btn-icon tf-header__action" aria-pressed={saved} aria-label={saved ? 'Saved. Remove from saved searches' : 'Save this search'} onClick={onToggle}>
      <IconBookmark filled={saved} />
    </button>
  );
}
