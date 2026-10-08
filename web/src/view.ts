import type { AgencyId, Route, Stop } from '../../shared/api.ts';

// How the interface names things, kept in one place so screens and spoken summaries agree.

const AGENCY_NAMES: Record<AgencyId, string> = { SF: 'Muni', BA: 'BART', SM: 'SamTrans', GG: 'Golden Gate Transit', GF: 'Golden Gate Ferry' };

export function agencyName(item: { agency: AgencyId; mode: Route['mode'] }) {
  if (item.agency === 'SF' && (item.mode === 'light-rail' || item.mode === 'streetcar')) return 'Muni Metro';
  return AGENCY_NAMES[item.agency];
}

export const agencyOnly = (agency: AgencyId) => AGENCY_NAMES[agency];

// Chips say "BART" without the line color, which the chip shows and the spoken summary says.
export const chipLabel = (route: Route) => (route.agency === 'BA' ? 'BART' : route.name);

export const spokenRoute = (route: Route) => (route.agency === 'BA' ? `BART ${route.name} line` : `${agencyName(route)} ${route.name}`);

// The agency's own page for a stop, with its live arrivals: SFMTA's for a Muni stop, by the code
// on its sign, and bart.gov's for a BART station. SamTrans and Golden Gate have no page per stop.
export function stopPage(stop: Stop | undefined) {
  if (!stop) return null;
  if (stop.agency === 'SF' && stop.code) return `https://www.sfmta.com/${stop.code}`;
  if (stop.bart) return `https://www.bart.gov/stations/${stop.bart}`;
  return null;
}

// BART's station names are long ("24th Street / Mission"). Headers use the short form riders say.
export function shortStopName(stop: Stop | undefined, fallback = '') {
  if (!stop) return fallback;
  if (stop.agency === 'SF') {
    // Muni's platform names: "Metro Civic Center Station/Outbd" is Civic Center Station.
    const station = stop.name.match(/^(?:Metro )?(.+? Station)(?:\/.*| (?:Outbound|Inbound|Northbound|Southbound|Downtown))?$/);
    return station ? station[1]! : stop.name;
  }
  if (stop.agency !== 'BA') return stop.name;
  const name = stop.name.replace(/\bStreet\b/g, 'St');
  const [first, second] = name.split(' / ');
  if (!second) return name;
  return /^\d/.test(first!) ? `${first} ${second}` : first!;
}

export type StatusKind = 'late' | 'early' | 'ontime' | 'nodata' | 'scheduled' | 'canceled';
export type Status = { kind: StatusKind; label: string };

// The feed's delay rounded to the nearest minute.
export function statusOf(delaySeconds: number | null, live = true, canceled = false): Status {
  if (canceled) return { kind: 'canceled', label: 'Canceled' };
  if (!live) return { kind: 'scheduled', label: 'Scheduled' };
  if (delaySeconds === null) return { kind: 'nodata', label: 'No delay data' };
  const minutes = Math.round(delaySeconds / 60);
  if (minutes > 0) return { kind: 'late', label: `${minutes} min late` };
  if (minutes < 0) return { kind: 'early', label: `${-minutes} min early` };
  return { kind: 'ontime', label: 'On time' };
}

export function directionText(stop: Stop | undefined, toward: string | undefined) {
  return [stop?.direction, toward && `toward ${toward}`].filter(Boolean).join(', ');
}

export function windowText(window: { min: number; max: number }) {
  return `${window.min}–${window.max}\u00a0min`;
}

// "Today", "Yesterday", a weekday within the week, or a date.
export function dayLabel(atMs: number, nowMs: number) {
  const day = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(ms);
  const days = Math.round((Date.parse(day(nowMs)) - Date.parse(day(atMs))) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const options: Intl.DateTimeFormatOptions = days < 7 ? { weekday: 'long' } : { month: 'short', day: 'numeric' };
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'America/Los_Angeles' }).format(atMs);
}
