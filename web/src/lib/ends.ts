import type { Search } from '../storage.ts';

// What a search's From or To names: a stop, a route, or wherever the rider is when the page opens
// (`HERE`), which the page looks up then, and again on each refresh, so a recent search from "Your
// location" still means where they are now.
export const HERE = '@here';
export const HERE_LABEL = 'Your location';

export type EndKind = 'stop' | 'route' | 'here';
export const endKind = (key: string): EndKind => (key === HERE ? 'here' : key.startsWith('route:') ? 'route' : 'stop');

// A trip that only the trip planner can answer, as the transfer results need a stop to start from
// (J, 2026-10-12).
export const isJourneySearch = (search: Pick<Search, 'from' | 'to'>) => search.to !== '' && [search.from, search.to].some((key) => endKind(key) === 'here');

// Both ends stops: the results offer trips there and the transfers at To, as two tabs.
export const isStopToStop = (search: Pick<Search, 'from' | 'to'>) => endKind(search.from) === 'stop' && search.to !== '' && endKind(search.to) === 'stop';
