// How a name or a phrase splits into the groups of words a line may break between (see Whole.tsx).

// A mark that joins two words, which stays with the word before it: a line may end "25th St &",
// and none starts with "&" or "+".
const JOINS = new Set(['&', '+', '-', '–', '/']);

// The groups of a name: each word, with a joining mark kept on the word before it, and the last
// two words kept together, so no line holds a short last word alone ("…Dakota / St"). Words are
// split at plain spaces only, so what a no-break space joins, "11:57 PM", is one word.
export function nameGroups(text: string): string[] {
  const groups: string[] = [];
  for (const word of text.split(' ')) {
    if (!word) continue;
    if (JOINS.has(word) && groups.length > 0) groups[groups.length - 1] += ` ${word}`;
    else groups.push(word);
  }
  if (groups.length > 1) {
    const last = groups.pop()!;
    groups[groups.length - 1] += ` ${last}`;
  }
  return groups;
}

// The steps of a chain written with arrows, "Montgomery St → Daly City → 120": each arrow goes
// with the step after it, joined to that step's first word, so no line ends with one.
export function chainSteps(text: string): string[] {
  return text.split(' → ').map((step, index) => (index === 0 ? step : `→ ${step}`));
}
