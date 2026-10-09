import { deepStrictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { apiUrl, getJson } from './api.ts';

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

test("destinations and the way back ask with only the params that decide them, so what results show and pin asks nothing again", () => {
  const trip = '/api/trip?from=SF%3A1&to=SF%3A2&min=2&max=9&hide=3&walk=400&speed=1.1&dest=SF%3A3&r1=SF%3A14&fm=BA&hidden=1&stepfree=1&p2=t2&pb=SF%3A2&pt=100';
  deepStrictEqual(apiUrl.destinations(trip), '/api/destinations?from=SF%3A1&to=SF%3A2&walk=400&speed=1.1&fm=BA');
  deepStrictEqual(apiUrl.wayBack(trip, { alight: 'SF:5', board: 'SF:6' }), '/api/way-back?from=SF%3A1&to=SF%3A2&walk=400&speed=1.1&dest=SF%3A3&r1=SF%3A14&fm=BA&wa=SF%3A5&wb=SF%3A6');
});
