import { TIME_ZONE } from './config.ts';

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
});

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function zonedParts(epochSeconds: number) {
  const values = Object.fromEntries(parts.formatToParts(epochSeconds * 1000).map(({ type, value }) => [type, value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: WEEKDAYS.indexOf(values.weekday ?? ''),
  };
}

// A service date as the integer 20261003, the way GTFS writes it.
export function serviceDate(epochSeconds: number) {
  const { year, month, day } = zonedParts(epochSeconds);
  return year * 10_000 + month * 100 + day;
}

export function addDays(date: number, days: number) {
  const utc = new Date(Date.UTC(Math.floor(date / 10_000), (Math.floor(date / 100) % 100) - 1, date % 100 + days));
  return utc.getUTCFullYear() * 10_000 + (utc.getUTCMonth() + 1) * 100 + utc.getUTCDate();
}

// 0 is Sunday.
export function weekday(date: number) {
  return new Date(Date.UTC(Math.floor(date / 10_000), (Math.floor(date / 100) % 100) - 1, date % 100)).getUTCDay();
}

// GTFS times count from noon minus 12 hours on the service date, not from midnight, so a
// service day stays 24 hours long across daylight saving changes. Noon is never ambiguous.
export function serviceDayStart(date: number) {
  const noonGuess = Date.UTC(Math.floor(date / 10_000), (Math.floor(date / 100) % 100) - 1, date % 100, 12) / 1000;
  const local = zonedParts(noonGuess);
  const offset = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) / 1000 - noonGuess;
  return noonGuess - offset - 12 * 3600;
}

// "25:10:00" is 1:10 AM the next morning, still on the earlier service date.
export function parseGtfsTime(text: string) {
  const [hours, minutes, seconds] = text.split(':').map(Number);
  if (hours === undefined || minutes === undefined || Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 3600 + minutes * 60 + (seconds ?? 0);
}

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
