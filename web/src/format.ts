// All times show in Pacific time, wherever the device is.
const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });

export const clock = (unixSeconds: number) => timeFormat.format(unixSeconds * 1000);

// Whole minutes rounded down, the same rule the server pairs connections with.
export const minutesUntil = (unixSeconds: number, nowMs: number) => Math.floor((unixSeconds * 1000 - nowMs) / 60_000);

export const walkMinutes = (meters: number) => Math.max(1, Math.round((meters * 1.3) / 1.4 / 60));

const dayFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: 'numeric', day: 'numeric' });
const weekdayTimeFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit' });

// A time ahead as the clock reads, with the weekday when it is not today in Pacific time.
export const clockOrDay = (unixSeconds: number, nowMs: number) =>
  dayFormat.format(unixSeconds * 1000) === dayFormat.format(nowMs) ? clock(unixSeconds) : weekdayTimeFormat.format(unixSeconds * 1000);
