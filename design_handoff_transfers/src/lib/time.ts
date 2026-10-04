import type { Minutes } from '../types';

/** "4:38 PM" — always Pacific. Inputs are minutes since local midnight. */
export function formatClock(m: Minutes): string {
  const whole = Math.floor(m);
  let h = Math.floor(whole / 60);
  const mm = whole % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(mm).padStart(2, '0')} ${ap}`;
}

/** Whole minutes until t (floored), from a seconds-precision clock. */
export function minutesUntil(t: Minutes, nowSec: number): number {
  return Math.floor((t * 60 - nowSec) / 60);
}

/** Current Pacific time in seconds since midnight. */
export function pacificNowSec(date = new Date()): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(date).reduce<Record<string, string>>((a, x) => (a[x.type] = x.value, a), {});
  return (+p.hour % 24) * 3600 + +p.minute * 60 + +p.second;
}
