import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock, test } from 'node:test';
import { KeyPool } from './keys.ts';
import { Realtime } from './manager.ts';

test('during a 511 outage, page requests retry no sooner than the timer', async () => {
  mock.timers.enable({ apis: ['Date'], now: 1_791_000_000_000 });
  try {
    let tripRequests = 0;
    const down = (async (url: string | URL | Request) => {
      if (String(url).includes('tripupdates')) tripRequests++;
      return new Response('down', { status: 503 });
    }) as typeof fetch;
    const realtime = new Realtime(new KeyPool(['a', 'b', 'c'], join(mkdtempSync(join(tmpdir(), 'manager-')), 'usage.json'), down), down);
    await realtime.current();
    strictEqual(tripRequests, 1);
    // Pages keep asking. Each failure still costs a request against the keys.
    mock.timers.tick(11_000);
    await realtime.current();
    strictEqual(tripRequests, 1);
    mock.timers.tick(realtime.tripSeconds * 1000);
    await realtime.current();
    strictEqual(tripRequests, 2);
  } finally {
    mock.timers.reset();
  }
});

test("bart.gov's elevator table, answering in an unknown shape, falls back to BART's advisory without failing", async () => {
  const fake = (async (url: string | URL | Request) => {
    const address = String(url);
    if (address.includes('bsa.aspx')) {
      return Response.json({ root: { bsa: [{ description: { '#cdata-section': 'There are 1 elevators out of service at this time: CIVC: Station' } }] } });
    }
    if (address.includes('elevator_service')) return Response.json({});
    return Response.json({ html: 42 });
  }) as typeof fetch;
  const realtime = new Realtime(new KeyPool(['a'], join(mkdtempSync(join(tmpdir(), 'manager-')), 'usage.json'), fake), fake);
  deepStrictEqual(await realtime.accessOutages(), [{ station: 'civc', kind: 'elevator', location: 'Station', reason: null, returns: null }]);
});
