/* ============================================================
   NurMakon — Service Worker (PWA offline support)
   ============================================================ */
const CACHE = 'nurmakon-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-maskable.svg'
];

// Install: pre-cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy:
//  - Firebase / Firestore / API / image hosts: always go to network (never cache dynamic data)
//  - App shell & static assets: cache-first, fall back to network, then update cache
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isDynamic =
    /firestore|googleapis|gstatic|firebaseio|imgbb|api\.imgbb|identitytoolkit|tile\.openstreetmap/.test(url.href);

  if (isDynamic) {
    // Network-first for live data; do not cache
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
