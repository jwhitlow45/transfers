import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { FeedState } from '../hooks.ts';
import { ageShort } from '../lib/freshness.ts';
import { GerbilShape, IconBack, IconNewVersion } from '../icons/ui.tsx';
import { forceRefresh, useUpdateAvailable } from '../update.ts';
import { motionOff } from '../gestures.ts';
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

// One item of the status line: a symbol and a short value, with the full sentence on tap, or with
// `onPress`, an action of its own.
export type StatusItem = { key: string; icon: ComponentChildren; short: ComponentChildren; full: string; onPress?: () => void };
// A request the server refused, in the status line's short and full words.
export type Failure = { short: string; full: string };

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
// `failed` replaces the live item when the server answered with an error, such as for a stop no
// longer in the schedule: the times on screen, if any, are not live, and nothing new is coming.
export function LiveStatus({ feed, secondsSinceUpdate, stale, failed = null, items = [] }: {
  feed: FeedState;
  secondsSinceUpdate: number | null;
  stale?: boolean;
  failed?: Failure | null;
  items?: StatusItem[];
}) {
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
  const tone = failed ? 'failed' : feed === 'offline' ? 'offline' : stale ? 'stale' : 'live';
  const age = secondsSinceUpdate === null ? null : ageShort(secondsSinceUpdate);
  const live: StatusItem = failed
    ? { key: 'live', icon: <span class="tf-dot" />, short: failed.short, full: failed.full }
    : {
        key: 'live',
        icon: <span class="tf-dot" />,
        short: feed === 'loading' ? 'Loading' : feed === 'offline' ? `Offline${age ? ` · ${age}` : ''}` : (age ?? 'Live'),
        full: liveStatusSentence(feed, secondsSinceUpdate, stale ?? false),
      };
  // A failure is the page's to announce, where it says what to do.
  const announcement = failed
    ? ''
    : feed === 'offline'
      ? 'Offline, showing the last results'
      : stale
        ? 'Live times are out of date'
        : feed === 'loading'
          ? 'Loading'
          : update
            ? 'An update to Transfers is available'
            : '';
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

// Sticky header for every screen: back, a title, and the live status. Results and Home leave out
// onBack, Results since its back button sits in the bottom bar. Home sets its own title row's end.
// Screens with live data pass onRefresh to be refreshed by pulling down. Every screen lays the
// title and status out the same, so moving between them does not shift either.
export function ScreenHeader({ title, end, feed, secondsSinceUpdate, stale, failed, items, accent, onBack, onRefresh }: {
  title: ComponentChildren;
  end?: ComponentChildren;
  stale?: boolean;
  failed?: Failure | null;
  items?: StatusItem[];
  // A saved search's color, as a stripe under the header.
  accent?: string | undefined;
  feed?: FeedState;
  secondsSinceUpdate?: number | null;
  onBack?: () => void;
  onRefresh?: () => void;
}) {
  const loading = feed === 'refreshing' || feed === 'loading';
  return (
    <header class={`tf-header${onBack ? '' : ' tf-header--no-back'}`} style={accent ? { '--saved-color': accent } : undefined} data-accent={accent ? 'true' : undefined}>
      <div class="tf-header__row">
        {onBack && (
          <button type="button" class="tf-btn-icon" onClick={onBack} aria-label="Back to search">
            <IconBack />
          </button>
        )}
        <h1 class="tf-chain">{title}</h1>
        {end}
      </div>
      {feed && (
        <LiveStatus feed={feed} secondsSinceUpdate={secondsSinceUpdate ?? null} stale={stale ?? false} failed={failed ?? null} items={items ?? []} />
      )}
      {/* The saved color and the loading bar share the few pixels under the header, where neither
          moves the page as a search is saved or loads. While loading, the saved color is the bar. */}
      <HeaderEdge loading={loading} />
      {onRefresh && <PullToRefresh onRefresh={onRefresh} />}
    </header>
  );
}

// An easter egg: about one time in twenty that the bar appears, a gerbil rides it.
const GERBIL_ODDS = 1 / 20;

// Under the header, always there, so a gerbil can finish its run after loading ends.
function HeaderEdge({ loading }: { loading: boolean }) {
  // Decided when loading starts, so the same gerbil rides until the bar goes away.
  const run = useRef({ loading: false, gerbil: false });
  const [, ended] = useState(0);
  if (loading && !run.current.loading) run.current.gerbil = !motionOff() && Math.random() < GERBIL_ODDS;
  run.current.loading = loading;
  // A gerbil crosses the whole screen, and the bar it rides stays with it, rather than both
  // vanishing mid-stride, which would look like a failed load (J, 2026-10-08).
  const gerbil = run.current.gerbil;
  // Each crossing, rather than each trot of its legs, whose iterations bubble up from the svg.
  const finishRun = (event: AnimationEvent) => {
    if (event.target !== event.currentTarget || run.current.loading) return;
    run.current.gerbil = false;
    ended((count) => count + 1);
  };
  return (
    <div class={`tf-header__edge${loading || gerbil ? ' tf-header__edge--loading' : ''}${gerbil ? ' tf-header__edge--gerbil' : ''}`} aria-hidden="true">
      {gerbil && (
        <span class="tf-gerbil" onAnimationIteration={finishRun}>
          <svg width="20" height="13" viewBox="0 6.5 23 15" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <GerbilShape />
          </svg>
        </span>
      )}
    </div>
  );
}

// The trip as a chain: From → where to get off (worked out by the app) → the second route. Each
// arrow stays with the name it leads to. On phones From has the first line and the rest the
// second, whether or not the app has found where to get off, so the header keeps its height as
// results arrive or a direction is chosen. Each line ends in an ellipsis rather than wrap, the
// place to get off giving way first.
export function TripChain({ from, via, to }: { from: string; via: string | null; to: ComponentChildren }) {
  // Laid out as words wrap, each arrow kept with its name, so "Montgomery St → 24th St Mission"
  // shares a line when it fits (J, 2026-10-08). Only where that would take three lines does From
  // take the first line alone and the rest the second, trimmed to fit, so the header never grows
  // past two. Measured before paint, and again when the header's width changes.
  const first = useRef<HTMLSpanElement>(null);
  const [stacked, setStacked] = useState(false);
  // A new trip or place to get off is laid out afresh.
  useLayoutEffect(() => setStacked(false), [from, via]);
  useLayoutEffect(() => {
    if (stacked) return;
    const items = [first.current, ...(first.current?.parentElement?.querySelectorAll<HTMLElement>('.tf-chain__step') ?? [])];
    const lines = new Set(items.map((item) => Math.round(item?.getBoundingClientRect().top ?? 0))).size;
    if (lines > 2) setStacked(true);
  });
  useEffect(() => {
    const title = first.current?.parentElement;
    if (!title || typeof ResizeObserver === 'undefined') return;
    let width = title.getBoundingClientRect().width;
    const observer = new ResizeObserver(([entry]) => {
      if (Math.abs(entry!.contentRect.width - width) < 1) return;
      width = entry!.contentRect.width;
      setStacked(false);
    });
    observer.observe(title);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <span class="tf-chain__from" ref={first}>
        {from}
      </span>
      <span class={`tf-chain__rest${stacked ? ' tf-chain__rest--stacked' : ''}`}>
        {via && (
          <span class="tf-chain__step tf-chain__step--via">
            <span class="tf-chain__arrow" aria-hidden="true">
              →
            </span>
            <span class="tf-chain__derived" title="Transfer point worked out by Transfers">
              {via}
              <span class="tf-sr"> (transfer point found for you)</span>
            </span>
          </span>
        )}
        <span class="tf-chain__step">
          <span class="tf-chain__arrow" aria-hidden="true">
            →
          </span>
          {to}
        </span>
      </span>
    </>
  );
}
