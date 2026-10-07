import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { buildWatch } from './update.ts';

test('a newer build is offered once it has held for 15 seconds, and a matching one resets the wait', () => {
  let now = 0;
  const watch = buildWatch('aaa', () => now);
  const heard: number[] = [];
  watch.subscribe(() => heard.push(now));
  watch.notice('bbb');
  now = 10_000;
  watch.notice('bbb');
  strictEqual(watch.available, false);
  // Mid-deploy, the next answer comes from a server still on this page's build.
  now = 12_000;
  watch.notice('aaa');
  now = 20_000;
  watch.notice('bbb');
  strictEqual(watch.available, false);
  now = 35_000;
  watch.notice('bbb');
  now = 65_000;
  watch.notice('bbb');
  deepStrictEqual([watch.available, heard], [true, [35_000]]);
});

test('a page with no build, as from the development server, and an answer with none, are never offered one', () => {
  let now = 0;
  const dev = buildWatch(null, () => now);
  const stamped = buildWatch('aaa', () => now);
  dev.notice('bbb');
  stamped.notice(null);
  now = 60_000;
  dev.notice('bbb');
  stamped.notice(null);
  deepStrictEqual([dev.available, stamped.available], [false, false]);
});

test('a second new build waits its own 15 seconds, and a server back on this page\'s build takes the offer back', () => {
  let now = 0;
  const watch = buildWatch('aaa', () => now);
  watch.notice('bbb');
  now = 15_000;
  // Another deploy lands while the first settles.
  watch.notice('ccc');
  strictEqual(watch.available, false);
  now = 30_000;
  watch.notice('ccc');
  strictEqual(watch.available, true);
  // Rolled back to this page's build.
  now = 40_000;
  watch.notice('aaa');
  strictEqual(watch.available, false);
});
