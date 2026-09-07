// Suraksha AR — offline app shell + runtime cache.
//
// Hand-rolled, no Workbox: the entire product argument is that this has to
// work with the radio off, so the caching logic is short enough to read in
// one sitting rather than trusted as a black box.
//
// Strategy: cache-first for every same-origin GET. The first load (which
// needs network regardless) populates the cache as it fetches each file —
// including Vite's content-hashed JS/CSS chunks, whose filenames aren't known
// ahead of build time — so nothing has to be pre-listed except the shell
// itself. A cache hit answers immediately; the network is still asked in the
// background so the next visit picks up a change once one exists.
//
// Bump CACHE_VERSION whenever a release must not let old cached assets linger
// (e.g. app shell markup changes shape). Bumping it deletes every prior
// cache on the next activate.
const CACHE_VERSION = 'suraksha-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          // Opaque/error responses are not worth caching — only a genuine
          // same-origin success replaces what a worker will rely on offline.
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      // A phone with the radio off cannot afford to wait on a request that
      // will only ever time out — serve the cached copy immediately when
      // there is one, and let the network fetch refresh it for next time.
      return cached ?? network;
    }),
  );
});
