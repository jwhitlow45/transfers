import { useEffect, useState } from 'preact/hooks';
import { SkeletonResults } from '../components/SkeletonResults.tsx';
import type { JourneyResultsProps } from './JourneyResults.tsx';

// The trips come with their own chunk, as most visits only ever see transfers.
type Results = (props: JourneyResultsProps) => preact.JSX.Element;
let loading: Promise<Results> | null = null;
const loadResults = () => (loading ??= import('./JourneyResults.tsx').then((module) => module.JourneyResults));

export function LazyJourneyResults(props: JourneyResultsProps) {
  const [results, setResults] = useState<{ Results: Results } | null>(null);
  useEffect(() => {
    void loadResults().then((Results) => setResults({ Results }));
  }, []);
  return results ? <results.Results {...props} /> : <SkeletonResults />;
}
