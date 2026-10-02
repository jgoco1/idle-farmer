// The service worker for the Pages build (v3 phase 00), hand-written, no plugin. The build
// (scripts/build/pwa.ts) copies it to dist/sw.js and fills in VERSION and FILES. It precaches every
// built file, serves them cache-first so the game starts offline, and updates on the next launch:
// a new version installs beside the old one and waits; the page offers a reload (a toast) and posts
// 'skipWaiting' only when the player clicks it.

const VERSION = 'dev'; // replaced at build time
const FILES = []; // replaced at build time: every file in dist, relative to this script
const CACHE = `hearthfield-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('hearthfield-') && k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      // ignoreSearch: `?debug` and friends are the same page.
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        return await fetch(req);
      } catch (e) {
        // Offline, and a page the precache does not know by that URL: the game is the answer.
        const page = req.mode === 'navigate' ? await cache.match('./') : undefined;
        if (page) return page;
        throw e;
      }
    }),
  );
});
