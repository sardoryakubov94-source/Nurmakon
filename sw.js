/* ============================================================
   NurMakon — Service Worker (PWA offline support)
   v2: HTML uchun network-first (yangilanishlar darhol ko'rinadi)
   ============================================================ */
const CACHE = 'nurmakon-v2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-maskable.svg'
];

// Install: pre-cache the app shell. Do NOT auto skipWaiting here —
// that would activate the new worker (and force-reload the page via
// the client's controllerchange listener) at a random moment, even
// while the user is mid-form. Activation now only happens when the
// user taps "Yangilash" in the update banner (see the 'message' handler
// below), which is what index.html already expects.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
});

// Activate: delete every old cache version, take control right away
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1) Live/dynamic hosts: always network, never cache
  const isDynamic =
    /firestore|googleapis|gstatic|firebaseio|imgbb|api\.imgbb|identitytoolkit|tile\.openstreetmap|unpkg\.com|cdnjs/.test(url.href);
  if (isDynamic) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // 2) HTML document / navigation: NETWORK-FIRST so UI updates show immediately.
  //    Falls back to cache only when offline.
  const isDocument =
    req.mode === 'navigate' ||
    req.destination === 'document' ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('index.html');
  if (isDocument) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // 3) Other static assets (icons, manifest): stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const fromNetwork = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || fromNetwork;
    })
  );
});

// Allow the page to trigger an immediate activation of a new worker
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
