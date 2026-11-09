/* Kanai Poker service worker: instant repeat loads + offline play.
   The cache name is stamped with a build id by build.mjs, so every deploy
   gets a fresh cache and old ones are removed on activate. */
const VERSION = '__BUILD_ID__';
const CACHE = 'kanai-' + VERSION;
const SHELL = ['./', 'index.html', 'style.css', 'script.js', 'poker.js', 'manifest.webmanifest',
  'assets/kanai-mark.svg', 'assets/kanai-logo.svg', 'assets/kanai-touch.png', 'assets/kanai-192.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('kanai-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // never touch POSTs (analytics etc.)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // fonts & third parties go straight to network
  if (req.mode === 'navigate') {
    // Network first so a new deploy shows immediately; fall back to the cached shell offline.
    event.respondWith(fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put('index.html', copy));
      return res;
    }).catch(() => caches.match('index.html')));
    return;
  }
  // Static assets: stale-while-revalidate.
  event.respondWith(caches.open(CACHE).then(cache => cache.match(req).then(hit => {
    const fresh = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || fresh;
  })));
});
