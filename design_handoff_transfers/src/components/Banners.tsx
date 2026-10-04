import { IconOffline, IconWarn } from '../icons/ui';

export function OfflineBanner({ statusText }: { statusText: string }) {
  return (
    <div className="tf-banner tf-banner--offline" role="status">
      <IconOffline />
      <div><div className="tf-banner__title">{statusText}</div>
        <div className="tf-banner__body">Showing the last results. Countdowns keep running on your phone and will correct when you reconnect.</div></div>
    </div>
  );
}

/** One agency's live feed is down; others still live. */
export function FeedOutageBanner({ agency, routes, liveAgencies }: { agency: string; routes: string; liveAgencies: string }) {
  return (
    <div className="tf-banner tf-banner--outage" role="status">
      <IconWarn size={22} />
      <div><div className="tf-banner__title">{agency} live data is unavailable</div>
        <div className="tf-banner__body">{routes} times below are from the schedule. {liveAgencies} predictions are still live.</div></div>
    </div>
  );
}
