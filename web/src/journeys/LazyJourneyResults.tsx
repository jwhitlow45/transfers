import { useEffect, useState } from 'preact/hooks';
import { EmptyState } from '../components/EmptyState.tsx';
import { SkeletonResults } from '../components/SkeletonResults.tsx';
import type { JourneyResultsProps } from './JourneyResults.tsx';

// The trips come with their own chunk, as most visits only ever see transfers. One that cannot load,
// as offline before it was ever fetched, or after a deploy replaced it, says so and can try again,
// as the live map's does.
type Results = (props: JourneyResultsProps) => preact.JSX.Element;
let loading: Promise<Results> | null = null;
const loadResults = () =>
  (loading ??= import('./JourneyResults.tsx').then(
    (module) => module.JourneyResults,
    (error: unknown) => {
      loading = null;
      throw error;
    },
  ));

export function LazyJourneyResults(props: JourneyResultsProps) {
  const [results, setResults] = useState<{ Results: Results } | 'failed' | null>(null);
  const load = () => {
    setResults(null);
    loadResults().then(
      (Results) => setResults({ Results }),
      () => setResults('failed'),
    );
  };
  useEffect(load, []);
  if (results === 'failed') {
    return (
      <EmptyState alert title="Can’t load trips. Check your connection.">
        <button type="button" class="tf-btn-outline tf-btn-secondary" onClick={load}>
          Retry
        </button>
      </EmptyState>
    );
  }
  return results ? <results.Results {...props} /> : <SkeletonResults />;
}
