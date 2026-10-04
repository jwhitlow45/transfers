import { IconOffline, IconWarn } from '../icons/ui.tsx';

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
