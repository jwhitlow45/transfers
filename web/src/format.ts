// All times show in Pacific time, wherever the device is.
const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });

export const clock = (unixSeconds: number) => timeFormat.format(unixSeconds * 1000);

// Whole minutes rounded down, the same rule the server pairs connections with.
export const minutesUntil = (unixSeconds: number, nowMs: number) => Math.floor((unixSeconds * 1000 - nowMs) / 60_000);

export function countdown(unixSeconds: number, nowMs: number) {
  const minutes = minutesUntil(unixSeconds, nowMs);
  if (minutes < 0) return 'gone';
  return minutes === 0 ? 'now' : `${minutes} min`;
}

// The feed's delay rounded to the nearest minute.
export function lateness(delaySeconds: number | null) {
  if (delaySeconds === null) return { text: 'delay unknown', tone: 'unknown' as const };
  const minutes = Math.round(delaySeconds / 60);
  if (minutes === 0) return { text: 'on time', tone: 'ontime' as const };
  return minutes > 0 ? { text: `${minutes} min late`, tone: 'late' as const } : { text: `${-minutes} min early`, tone: 'early' as const };
}

export function ago(fetchedAtMs: number, nowMs: number) {
  const seconds = Math.max(0, Math.round((nowMs - fetchedAtMs) / 1000));
  if (seconds < 60) return `${seconds} s ago`;
  return `${Math.floor(seconds / 60)} min ago`;
}

export const walkMinutes = (meters: number) => Math.max(1, Math.round((meters * 1.3) / 1.4 / 60));
