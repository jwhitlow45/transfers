// How old the live data on screen is. It counts from when the server last got data from 511,
// so a server that stopped hearing from 511 and a phone that stopped reaching the server both
// show up as the same thing to the rider: times getting old.

// The server refreshes every 30 seconds, so data twice that old has missed a refresh.
export const STALE_SECONDS = 60;
const REFRESH_SECONDS = 30;

export type Freshness = {
  // Seconds since the server got the data, or null when there is no live data.
  ageSeconds: number | null;
  stale: boolean;
  // connection: this device has not reached the server lately. source: it has, but the server's
  // data from 511 is old.
  cause: 'connection' | 'source' | null;
};

export function freshness(nowMs: number, fetchedAtMs: number | null, dataAt: number | null, offline: boolean): Freshness {
  if (dataAt === null) return { ageSeconds: null, stale: false, cause: null };
  const ageSeconds = Math.max(0, Math.floor(nowMs / 1000 - dataAt));
  if (ageSeconds <= STALE_SECONDS) return { ageSeconds, stale: false, cause: null };
  const sinceFetch = fetchedAtMs === null ? Infinity : (nowMs - fetchedAtMs) / 1000;
  return { ageSeconds, stale: true, cause: offline || sinceFetch > REFRESH_SECONDS + 15 ? 'connection' : 'source' };
}

export const ageText = (seconds: number) => (seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min`);

// When to ask the server again: just after its next refresh, so the page never shows data
// older than one refresh plus a moment.
export function nextPollMs(dataAt: number | null, nowMs: number) {
  if (dataAt === null) return REFRESH_SECONDS * 1000;
  const due = (dataAt + REFRESH_SECONDS + 2) * 1000 - nowMs;
  return Math.min(REFRESH_SECONDS * 1000, Math.max(5000, due));
}
