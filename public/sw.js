'use strict';
// Offline support: cache the app shell so it opens without internet after the first visit.
// Strategy: serve from cache immediately, refresh the cache in the background
// (a new version shows up on the next launch). Bump VERSION to force a clean cache.
const VERSION = 'rt-v3';
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'net.js', 'pair.js',
  'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'vendor/qrcode-generator.js', 'vendor/jsQR.js', 'vendor/peerjs.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Only same-origin GETs; never the local relay's live endpoints.
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (/\/(events|send|api\/[^/]*)$/.test(url.pathname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { event.waitUntil(fresh); return cached; }
    const res = await fresh;
    if (res) return res;
    if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
    return Response.error();
  })());
});
