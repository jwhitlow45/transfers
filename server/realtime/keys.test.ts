import { deepStrictEqual, rejects, strictEqual } from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { KeyPool, RateLimitedError, pollSeconds } from './keys.ts';

function fakeFetch(statusFor: (key: string) => number, remaining = '59') {
  const calls: string[] = [];
  const impl = (async (url: string | URL | Request) => {
    const key = new URL(String(url)).searchParams.get('api_key') ?? '';
    calls.push(key);
    return new Response('ok', { status: statusFor(key), headers: { 'RateLimit-Remaining': remaining } });
  }) as typeof fetch;
  return { impl, calls };
}

const statePath = () => join(mkdtempSync(join(tmpdir(), 'keys-')), 'usage.json');

test('spreads requests across keys', async () => {
  const { impl, calls } = fakeFetch(() => 200);
  const pool = new KeyPool(['a', 'b', 'c'], statePath(), impl);
  for (let i = 0; i < 6; i++) await pool.request('tripupdates', { agency: 'RG' }, 1000 + i);
  deepStrictEqual(calls.slice().sort(), ['a', 'a', 'b', 'b', 'c', 'c']);
});

test('remembers usage across restarts', async () => {
  const path = statePath();
  const { impl } = fakeFetch(() => 200, '0');
  await new KeyPool(['a'], path, impl).request('tripupdates', {}, 1000);
  await rejects(new KeyPool(['a'], path, impl).request('tripupdates', {}, 1001), RateLimitedError);
});

test('counts each endpoint separately', async () => {
  const { impl } = fakeFetch(() => 200, '0');
  const pool = new KeyPool(['a'], statePath(), impl);
  await pool.request('tripupdates', {}, 1000);
  await pool.request('servicealerts', {}, 1000);
  await rejects(pool.request('tripupdates', {}, 1001), RateLimitedError);
});

test('skips a key that hit the limit', async () => {
  const { impl, calls } = fakeFetch((key) => (key === 'a' ? 429 : 200));
  const pool = new KeyPool(['a', 'b'], statePath(), impl);
  await rejects(pool.request('tripupdates', {}, 1000), RateLimitedError);
  await pool.request('tripupdates', {}, 1001);
  await pool.request('tripupdates', {}, 1002);
  deepStrictEqual(calls, ['a', 'b', 'b']);
});

test('poll interval keeps a fifth of requests in reserve', () => {
  strictEqual(pollSeconds(3), 30);
  strictEqual(pollSeconds(2), 38);
  strictEqual(pollSeconds(1), 75);
});
