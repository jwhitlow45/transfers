import type { Failure } from '../components/ResultsHeader.tsx';

// A request the server refused, in a page's words: what the page says, and what its header's
// status says, short and in full. A stop or route no longer in the schedule is said plainly,
// rather than in the server's words.
export function failureOf(error: string | null, page: string): (Failure & { text: string }) | null {
  if (error === null) return null;
  if (/^No (stop|route)/.test(error)) {
    const text = "This stop or route isn't in the schedule anymore";
    return { text, short: 'Not found', full: text };
  }
  return { text: error, short: 'Error', full: `${page} could not load: ${error}` };
}
