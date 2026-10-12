import { useEffect } from 'preact/hooks';
import { BottomBar } from '../components/BottomBar.tsx';
import { DataCredit } from '../components/DataCredit.tsx';
import { LiveBanners } from '../components/Banners.tsx';
import { ScreenHeader, TripChain } from '../components/ResultsHeader.tsx';
import { Toast, useToast } from '../components/Toast.tsx';
import { useSwipeBack } from '../gestures.ts';
import { useNow } from '../hooks.ts';
import { LazyJourneyResults } from '../journeys/LazyJourneyResults.tsx';
import { useJourneys } from '../journeys/useJourneys.ts';
import { endKind } from '../lib/ends.ts';
import { failureOf } from '../lib/failure.ts';
import { liveClock } from '../lib/freshness.ts';
import { useSearchRecords } from '../records.ts';
import { goBack } from '../router.ts';
import { type Search, rememberRecent } from '../storage.ts';

// Trips from or to a place or wherever the rider is, which only the trip planner answers (J,
// 2026-10-12). Opened again from Recent, a trip from where the rider is starts wherever they are
// then, as the page looks it up each time.
export function JourneysScreen({ search }: { search: Search }) {
  const journeys = useJourneys(search, true);
  const { data, error, fetchedAt, feed, settled, refresh } = journeys;
  const { now, fresh, showStale, secondsSinceUpdate } = liveClock({ data, fetchedAt, settled }, useNow());
  useSwipeBack(() => goBack());
  useEffect(() => {
    if (data) rememberRecent(search);
  }, [Boolean(data)]);
  const { toast, show: showToast, clear: clearToast } = useToast();
  // The notices dismissed, as on results.
  const { dismissedIds, dismiss } = useSearchRecords(search, showToast);
  const failure = failureOf(error, 'Trips');
  return (
    <>
      <div class="tf-scroll">
        <ScreenHeader
          title={<TripChain from={search.fromLabel} via={null} to={<span>{search.toLabel}</span>} />}
          feed={feed}
          secondsSinceUpdate={secondsSinceUpdate}
          stale={showStale}
          failed={failure}
          onRefresh={refresh}
        />
        <main class="tf-page" id="main">
          <LiveBanners feed={feed} fresh={fresh} showStale={showStale} secondsSinceUpdate={secondsSinceUpdate} />
          <LazyJourneyResults journeys={journeys} search={search} now={now} dismissedIds={dismissedIds} onDismiss={dismiss} />
          <DataCredit places={[search.from, search.to].some((key) => endKind(key) === 'place')} />
        </main>
      </div>
      <BottomBar windowText={null} saved={false} failed={failure !== null && !data} onBack={() => goBack()}>
        <Toast message={toast} onDone={clearToast} />
      </BottomBar>
    </>
  );
}

