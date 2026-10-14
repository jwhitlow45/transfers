import type { AgencyId, FeedStatus, Route } from '../../../shared/api.ts';
import type { FeedState } from '../hooks.ts';
import { IconOffline, IconWarn } from '../icons/ui.tsx';
import { type Freshness, ageText } from '../lib/freshness.ts';
import { agencyOnly, chipLabel } from '../view.ts';
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

// A banner for each agency whose live feed is down while others still work, as its times are then
// the schedule's. A stale feed's times are old predictions, not the schedule's, which StaleBanner
// says. `routeKeys` are the routes the page shows, which each banner names those of its agency from.
export function FeedOutages({ feeds, routeKeys, routes }: { feeds: FeedStatus[]; routeKeys: string[]; routes: Record<string, Route> }) {
  const liveAgencies = feeds
    .filter(({ state }) => state === 'live')
    .map(({ agency }) => agencyOnly(agency))
    .join(' and ');
  const routesOf = (agency: AgencyId) => [...new Set(routeKeys.filter((key) => key.startsWith(`${agency}:`)).map((key) => (routes[key] ? chipLabel(routes[key]) : key)))].join(', ');
  return (
    <>
      {feeds
        .filter(({ state }) => state === 'down')
        .map(({ agency }) => (
          <FeedOutageBanner key={agency} agency={agencyOnly(agency)} routes={routesOf(agency)} liveAgencies={liveAgencies} />
        ))}
    </>
  );
}

function FeedOutageBanner({ agency, routes, liveAgencies }: { agency: string; routes: string; liveAgencies: string }) {
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
