// Agencies spell street names differently ("24th Street / Mission" at BART, "24th St & Mission St"
// at Muni), so names and queries both go through the same short forms before matching.
const SHORT_FORMS: [RegExp, string][] = [
  [/\bstreet\b/g, 'st'],
  [/\bavenue\b/g, 'ave'],
  [/\bboulevard\b/g, 'blvd'],
  [/\bdrive\b/g, 'dr'],
  [/\broad\b/g, 'rd'],
  [/\bplaza\b/g, 'plz'],
  [/\bcenter\b/g, 'ctr'],
  [/\bstation\b/g, 'sta'],
  [/\bsaint\b/g, 'st'],
];

export function searchText(text: string) {
  let normalized = text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  for (const [pattern, replacement] of SHORT_FORMS) normalized = normalized.replace(pattern, replacement);
  return normalized.replace(/[^a-z0-9]+/g, ' ').trim();
}

// Riders name a corner as they say it, "24th and Mission" or "Van Ness at Market", where stop
// names join the streets with "&". Left out of queries, not names, so the index needs no rebuild.
const CONNECTORS = new Set(['and', 'at']);

// An FTS5 query matching every word, the last one as a prefix so results appear while typing.
export function searchQuery(text: string, columns?: string[]) {
  const typed = searchText(text).split(' ').filter(Boolean);
  const kept = typed.filter((word) => !CONNECTORS.has(word));
  const words = kept.length > 0 ? kept : typed;
  if (words.length === 0) return null;
  const query = words.map((word, index) => `"${word}"${index === words.length - 1 ? '*' : ''}`).join(' ');
  return columns ? `{${columns.join(' ')}} : (${query})` : query;
}
