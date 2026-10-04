import { deepStrictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { getJson } from './api.ts';

// Answers each fetch with the next response, and keeps the headers each was sent with.
function serve(responses: Response[]) {
  const sent: Record<string, string>[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent.push(init.headers as Record<string, string>);
    return responses.shift()!;
  }) as typeof fetch;
  return sent;
}

const json = (body: object, headers: Record<string, string>) => new Response(JSON.stringify(body), { headers });

test('the time comes from the header, on a 304 and on a 200 the browser rebuilt from its cache', async () => {
  const sent = serve([
    // A 200 the browser revalidated: its body is ten minutes old, its header current.
    json({ generatedAt: 1000, groups: [1] }, { ETag: '"a"', 'X-Generated-At': '1600' }),
    new Response(null, { status: 304, headers: { ETag: '"a"', 'X-Generated-At': '1630' } }),
  ]);
  deepStrictEqual(await getJson('/api/trip?x=1'), { generatedAt: 1600, groups: [1] });
  deepStrictEqual(await getJson('/api/trip?x=1'), { generatedAt: 1630, groups: [1] });
  deepStrictEqual(sent, [{ 'X-Reads-Generated-At': '1' }, { 'X-Reads-Generated-At': '1', 'If-None-Match': '"a"' }]);
});

test('with the time header dropped on the way, the Date header gives the time', async () => {
  serve([json({ generatedAt: 1000, groups: [] }, { 'Date': new Date(1_600_000 * 1000).toUTCString() })]);
  deepStrictEqual(await getJson('/api/trip?x=2'), { generatedAt: 1_600_000, groups: [] });
});

test('a response with no time of its own comes through as it is', async () => {
  serve([json({ results: [] }, {})]);
  deepStrictEqual(await getJson('/api/search?q=mont'), { results: [] });
});
