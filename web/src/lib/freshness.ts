import type { FeedState } from '../hooks.ts';

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

export function ageText(seconds: number) {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)} h`;
}

// The status line's short form: "12s", "3m", "2h".
export const ageShort = (seconds: number) => ageText(seconds).replace(/ (\w)\w*$/, '$1');

// How far the server's clock is ahead of this device's, in milliseconds, from a response's
// own timestamp and when it arrived. Every time on the page is a server timestamp, so a phone
// clock a minute fast would otherwise show every countdown a minute short and data a minute
// older than it is. The timestamp is in whole seconds and the response takes time to arrive, so
// a few seconds' difference is that, not the clock, and is left alone.
const SKEW_FLOOR_MS = 5000;

export function clockSkewMs(generatedAt: number | undefined, fetchedAtMs: number | null) {
  if (generatedAt === undefined || fetchedAtMs === null) return 0;
  const skew = generatedAt * 1000 - fetchedAtMs;
  return Math.abs(skew) < SKEW_FLOOR_MS ? 0 : skew;
}

// What a live card on Home knows of how fresh its times are, which only changes when it fetches.
export type LiveReport = { feed: FeedState; fetchedAt: number | null; dataAt: number | null; skew: number; settled: boolean };

// The status line for every live card on Home together, as the results header says it for one
// trip: offline when any card is, and the age of the oldest times showing, so it never says the
// times are fresher than some of them are. None without live cards, as Home then asks nothing.
export function homeStatus(reports: LiveReport[], now: number): { feed: FeedState; secondsSinceUpdate: number | null; stale: boolean } | null {
  if (reports.length === 0) return null;
  const fresh = reports.map(({ fetchedAt, dataAt, skew }) => freshness(now + skew, fetchedAt === null ? null : fetchedAt + skew, dataAt));
  const ages = fresh.flatMap(({ ageSeconds }) => (ageSeconds === null ? [] : [ageSeconds]));
  const feeds = reports.map(({ feed }) => feed);
  const feed: FeedState = feeds.includes('offline') ? 'offline' : feeds.every((state) => state === 'loading') ? 'loading' : feeds.includes('refreshing') ? 'refreshing' : 'live';
  return { feed, secondsSinceUpdate: ages.length > 0 ? Math.max(...ages) : null, stale: fresh.some(({ stale }, index) => stale && reports[index]!.settled) };
}

// A page's live times on the server's clock: the phone's skew from the server, now by the server,
// how fresh the times are, whether to warn that they are old, and seconds since the last update,
// which counts from the fetch until the server says how old its data is.
export function liveClock({ data, fetchedAt, settled }: { data: { generatedAt: number; dataAt: number | null } | null; fetchedAt: number | null; settled: boolean }, deviceNow: number) {
  const skew = clockSkewMs(data?.generatedAt, fetchedAt);
  const now = deviceNow + skew;
  const fresh = freshness(now, fetchedAt === null ? null : fetchedAt + skew, data?.dataAt ?? null);
  const secondsSinceUpdate = fresh.ageSeconds ?? (fetchedAt === null ? null : Math.max(0, Math.floor((now - (fetchedAt + skew)) / 1000)));
  return { skew, now, fresh, showStale: fresh.stale && settled, secondsSinceUpdate };
}

// What a card on Home says when its times are not live, as Home has no banner to: offline, with
// how old its times are, or how old they are once they are old enough to warn about.
export function liveNote(feed: FeedState, fresh: Freshness, settled: boolean) {
  const age = fresh.ageSeconds === null ? null : ageText(fresh.ageSeconds);
  if (feed === 'offline') return `Offline${age ? ` · times ${age} old` : ''}`;
  return fresh.stale && settled && age ? `Live times ${age} old` : null;
}
