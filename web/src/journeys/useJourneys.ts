import { useEffect, useState } from 'preact/hooks';
import { pointEnd, type JourneysResponse } from '../../../shared/journeys.ts';
import { apiUrl } from '../api.ts';
import { usePoll } from '../hooks.ts';
import { HERE } from '../lib/ends.ts';
import { type LocationProblem, type Position, locate } from '../lib/location.ts';
import { useSettings } from '../settings.tsx';
import type { Search } from '../storage.ts';

// The trips between a search's two ends, asked for while `active`. An end that is the rider's
// location is looked up first, and again with each refresh, as they may have moved. The answers
// are stored under the search, not the address, which holds where the phone was.
export function useJourneys(search: Pick<Search, 'from' | 'to' | 'fromLabel' | 'toLabel'>, active: boolean) {
  const { settings } = useSettings();
  const needsHere = search.from === HERE || search.to === HERE;
  const [here, setHere] = useState<Position | null>(null);
  const [problem, setProblem] = useState<LocationProblem | null>(null);
  const look = (maximumAge?: number) =>
    locate(maximumAge).then(
      (position) => {
        setProblem(null);
        setHere(position);
      },
      (reason: LocationProblem) => setProblem(reason),
    );
  useEffect(() => {
    if (active && needsHere && !here) void look();
  }, [active, needsHere]);
  const end = (key: string) => (key !== HERE ? key : here ? pointEnd(here.lat, here.lon) : null);
  const [from, to] = [end(search.from), end(search.to)];
  const url = active && from && to ? apiUrl.journeys(from, to, search.fromLabel, search.toLabel, settings) : null;
  const polled = usePoll<JourneysResponse>(url, 30_000, null, `journeys:${search.from}>${search.to}`);
  return {
    ...polled,
    // Waiting on the phone to say where the rider is, or why it cannot.
    locating: needsHere && !here && problem === null,
    problem,
    refresh: () => {
      if (needsHere) void look(0);
      polled.refresh();
    },
  };
}
