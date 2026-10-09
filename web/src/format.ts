// All times show in Pacific time, wherever the device is.
const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });

// "9:38 PM" kept on one line wherever it lands.
export const clock = (unixSeconds: number) => timeFormat.format(unixSeconds * 1000).replace(/\s/g, '\u00a0');

// Whole minutes rounded down, the same rule the server pairs connections with.
export const minutesUntil = (unixSeconds: number, nowMs: number) => Math.floor((unixSeconds * 1000 - nowMs) / 60_000);

// "Now" within a minute, or the minutes, kept on one line with their unit.
export const untilText = (minutes: number) => (minutes < 1 ? 'Now' : `${minutes}\u00a0min`);

// A countdown column's words for a time to come: `soon` over "Now" within a minute, or `lead` over
// its minutes (see Countdown).
export function countdownTo(at: number, nowMs: number, lead: string, soon: string) {
  const minutes = minutesUntil(at, nowMs);
  return minutes < 1 ? { lead: soon, num: 'Now', unit: null } : { lead, num: String(minutes), unit: 'min' };
}

export const walkMinutes = (meters: number) => Math.max(1, Math.round((meters * 1.3) / 1.4 / 60));
// "Walk 3 min" from where the rider gets off to where they board, or null at one stop.
export const walkText = (meters: number) => (meters < 15 ? null : `Walk ${walkMinutes(meters)}\u00a0min`);

const dayFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: 'numeric', day: 'numeric' });
const weekdayTimeFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit' });

// A time ahead as the clock reads, with the weekday when it is not today in Pacific time.
export const clockOrDay = (unixSeconds: number, nowMs: number) =>
  dayFormat.format(unixSeconds * 1000) === dayFormat.format(nowMs) ? clock(unixSeconds) : weekdayTimeFormat.format(unixSeconds * 1000).replace(/(\d)\s/, '$1\u00a0');

// Between midnight and 5 AM on the rider's own clock, when owl service is the service running.
export const isOwlHour = (date: Date) => date.getHours() < 5;
// Muni names them "NOWL" and "LOWL", and the 91 as "Owl".
export const isOwlRoute = (route: { name: string; longName: string }) => /owl/i.test(route.name) || /owl/i.test(route.longName);
