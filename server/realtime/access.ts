// Elevator and escalator outages at BART stations, for riders who need them. Elevators come from
// BART's elevator advisory, part of its developer API. Escalators, and each elevator's reason and
// expected return, only from the tables behind bart.gov's elevator and escalator pages, which are
// not part of that API and may change, so they are taken as they come.
export const BART_ELEVATOR_ADVISORY_URL = 'https://api.bart.gov/api/bsa.aspx?cmd=elev&key=MW9S-E7SL-26DU-VV8V&json=y';
export const bartStatusTableUrl = (kind: 'elevator' | 'escalator') => `https://www.bart.gov/schedules/advisories_table/bart_${kind}_service_advisories`;

// `station` is BART's code for the station, lowercase, as bart-stations.ts keeps it ("24th").
export type Outage = { station: string; kind: 'elevator' | 'escalator'; location: string; reason: string | null; returns: string | null };

// The advisory names every outage in one sentence: "There are 3 elevators out of service at this
// time: 24TH: Station; CIVC: Station; COLS:  - Terminal/Station". Null for an answer of another
// shape, which says nothing either way.
export function parseElevatorAdvisory(json: unknown): Outage[] | null {
  const advisories = (json as { root?: { bsa?: unknown } } | null)?.root?.bsa;
  if (!Array.isArray(advisories)) return null;
  const outages: Outage[] = [];
  for (const advisory of advisories as { description?: { '#cdata-section'?: unknown } }[]) {
    const sentence = advisory?.description?.['#cdata-section'];
    const list = typeof sentence === 'string' ? sentence.split(/at this time:/i)[1] : undefined;
    if (!list) continue;
    for (const part of list.split(';')) {
      const match = part.trim().match(/^([A-Za-z0-9]{4}):\s*(.*)$/);
      if (!match) continue;
      const location = match[2]!.replace(/^[-\s]+/, '').trim();
      outages.push({ station: match[1]!.toLowerCase(), kind: 'elevator', location: location || 'Station', reason: null, returns: null });
    }
  }
  return outages;
}

// A bart.gov status table: Station | Location | Reason | Est. Return, each station linked to its
// accessibility page by code ("/stations/24TH/accessible"). Null for an answer that is not one of
// bart.gov's alert tables, as when the site changes, so the caller can fall back rather than
// report no outages.
export function parseStatusTable(json: unknown, kind: Outage['kind']): Outage[] | null {
  const html = (json as { html?: unknown } | null)?.html;
  if (typeof html !== 'string' || !/alerts-(container|table)/.test(html)) return null;
  const outages: Outage[] = [];
  for (const [, row] of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const station = row!.match(/\/stations\/([A-Za-z0-9]{4})\//)?.[1];
    const cells = [...row!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(([, cell]) => text(cell!));
    if (!station || cells.length < 2) continue;
    outages.push({ station: station.toLowerCase(), kind, location: cells[1]!.replace(/^[-\s]+/, '') || 'Station', reason: cells[2] || null, returns: cells[3] || null });
  }
  return outages;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#039': "'", apos: "'", nbsp: ' ' };
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#039|apos|nbsp);/g, (_, name: string) => ENTITIES[name]!)
    .replace(/\s+/g, ' ')
    .trim();
