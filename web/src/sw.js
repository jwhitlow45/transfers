// Caches the app on first visit and answers page loads from the cache, so the app opens
// instantly underground. Data never comes from here: the app keeps its own last results and
// fetches fresh ones itself. The build fills in the version and file list below.
const VERSION = '__VERSION__';
const FILES = __FILES__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== VERSION).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    // Every page is the same shell. The cached copy answers at once, and a fresh one is saved
    // for next time.
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const cached = await cache.match('/', { ignoreVary: true });
        const fresh = fetch(event.request)
          .then((response) => {
            if (response.ok && !url.pathname.startsWith('/t/')) cache.put('/', response.clone());
            return response;
          })
          .catch(() => cached);
        return cached ?? fresh;
      }),
    );
    return;
  }
  // Built file names carry a content hash, so a URL match is enough. Matching on Vary headers
  // (Origin, Accept-Encoding) would miss module scripts, which send an Origin the precache lacked.
  event.respondWith(caches.match(event.request, { ignoreVary: true }).then((cached) => cached ?? fetch(event.request)));
});
