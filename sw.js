// ============================================================
// LWH Safety Training — service worker
// Bump VERSION on every deploy so phones pick up the new files.
// ============================================================
const VERSION = 'st-v1.0.0';
const SHELL_CACHE = VERSION + '-shell';
const RUNTIME_CACHE = VERSION + '-runtime';

const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './css/app.css',
  './js/config.js', './js/i18n.js', './js/api.js', './js/weather.js', './js/app.js', './js/manager.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;           // API calls are POST — never cached
  const url = new URL(req.url);

  // Never cache Apps Script, YouTube or the WC form
  if (/script\.google(usercontent)?\.com|youtube|ytimg|googlevideo/.test(url.hostname)) return;

  // Weather: network first, fall back to last copy
  if (url.hostname === 'api.open-meteo.com') {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone(); caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)); return res;
    }).catch(() => caches.match(req)));
    return;
  }

  // Fonts + pdf-lib CDN: stale-while-revalidate
  if (/fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com/.test(url.hostname)) {
    e.respondWith(caches.open(RUNTIME_CACHE).then((c) => c.match(req).then((hit) => {
      const net = fetch(req).then((res) => { c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })));
    return;
  }

  // App shell (same origin): cache first, then network; navigations fall back to index
  if (url.origin === self.location.origin) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL_CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => req.mode === 'navigate' ? caches.match('./index.html') : undefined)));
  }
});
