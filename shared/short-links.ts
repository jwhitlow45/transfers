// Short links for sharing a trip: /s/<from>/<to>, each end a few characters, with nothing stored.
// The server opens them as the trip's own address, names and all (J, 2026-10-08).
//
// An end is its agency's letter, lowercase for a stop and uppercase for a route, then the stop or
// route id: a number in base 36 ("13477" is "aed"), or anything else after a "-", escaped.
const LETTERS: Record<string, string> = { SF: 'm', BA: 'b', SM: 's', GG: 'g', GF: 'f' };
const AGENCIES = Object.fromEntries(Object.entries(LETTERS).map(([agency, letter]) => [letter, agency]));

const encodeId = (id: string) => (/^[1-9]\d{0,14}$/.test(id) ? Number(id).toString(36) : `-${encodeURIComponent(id)}`);

function decodeId(code: string) {
  if (code.startsWith('-')) return code.length > 1 ? decodeURIComponent(code.slice(1)) : null;
  if (!/^[0-9a-z]{1,10}$/.test(code)) return null;
  const id = Number.parseInt(code, 36);
  return Number.isSafeInteger(id) && id > 0 ? String(id) : null;
}

// "SF:13477" is "maed", and "route:SF:48" is "M1c".
export function encodeEnd(key: string): string | null {
  const route = key.startsWith('route:');
  const [agency, ...rest] = (route ? key.slice('route:'.length) : key).split(':');
  const letter = agency ? LETTERS[agency] : undefined;
  if (!letter || rest.length === 0) return null;
  return (route ? letter.toUpperCase() : letter) + encodeId(rest.join(':'));
}

export function decodeEnd(code: string): string | null {
  const letter = code[0];
  const agency = letter ? AGENCIES[letter.toLowerCase()] : undefined;
  const id = agency ? decodeId(code.slice(1)) : null;
  if (!agency || id === null) return null;
  return letter === letter!.toUpperCase() ? `route:${agency}:${id}` : `${agency}:${id}`;
}

// The short link's path for a trip, or null when an end has no short form.
export function shortTripPath(from: string, to: string) {
  const a = encodeEnd(from);
  const b = encodeEnd(to);
  return a && b ? `/s/${a}/${b}` : null;
}

// The trip's From and To keys from a short link's path, or null when it is not one.
export function parseShortTrip(pathname: string) {
  const match = pathname.match(/^\/s\/([^/]+)\/([^/]+)$/);
  const from = match ? decodeEnd(match[1]!) : null;
  const to = match ? decodeEnd(match[2]!) : null;
  return from && to && !from.startsWith('route:') ? { from, to } : null;
}
