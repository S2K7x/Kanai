/* Kanai Poker service worker: offline play.
   The cache name is stamped with a build id by build.mjs, so every deploy
   gets a fresh cache and old ones are removed on activate. */
const VERSION = 'mw9335tm';
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
  // Network first for everything same-origin, so HTML, JS and CSS from the same
  // deploy always load together; the cache is only used when offline.
  event.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req.mode === 'navigate' ? 'index.html' : req, copy)); }
    return res;
  }).catch(() => caches.match(req.mode === 'navigate' ? 'index.html' : req).then(hit => hit || caches.match(req, { ignoreSearch: true }))));
});
