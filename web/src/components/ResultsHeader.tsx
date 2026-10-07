import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { FeedState } from '../hooks.ts';
import { ageShort } from '../lib/freshness.ts';
import { IconBack, IconNewVersion } from '../icons/ui.tsx';
import { forceRefresh, useUpdateAvailable } from '../update.ts';
import { PullToRefresh } from './PullToRefresh.tsx';

// secondsSinceUpdate counts from when the server got the data from 511, not when this page
// fetched it, so it says how old the times on screen really are.
export function liveStatusText(feed: FeedState, secondsSinceUpdate: number | null) {
  const ago = (seconds: number) => (seconds < 60 ? `${seconds} s ago` : `${Math.floor(seconds / 60)} min ago`);
  if (feed === 'offline') return secondsSinceUpdate === null ? 'Offline' : `Offline, updated ${ago(secondsSinceUpdate)}`;
  if (feed === 'loading') return 'Loading';
  if (feed === 'refreshing') return 'Refreshing…';
  return secondsSinceUpdate === null ? 'Live' : `Updated ${ago(secondsSinceUpdate)}`;
}

// The same for a screen with no status line, such as Home.
export function UpdateButton() {
  const update = useUpdateAvailable();
  if (!update) return null;
  return (
    <button type="button" class="tf-stat__button tf-update-button" aria-label={UPDATE.full} onClick={UPDATE.onPress}>
      <span class="tf-stat__icon" aria-hidden="true">
        {UPDATE.icon}
      </span>
      <span class="tf-stat__value" aria-hidden="true">
        {UPDATE.short}
      </span>
    </button>
  );
}

// One item of the status line: a symbol and a short value, with the full sentence on tap, or with
// `onPress`, an action of its own.
export type StatusItem = { key: string; icon: ComponentChildren; short: ComponentChildren; full: string; onPress?: () => void };

// A newer version of the site than this page, as an item of its own: nothing is wrong, so not a
// warning, and underlined as the app's other tappable text is. A tap loads the new version the
// same way as Settings' Force refresh.
// Narrower phones drop " available", and the narrowest the words (see styles.css).
const UPDATE: StatusItem = {
  key: 'update',
  icon: <IconNewVersion size={16} />,
  short: (
    <>
      Update<span class="tf-update-more"> available</span>
    </>
  ),
  full: 'Update available. Tap to load the new version of Transfers',
  onPress: () => void forceRefresh(),
};

// The live status as one line of short items. Each one opens its full sentence on tap, and
// screen readers hear the full sentence as its name. Only changes of state are announced: the
// age ticking every second would otherwise be read out constantly.
export function LiveStatus({ feed, secondsSinceUpdate, stale, items = [] }: { feed: FeedState; secondsSinceUpdate: number | null; stale?: boolean; items?: StatusItem[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const line = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open === null) return;
    const close = (event: PointerEvent) => {
      if (!line.current?.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const update = useUpdateAvailable();
  const tone = feed === 'offline' ? 'offline' : stale ? 'stale' : 'live';
  const age = secondsSinceUpdate === null ? null : ageShort(secondsSinceUpdate);
  const live: StatusItem = {
    key: 'live',
    icon: <span class="tf-dot" />,
    short: feed === 'loading' ? 'Loading' : feed === 'offline' ? `Offline${age ? ` · ${age}` : ''}` : (age ?? 'Live'),
    full: liveStatusSentence(feed, secondsSinceUpdate, stale ?? false),
  };
  const announcement = feed === 'offline' ? 'Offline, showing the last results' : stale ? 'Live times are out of date' : feed === 'loading' ? 'Loading' : update ? 'An update to Transfers is available' : '';
  return (
    <div class={`tf-livestatus tf-livestatus--${tone}`} ref={line}>
      <span class="tf-sr" role="status">
        {announcement}
      </span>
      {[live, ...items, ...(update ? [UPDATE] : [])].map((item) => (
        <span key={item.key} class={`tf-stat tf-stat--${item.key}`}>
          <button
            type="button"
            class="tf-stat__button"
            aria-label={item.full}
            aria-expanded={item.onPress ? undefined : open === item.key}
            onClick={item.onPress ?? (() => setOpen(open === item.key ? null : item.key))}
          >
            <span class="tf-stat__icon" aria-hidden="true">
              {item.icon}
            </span>
            <span class="tf-stat__value" aria-hidden="true">{item.short}</span>
          </button>
          {open === item.key && (
            <span class="tf-tip" role="tooltip">
              {item.full}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

// "1 minute", "12 seconds": spoken and tooltip ages, whole units like ageText.
function spokenAge(seconds: number) {
  const [count, unit] = seconds < 60 ? [seconds, 'second'] : seconds < 3600 ? [Math.floor(seconds / 60), 'minute'] : [Math.floor(seconds / 3600), 'hour'];
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

function liveStatusSentence(feed: FeedState, seconds: number | null, stale: boolean) {
  const ago = seconds === null ? null : `${spokenAge(seconds)} ago`;
  if (feed === 'loading') return 'Loading live times';
  if (feed === 'offline') return ago ? `Offline. Live times last updated ${ago}` : 'Offline';
  if (stale) return `Live times last updated ${ago}, so they may be out of date`;
  if (feed === 'refreshing') return ago ? `Refreshing. Live times last updated ${ago}` : 'Refreshing live times';
  return ago ? `Live times, updated ${ago}` : 'Live times';
}

// Sticky header for every screen but search: back, a title, and the live status. Results leave
// out onBack, since its back button sits in the bottom bar. Screens with live data pass
// onRefresh to be refreshed by pulling down.
export function ScreenHeader({ title, feed, secondsSinceUpdate, stale, items, accent, onBack, onRefresh }: {
  title: ComponentChildren;
  stale?: boolean;
  items?: StatusItem[];
  // A saved search's color, as a stripe along the top.
  accent?: string | undefined;
  feed?: FeedState;
  secondsSinceUpdate?: number | null;
  onBack?: () => void;
  onRefresh?: () => void;
}) {
  return (
    <header class={`tf-header${onBack ? '' : ' tf-header--no-back'}`} style={accent ? { '--saved-color': accent } : undefined} data-accent={accent ? 'true' : undefined}>
      <div class="tf-header__row">
        {onBack && (
          <button type="button" class="tf-btn-icon" onClick={onBack} aria-label="Back to search">
            <IconBack />
          </button>
        )}
        <h1 class="tf-chain">{title}</h1>
      </div>
      {feed && (
        <LiveStatus feed={feed} secondsSinceUpdate={secondsSinceUpdate ?? null} stale={stale ?? false} items={items ?? []} />
      )}
      {(feed === 'refreshing' || feed === 'loading') && <div class="tf-refresh-bar" aria-hidden="true" />}
      {onRefresh && <PullToRefresh onRefresh={onRefresh} />}
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
