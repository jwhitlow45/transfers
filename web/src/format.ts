import { walkSeconds } from '../../shared/walk.ts';

// All times show in Pacific time, wherever the device is.
export const PACIFIC = 'America/Los_Angeles';
const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: PACIFIC, hour: 'numeric', minute: '2-digit' });

// "9:38 PM" kept on one line wherever it lands.
export const clock = (unixSeconds: number) => timeFormat.format(unixSeconds * 1000).replace(/\s/g, '\u00a0');

// Whole minutes rounded down, the same rule the server pairs connections with.
export const minutesUntil = (unixSeconds: number, nowMs: number) => Math.floor((unixSeconds * 1000 - nowMs) / 60_000);
// Whole minutes since a time gone by, rounded down as well.
export const minutesSince = (unixSeconds: number, nowMs: number) => Math.floor((nowMs - unixSeconds * 1000) / 60_000);
// "1 minute" or "N minutes", for spoken text.
export const minuteCount = (minutes: number) => `${minutes} minute${minutes === 1 ? '' : 's'}`;

// Whether a vehicle has yet to leave the first stop of its trip, by its latest times, and so has
// not come, whatever time the feed gives it, as that time assumed it would leave on time. It stays
// coming, at "1+" (see atLeast), until the feed drops that stop, or for at most half an hour past
// its time, so times kept from long ago, as offline, never hold it for good. The server holds it as
// long (see soonest in server/engine/connections.ts).
export const stillWaiting = (unixSeconds: number, nowMs: number, notStarted = false) => notStarted && nowMs - unixSeconds * 1000 < 30 * 60_000;
// Whether a vehicle has come and gone by its time (see stillWaiting).
export const hasLeft = (unixSeconds: number, nowMs: number, notStarted = false) => !stillWaiting(unixSeconds, nowMs, notStarted) && unixSeconds * 1000 < nowMs;

// "Now" within a minute, or the minutes, kept on one line with their unit. A vehicle yet to leave
// the first stop of its trip reads "19+ min" (see atLeast).
export const untilText = (minutes: number, notStarted = false) => (notStarted ? `${atLeast(minutes)}\u00a0min` : minutes < 1 ? 'Now' : `${minutes}\u00a0min`);

// Minutes to a vehicle yet to leave the first stop of its trip, as "19+": the feed times it as if
// it leaves there on time, so it comes then at the soonest, and often later (J, 2026-11-09). At
// least one, as it cannot be arriving now.
export const atLeast = (minutes: number) => `${Math.max(1, minutes)}+`;

// A value worked out from the schedule alone, with no live prediction in it, reads "~38" (J,
// 2026-10-14). Where a Scheduled tag already sits beside a vehicle's time, its time and countdown
// stay bare, as one mark says it (J, 2026-10-03).
export const approx = (text: string, scheduled: boolean) => (scheduled ? `~${text}` : text);
// Minutes to a time from the schedule alone, at least one, as "~0" says nothing a rider can use.
export const approxMinutes = (minutes: number, scheduled: boolean) => (scheduled ? approx(String(Math.max(1, minutes)), true) : String(minutes));

// A countdown column's words for a time to come: `soon` over "Now" within a minute, or `lead` over
// its minutes (see Num), which a time from the schedule alone, or a vehicle yet to leave the
// first stop of its trip, marks as such.
export function countdownTo(at: number, nowMs: number, lead: string, soon: string, mark: 'scheduled' | 'notStarted' | null = null) {
  const minutes = minutesUntil(at, nowMs);
  if (mark === 'scheduled') return { lead, num: approxMinutes(minutes, true), unit: 'min' };
  if (mark === 'notStarted') return { lead, num: atLeast(minutes), unit: 'min' };
  return minutes < 1 ? { lead: soon, num: 'Now', unit: null } : { lead, num: String(minutes), unit: 'min' };
}

// Whole minutes to walk a straight-line distance at the rider's speed, as the server times it.
export const walkMinutes = (meters: number, speed: number) => Math.max(1, Math.round(walkSeconds(meters, speed) / 60));
// "Walk 3 min" from where the rider gets off to where they board, or null at one stop.
export const walkText = (meters: number, speed: number) => (meters < 15 ? null : `Walk ${walkMinutes(meters, speed)}\u00a0min`);

const dayFormat = new Intl.DateTimeFormat('en-US', { timeZone: PACIFIC, year: 'numeric', month: 'numeric', day: 'numeric' });
const weekdayTimeFormat = new Intl.DateTimeFormat('en-US', { timeZone: PACIFIC, weekday: 'short', hour: 'numeric', minute: '2-digit' });
const shortDateFormat = new Intl.DateTimeFormat('en-US', { timeZone: PACIFIC, month: 'short', day: 'numeric' });

// "Thu 5:12 AM", its time kept on one line.
export const weekdayClock = (unixSeconds: number) => weekdayTimeFormat.format(unixSeconds * 1000).replace(/(\d)\s/, '$1\u00a0');

// A time ahead as the clock reads, with the weekday when it is not today in Pacific time.
export const clockOrDay = (unixSeconds: number, nowMs: number) => (dayFormat.format(unixSeconds * 1000) === dayFormat.format(nowMs) ? clock(unixSeconds) : weekdayClock(unixSeconds));

// "Oct 23".
export const shortDate = (ms: number) => shortDateFormat.format(ms);

// Between midnight and 5 AM on the rider's own clock, when owl service is the service running.
export const isOwlHour = (date: Date) => date.getHours() < 5;
// Muni names them "NOWL" and "LOWL", and the 91 as "Owl".
export const isOwlRoute = (route: { name: string; longName: string }) => /owl/i.test(route.name) || /owl/i.test(route.longName);
