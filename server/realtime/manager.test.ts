import { strictEqual } from 'node:assert/strict';
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
