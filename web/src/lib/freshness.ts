// How old the live data on screen is. It counts from when the server last got data from 511,
// so a server that stopped hearing from 511 and a phone that stopped reaching the server both
// show up as the same thing to the rider: times getting old.

// The server and each page both refresh every 30 seconds, so data on screen is normally under
// about 61 seconds old: up to 30 on the server when fetched, plus up to 30 until the next fetch.
// J chose two and a half refreshes as the point to warn.
const REFRESH_SECONDS = 30;
export const STALE_SECONDS = REFRESH_SECONDS * 2.5;

export type Freshness = {
  // Seconds since the server got the data, or null when there is no live data.
  ageSeconds: number | null;
  stale: boolean;
  // connection: this device has missed a refresh from the server. source: it has not, so the
  // server is not hearing from 511.
  cause: 'connection' | 'source' | null;
};

// Age counts from when the server got the data from 511, so it grows when either this device
// or the server falls behind.
export function freshness(nowMs: number, fetchedAtMs: number | null, dataAt: number | null): Freshness {
  if (dataAt === null) return { ageSeconds: null, stale: false, cause: null };
  const ageSeconds = Math.max(0, Math.floor(nowMs / 1000 - dataAt));
  if (ageSeconds <= STALE_SECONDS) return { ageSeconds, stale: false, cause: null };
  const sinceFetch = fetchedAtMs === null ? Infinity : (nowMs - fetchedAtMs) / 1000;
  return { ageSeconds, stale: true, cause: sinceFetch > REFRESH_SECONDS * 1.5 ? 'connection' : 'source' };
}

export const ageText = (seconds: number) => (seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min`);
