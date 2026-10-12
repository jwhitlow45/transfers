import type { JourneysResponse } from '../../../shared/journeys.ts';
import { AlertList } from '../components/AlertList.tsx';
import { AppLink } from '../components/AppLink.tsx';
import { FeedOutages } from '../components/Banners.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { SkeletonResults } from '../components/SkeletonResults.tsx';
import type { ViewAlert } from '../lib/alerts.ts';
import { viewAlerts } from '../lib/alerts.ts';
import { failureOf } from '../lib/failure.ts';
import { locationProblemText } from '../lib/location.ts';
import { useSettings } from '../settings.tsx';
import type { Search } from '../storage.ts';
import { JourneyList } from './JourneyList.tsx';
import type { useJourneys } from './useJourneys.ts';

export type JourneyResultsProps = {
  journeys: ReturnType<typeof useJourneys>;
  search: Search;
  now: number;
  dismissedIds: Set<string>;
  onDismiss: (alert: ViewAlert) => void;
};

// What a page says of the trips between its search's ends, on their own page or a results tab:
// why there are none, where the phone could not say where the rider is, the feeds and alerts
// behind them, and the trips themselves.
export function JourneyResults({ journeys, search, now, dismissedIds, onDismiss }: JourneyResultsProps) {
  const { settings } = useSettings();
  const { data, error, feed, locating, problem } = journeys;
  const failure = failureOf(error, 'Trips');
  const allAlerts = data ? viewAlerts(data, ridden(data), { elevators: settings.stepFree, escalators: settings.escalatorOutages }) : [];
  const alerts = allAlerts.filter(({ id }) => !dismissedIds.has(id));
  return (
    <>
      {problem && <EmptyState alert title={locationProblemText(problem)} />}
      {failure && (
        <EmptyState alert title={failure.text}>
          <AppLink class="tf-link-button" href="/" back>
            Search again
          </AppLink>
        </EmptyState>
      )}
      {data && <FeedOutages feeds={data.feeds} routeKeys={data.journeys.flatMap(({ legs }) => legs.flatMap((leg) => (leg.kind === 'ride' ? [leg.route] : [])))} routes={data.routes} />}
      {data && <AlertList key={`${search.from}>${search.to}`} alerts={alerts} dismissed={allAlerts.length - alerts.length} onDismiss={onDismiss} />}
      {!data && !problem && !failure && (feed === 'loading' || locating) && <SkeletonResults />}
      {data && <JourneyList data={data} now={now} fromLabel={search.fromLabel} toLabel={search.toLabel} />}
    </>
  );
}

// Where the trips board and let the rider off, for the alerts that name them.
const ridden = (data: JourneysResponse) => new Set(data.journeys.flatMap(({ legs }) => legs.flatMap((leg) => (leg.kind === 'ride' ? [leg.from, leg.to] : []))));
