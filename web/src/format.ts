// All times show in Pacific time, wherever the device is.
const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });

export const clock = (unixSeconds: number) => timeFormat.format(unixSeconds * 1000);

// Whole minutes rounded down, the same rule the server pairs connections with.
export const minutesUntil = (unixSeconds: number, nowMs: number) => Math.floor((unixSeconds * 1000 - nowMs) / 60_000);

export const walkMinutes = (meters: number) => Math.max(1, Math.round((meters * 1.3) / 1.4 / 60));
