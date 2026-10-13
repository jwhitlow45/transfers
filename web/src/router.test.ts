import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';

// A browser's history, location, events, and session storage, enough for the router, which reads
// them as globals. Going back fires popstate at once, where a browser fires it a moment later.
class FakeHistory {
  entries: { state: unknown; url: string }[] = [{ state: null, url: '/' }];
  index = 0;
  get state() {
    return this.entries[this.index]!.state;
  }
  get length() {
    return this.entries.length;
  }
  get url() {
    return this.entries[this.index]!.url;
  }
  pushState(state: unknown, _title: string, url?: string) {
    this.entries = [...this.entries.slice(0, this.index + 1), { state: structuredClone(state), url: url ?? this.url }];
    this.index++;
  }
  replaceState(state: unknown, _title: string, url?: string) {
    this.entries[this.index] = { state: structuredClone(state), url: url ?? this.url };
  }
  go(steps: number) {
    this.index = Math.max(0, Math.min(this.entries.length - 1, this.index + steps));
    dispatchEvent(new Event('popstate'));
  }
  back() {
    this.go(-1);
  }
}

const storage = new Map<string, string>();
const sessionStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => void storage.set(key, value) };
// A fresh page on the same tab's history and session storage, as after a reload.
async function load(history: FakeHistory, session: Pick<Storage, 'getItem' | 'setItem'> = sessionStorage) {
  const events = new EventTarget();
  Object.assign(globalThis, {
    history,
    sessionStorage: session,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    PopStateEvent: class extends Event {},
  });
  Object.defineProperty(globalThis, 'location', { configurable: true, get: () => new URL(history.url, 'https://transfers.test') });
  return (await import(`./router.ts?page=${Math.random()}`)) as typeof import('./router.ts');
}

test('back goes back through the pages the app opened, and from a page opened by a link, home in its place', async () => {
  const history = new FakeHistory();
  const { navigate, goBack } = await load(history);
  navigate('/t/a/b');
  strictEqual(history.length, 2);
  goBack();
  strictEqual(history.url, '/');
  strictEqual(history.length, 2);
  const linked = new FakeHistory();
  linked.entries = [{ state: null, url: '/t/a/b' }];
  const page = await load(linked);
  page.goBack();
  deepStrictEqual([linked.url, linked.length], ['/', 1]);
});

test('a sheet is a step back of its own, and an address changed inside it is the page under it once it closes', async () => {
  storage.clear();
  const history = new FakeHistory();
  const { navigate, openSheetEntry, isSheetEntry } = await load(history);
  navigate('/t/a/b?max=12');
  const sheet = openSheetEntry();
  strictEqual(isSheetEntry(sheet), true);
  navigate('/t/a/b?max=20', { replace: true });
  strictEqual(isSheetEntry(sheet), true);
  history.back();
  deepStrictEqual([history.url, isSheetEntry(sheet)], ['/t/a/b?max=20', false]);
  // A page opened from inside a sheet takes its step, so back returns to the page under it.
  openSheetEntry();
  navigate('/settings');
  history.back();
  strictEqual(history.url, '/t/a/b?max=20');
});

test('an address left waiting for a page the rider jumped back past never lands on another page', async () => {
  storage.clear();
  const history = new FakeHistory();
  const { navigate, openSheetEntry } = await load(history);
  navigate('/t/a/b?max=12');
  openSheetEntry();
  navigate('/t/a/b?max=20', { replace: true });
  history.go(-2);
  strictEqual(history.url, '/');
  navigate('/settings');
  strictEqual(history.url, '/settings');
});

test('a reload with a sheet open steps back to the page, keeps what changed in the sheet, and keys new sheets afresh', async () => {
  storage.clear();
  const history = new FakeHistory();
  const before = await load(history);
  before.navigate('/t/a/b?max=12');
  const sheet = before.openSheetEntry();
  before.navigate('/t/a/b?max=20', { replace: true });
  const after = await load(history);
  deepStrictEqual([history.url, (history.state as { sheet?: true }).sheet], ['/t/a/b?max=20', undefined]);
  const next = after.openSheetEntry();
  strictEqual(next === sheet, false);
  history.back();
  strictEqual(after.isSheetEntry(next), false);
});

test('without session storage, an address changed inside a sheet still reaches the page under it', async () => {
  const history = new FakeHistory();
  const blocked = () => {
    throw new Error('SecurityError');
  };
  const { navigate, openSheetEntry } = await load(history, { getItem: blocked, setItem: blocked });
  navigate('/t/a/b?max=12');
  openSheetEntry();
  navigate('/t/a/b?max=20', { replace: true });
  history.back();
  strictEqual(history.url, '/t/a/b?max=20');
});

test("Forward onto a closed sheet's entry steps back to the page, and an open sheet's entry stays", async () => {
  storage.clear();
  const history = new FakeHistory();
  const { navigate, openSheetEntry, closeSheetEntry, isSheetEntry } = await load(history);
  navigate('/t/a/b');
  const sheet = openSheetEntry();
  history.back();
  closeSheetEntry(sheet);
  history.go(1);
  deepStrictEqual([history.index, history.url], [1, '/t/a/b']);
  const open = openSheetEntry();
  navigate('/t/a/b?max=20', { replace: true });
  strictEqual(isSheetEntry(open), true);
});

test('swiping back knows whether back lands on Home, to show Home under the screen', async () => {
  const history = new FakeHistory();
  const { navigate, backGoesHome } = await load(history);
  navigate('/t/a/b');
  strictEqual(backGoesHome(), true);
  navigate('/settings');
  strictEqual(backGoesHome(), false);
  // A page opened by a link goes back to Home in its place.
  const linked = new FakeHistory();
  linked.entries = [{ state: null, url: '/t/a/b' }];
  strictEqual((await load(linked)).backGoesHome(), true);
});

test('a change made from a sheet stays on its page, and a page left from a sheet comes back scrolled with the sheet open', async () => {
  const history = new FakeHistory();
  const scrolled = { '.tf-app > .tf-layer > .tf-scroll': { scrollTop: 240 }, '.tf-layer .tf-sheet__body': { scrollTop: 30 } } as Record<string, unknown>;
  Object.assign(globalThis, { document: { querySelector: (selector: string) => scrolled[selector] ?? null } });
  const { navigate, openSheetEntry, currentDepth, cameBackTo, forgetLeft } = await load(history, { getItem: () => null, setItem: () => {} });
  navigate('/t/a/b');
  strictEqual(currentDepth(), 1);
  openSheetEntry('Trip settings');
  strictEqual(currentDepth(), 1);
  navigate('/t/a/b?r1=x', { replace: true });
  strictEqual(currentDepth(), 1);
  strictEqual(history.length, 3);
  // Settings takes the sheet's entry, a step on from the page.
  navigate('/settings');
  strictEqual(currentDepth(), 2);
  history.back();
  deepStrictEqual(cameBackTo(), { scroll: 240, sheet: 'Trip settings', sheetScroll: 30 });
  forgetLeft();
  strictEqual(cameBackTo(), undefined);
  delete (globalThis as { document?: unknown }).document;
});

test("a page put in another's place from its sheet closes the sheet and keeps the depth", async () => {
  const history = new FakeHistory();
  const { navigate, openSheetEntry, replacePage, currentDepth } = await load(history, { getItem: () => null, setItem: () => {} });
  navigate('/t/a/b');
  openSheetEntry('Trip settings');
  replacePage('/t/c/d?dest=e');
  strictEqual(history.url, '/t/c/d?dest=e');
  strictEqual(currentDepth(), 1);
  strictEqual((history.state as { sheet?: boolean }).sheet, undefined);
  history.back();
  strictEqual(history.url, '/');
});

test('a page put in place of one with no sheet open replaces it', async () => {
  const history = new FakeHistory();
  const { navigate, replacePage, currentDepth } = await load(history, { getItem: () => null, setItem: () => {} });
  navigate('/t/a/b');
  replacePage('/t/c/d');
  strictEqual(history.url, '/t/c/d');
  strictEqual(currentDepth(), 1);
  strictEqual(history.length, 2);
});

test("a stop's arrivals have an address of their own, a search with no To", async () => {
  const history = new FakeHistory();
  const { parsePage, stopPath, searchPath } = await load(history, { getItem: () => null, setItem: () => {} });
  const path = stopPath({ from: 'SF:13477', fromLabel: '24th St & Mission St (13477)' });
  strictEqual(path, '/stop/SF%3A13477?fl=24th+St+%26+Mission+St+%2813477%29');
  deepStrictEqual(parsePage(new URL(path, 'https://transfers.test') as unknown as Location), {
    name: 'stop',
    search: { from: 'SF:13477', to: '', fromLabel: '24th St & Mission St (13477)', toLabel: '' },
  });
  strictEqual(searchPath({ from: 'SF:13477', to: '', fromLabel: 'a', toLabel: '' }), '/stop/SF%3A13477?fl=a');
  strictEqual(searchPath({ from: 'SF:13477', to: 'SF:13517', fromLabel: 'a', toLabel: 'b' }), '/t/SF%3A13477/SF%3A13517?fl=a&tl=b');
});
