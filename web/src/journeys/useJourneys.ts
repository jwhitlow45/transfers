import type { JourneysResponse } from '../../../shared/journeys.ts';
import { apiUrl } from '../api.ts';
import { usePoll } from '../hooks.ts';
import { useSettings } from '../settings.tsx';
import type { Search } from '../storage.ts';

// The trips with any number of changes between a search's two stops, asked for only while
// `active`, as the transfer results show them only when no way there takes one change or none.
// Stored under their request, which names the rider's settings, as the transfer results' are.
export function useJourneys(search: Pick<Search, 'from' | 'to'>, active: boolean) {
  const { settings } = useSettings();
  return usePoll<JourneysResponse>(active ? apiUrl.journeys(search.from, search.to, settings) : null, 30_000);
}
