'use strict';
// Offline support: cache the app so it opens without internet after the first visit.
// Strategy: network first (so updates show immediately), falling back to the cache
// when offline or the network is too slow. Bump VERSION to force a clean cache.
const VERSION = 'rt-v6';
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
    try {
      const res = await fetchWithTimeout(req, 4000);
      if (res.ok) event.waitUntil(cache.put(req, res.clone()));
      return res;
    } catch {
      const cached = await cache.match(req, { ignoreSearch: true })
        || (req.mode === 'navigate' && (await cache.match('index.html')));
      return cached || Response.error();
    }
  })());
});

function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then((r) => { clearTimeout(t); resolve(r); }, (e) => { clearTimeout(t); reject(e); });
  });
}
