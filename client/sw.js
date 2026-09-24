/* nodigraph service worker.
   App shell is precached so the editor opens offline (and so the site counts
   as installable for browsers and the Microsoft Store). Everything else is
   network-first with a cache fallback. CACHE is bumped per release: the
   server stamps /api/version, but a service worker can't read that at
   install time, so it's a plain constant — change it when the shell changes. */
const CACHE = 'nodigraph-shell-v1';
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/icon.svg',
  '/manifest.webmanifest',
  '/src/main.js',
  '/vendor/peerjs.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Cross-origin (fonts, raw.githubusercontent.com for ?github=, peer
  // signalling) and the server's own API are never cached here.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Navigations (including /?github=… and /#d=…) get the shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }

  // Same-origin assets: network first, refresh the cache on success, fall back
  // to the cache when offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req)),
  );
});
