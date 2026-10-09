import type { FeedState } from '../hooks.ts';
import { IconOffline, IconWarn } from '../icons/ui.tsx';
import { type Freshness, ageText } from '../lib/freshness.ts';
import { liveStatusText } from './ResultsHeader.tsx';

export function OfflineBanner({ statusText }: { statusText: string }) {
  return (
    <div class="tf-banner tf-banner--offline" role="status">
      <IconOffline />
      <div>
        <div class="tf-banner__title">{statusText}</div>
        <div class="tf-banner__body">Showing the last results. Countdowns keep running on your phone and will correct when you reconnect.</div>
      </div>
    </div>
  );
}

// One agency's live feed is down while others still work.
export function FeedOutageBanner({ agency, routes, liveAgencies }: { agency: string; routes: string; liveAgencies: string }) {
  return (
    <div class="tf-banner tf-banner--outage" role="status">
      <IconWarn size={22} />
      <div>
        <div class="tf-banner__title">{agency} live data is unavailable</div>
        <div class="tf-banner__body">
          {routes ? `${routes} times below are from the schedule.` : 'Times below are from the schedule.'}
          {liveAgencies ? ` ${liveAgencies} predictions are still live.` : ''}
        </div>
      </div>
    </div>
  );
}

// Live data more than a minute old. Says whose end the problem is on, since the rider can fix
// one (their connection) and only wait out the other (511).
export function StaleBanner({ ageText, cause }: { ageText: string; cause: 'connection' | 'source' }) {
  return (
    <div class="tf-banner tf-banner--outage" role="alert">
      <IconWarn size={22} />
      <div>
        <div class="tf-banner__title">Live times are {ageText} old</div>
        <div class="tf-banner__body">
          {cause === 'connection'
            ? "This phone hasn't reached Transfers lately. Countdowns keep running and will correct when you reconnect."
            : "511 hasn't sent fresh predictions lately, so vehicles may be earlier or later than shown."}
        </div>
      </div>
    </div>
  );
}

// Offline, or times old enough to warn about, as every live page says it.
export function LiveBanners({ feed, fresh, showStale, secondsSinceUpdate }: { feed: FeedState; fresh: Freshness; showStale: boolean; secondsSinceUpdate: number | null }) {
  if (feed === 'offline') return <OfflineBanner statusText={liveStatusText(feed, secondsSinceUpdate)} />;
  return showStale && fresh.ageSeconds !== null && fresh.cause ? <StaleBanner ageText={ageText(fresh.ageSeconds)} cause={fresh.cause} /> : null;
}
