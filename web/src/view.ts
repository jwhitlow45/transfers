import type { AgencyId, Route, Stop } from '../../shared/api.ts';

import { chipLabel } from '../../shared/labels.ts';
import { clock, PACIFIC, stillWaiting } from './format.ts';

export { chipLabel, shortStopName, stopLabel } from '../../shared/labels.ts';

// How the interface names things, kept in one place so screens and spoken summaries agree.

const AGENCY_NAMES: Record<AgencyId, string> = { SF: 'Muni', BA: 'BART', SM: 'SamTrans', GG: 'Golden Gate Transit', GF: 'Golden Gate Ferry' };

export function agencyName(item: { agency: AgencyId; mode: Route['mode'] }) {
  if (item.agency === 'SF' && (item.mode === 'light-rail' || item.mode === 'streetcar')) return 'Muni Metro';
  return AGENCY_NAMES[item.agency];
}

export const agencyOnly = (agency: AgencyId) => AGENCY_NAMES[agency];

// A vehicle by its route and its time at a stop, such as "49 at 6:22 PM", as a map's title.
export const vehicleAt = (route: Route | undefined, at: number) => `${route ? chipLabel(route) : 'Vehicle'} at ${clock(at)}`;

// What a pin names, such as "the BART at 6:11 PM to the 49 at 6:22 PM": the same words wherever
// the trip is pinned, since an open map's sheet knows its pin by them.
export const pinLabel = (...vehicles: (readonly [Route | undefined, number])[]) => vehicles.map(([route, at]) => `the ${route ? chipLabel(route) : 'vehicle'} at ${clock(at)}`).join(' to ');

export const spokenRoute = (route: Route) => (route.agency === 'BA' ? `BART ${route.name} line` : `${agencyName(route)} ${route.name}`);

// The agency's own page for a stop, with its live arrivals: SFMTA's for a Muni stop, by the code
// on its sign, and bart.gov's for a BART station. SamTrans and Golden Gate have no page per stop.
export function stopPage(stop: Stop | undefined) {
  if (!stop) return null;
  if (stop.agency === 'SF' && stop.code) return `https://www.sfmta.com/${stop.code}`;
  if (stop.bart) return `https://www.bart.gov/stations/${stop.bart}`;
  return null;
}

export type StatusKind = 'late' | 'early' | 'ontime' | 'nodata' | 'scheduled' | 'canceled' | 'waiting';
export type Status = { kind: StatusKind; label: string };

// "3 min late" stays on one line, so a status too long for its line breaks after "Not left,".
const NB = '\u00a0';

// The feed's delay rounded to the nearest minute. A vehicle yet to leave the first stop of its trip
// is on time only by the feed's assumption, so it says it has not left (J, 2026-11-09), and how late
// or early the feed has it, as neither is ever hidden.
export function statusOf(delaySeconds: number | null, live = true, canceled = false, notStarted = false): Status {
  if (canceled) return { kind: 'canceled', label: 'Canceled' };
  if (!live) return { kind: 'scheduled', label: 'Scheduled' };
  if (notStarted) {
    const minutes = delaySeconds === null ? 0 : Math.round(delaySeconds / 60);
    if (minutes > 0) return { kind: 'late', label: `Not${NB}left, ${minutes}${NB}min${NB}late` };
    if (minutes < 0) return { kind: 'early', label: `Not${NB}left, ${-minutes}${NB}min${NB}early` };
    return { kind: 'waiting', label: `Not${NB}left${NB}yet` };
  }
  if (delaySeconds === null) return { kind: 'nodata', label: 'No delay data' };
  const minutes = Math.round(delaySeconds / 60);
  if (minutes > 0) return { kind: 'late', label: `${minutes}${NB}min${NB}late` };
  if (minutes < 0) return { kind: 'early', label: `${-minutes}${NB}min${NB}early` };
  return { kind: 'ontime', label: 'On time' };
}

// A vehicle's status beside a countdown to its time at a stop. It says it has not left only while
// it is held as coming (see stillWaiting). Past that hold its row counts it as gone, and would
// otherwise say "Not left yet" beside "Left 32 min ago".
export const statusAt = (unixSeconds: number, nowMs: number, delaySeconds: number | null, live = true, canceled = false, notStarted = false) =>
  statusOf(delaySeconds, live, canceled, stillWaiting(unixSeconds, nowMs, notStarted));

export function directionText(stop: Stop | undefined, toward: string | undefined) {
  return [stop?.direction, toward && `toward ${toward}`].filter(Boolean).join(', ');
}

export function windowText(window: { min: number; max: number }) {
  return `${window.min}–${window.max}\u00a0min`;
}

// A Pacific day as "2026-10-09", which Date.parse reads.
const isoDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: PACIFIC });

// "Today", "Yesterday", a weekday within the week, or a date.
export function dayLabel(atMs: number, nowMs: number) {
  const day = (ms: number) => isoDayFormat.format(ms);
  const days = Math.round((Date.parse(day(nowMs)) - Date.parse(day(atMs))) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const options: Intl.DateTimeFormatOptions = days < 7 ? { weekday: 'long' } : { month: 'short', day: 'numeric' };
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: PACIFIC }).format(atMs);
}
