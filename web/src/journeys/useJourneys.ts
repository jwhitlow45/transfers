import { useEffect, useRef, useState } from 'preact/hooks';
import { pointEnd, type JourneysResponse } from '../../../shared/journeys.ts';
import { apiUrl } from '../api.ts';
import { usePoll } from '../hooks.ts';
import { HERE } from '../lib/ends.ts';
import { type LocationProblem, locate } from '../lib/location.ts';
import { useSettings } from '../settings.tsx';
import type { Search } from '../storage.ts';

// How often the phone is asked again where the rider is, as they may be walking, with the poll.
const LOOK_MS = 30_000;

// The trips between a search's two ends, asked for while `active`. An end that is the rider's
// location is looked up first, again with each refresh, and again as the trips refresh, so a rider
// on the move gets trips from where they are. Those answers are never stored: one from where the
// rider was is no answer for where they are. Other searches' answers are stored under the search,
// as a refresh asks the same thing.
export function useJourneys(search: Pick<Search, 'from' | 'to' | 'fromLabel' | 'toLabel'>, active: boolean) {
  const { settings } = useSettings();
  const needsHere = search.from === HERE || search.to === HERE;
  // Where the rider is, as the request names it, rounded so a little GPS drift asks nothing new.
  const [here, setHere] = useState<string | null>(null);
  const [problem, setProblem] = useState<LocationProblem | null>(null);
  const latestHere = useRef(here);
  latestHere.current = here;
  // Resolves once the phone answers, with whether the rider has moved enough to ask anew.
  const look = (maximumAge?: number) =>
    locate(maximumAge).then(
      ({ lat, lon }) => {
        const next = pointEnd(lat, lon);
        setProblem(null);
        setHere(next);
        return next !== latestHere.current;
      },
      (reason: LocationProblem) => {
        setProblem(reason);
        return false;
      },
    );
  useEffect(() => {
    if (!active || !needsHere) return;
    void look();
    const timer = setInterval(() => void look(LOOK_MS), LOOK_MS);
    return () => clearInterval(timer);
  }, [active, needsHere]);
  const end = (key: string) => (key !== HERE ? key : here);
  const [from, to] = [end(search.from), end(search.to)];
  const url = active && from && to ? apiUrl.journeys(from, to, search.fromLabel, search.toLabel, settings) : null;
  const polled = usePoll<JourneysResponse>(url, 30_000, null, needsHere ? false : `journeys:${search.from}>${search.to}`);
  return {
    ...polled,
    // Waiting on the phone to say where the rider is, or why it cannot.
    locating: needsHere && !here && problem === null,
    problem,
    // A new place asks by itself, through the new address. The same place asks again here.
    refresh: () => {
      if (!needsHere) return polled.refresh();
      void look(0).then((moved) => moved || polled.refresh());
    },
  };
}
