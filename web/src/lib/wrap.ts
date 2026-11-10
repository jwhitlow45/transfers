// The pairs of words a line never breaks between, joined with a no-break space where text is
// shown (see Whole.tsx). Each pair is short, so none can be wider than a line.

const NB = '\u00a0';
// A street's kind, which stays with its name: "22nd St", "Potrero Ave".
const SUFFIXES = new Set(['St', 'Ave', 'Blvd', 'Dr', 'Rd', 'Way', 'Ln', 'Ct', 'Pl', 'Hwy', 'Pkwy']);
// What the app counts, which stays with its number: "2 min", "1 stop", "40 m".
const UNITS = new Set(['min', 'm', 's', 'stop', 'stops', 'alert', 'alerts', 'change', 'changes', 'way', 'ways', 'more', 'departed']);
// A number as the app writes one: "2", "~17", "19+", "3–20".
const NUMBER = /^~?\d[\d–]*\+?$/;
// What may follow a word without being part of it: "St," and "Ave)".
const bare = (word: string) => word.replace(/[,.;:)]+$/, '');

// Text with its short pairs joined: a street's kind to its name, "&" and "+" to the word before
// them, so a line may end "25th St &" and none starts with one, and a number to its unit. Words
// are split at plain spaces only, so what is joined already stays so.
export function joinPairs(text: string): string {
  const words = text.split(' ');
  return words.reduce((joined, word, index) => {
    if (index === 0) return word;
    const before = words[index - 1]!;
    const pair = before !== '' && (SUFFIXES.has(bare(word)) || word === '&' || word === '+' || (NUMBER.test(before) && UNITS.has(bare(word))));
    return `${joined}${pair ? NB : ' '}${word}`;
  }, '');
}

// The steps of a chain written with arrows, "Montgomery St → Daly City → 120": each arrow goes
// with the step after it, joined to that step's first word, so no line ends with one.
export function chainSteps(text: string): string[] {
  return text.split(' → ').map((step, index) => (index === 0 ? step : `→${NB}${step}`));
}
