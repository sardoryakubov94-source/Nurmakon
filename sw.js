/* ============================================================
   NurMakon — Service Worker (PWA offline support + FCM push)
   v3: HTML uchun network-first (yangilanishlar darhol ko'rinadi)
   MUHIM: FCM (firebase-messaging-sw.js) logikasi endi shu faylning
   ichiga birlashtirildi. Avval ular ikkita ALOHIDA Service Worker
   sifatida BIR XIL '/' scope'da ro'yxatdan o'tar edi — bu esa ikkinchisi
   (FCM SW) faollashganda 'controllerchange' hodisasini qayta otib,
   sahifani kutilmagan payt (masalan foydalanuvchi forma to'ldirayotganda)
   qayta yuklashga (forma tozalanishiga) sabab bo'lardi. Endi FAQAT bitta
   Service Worker bor — bu muammoni tag-tugidan bartaraf etadi.
   ============================================================ */
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyA3l0hY4edwZFMBI5vHDWUwcjK4iRQ4zbo",
  authDomain: "nurmakon-da877.firebaseapp.com",
  projectId: "nurmakon-da877",
  storageBucket: "nurmakon-da877.firebasestorage.app",
  messagingSenderId: "875556957543",
  appId: "1:875556957543:web:a421eacf895e4b0d9493c2"
});

// FCM ni faqat messaging qo'llab-quvvatlansa ishga tushiramiz (ba'zi
// brauzerlarda/muhitlarda firebase.messaging mavjud bo'lmasligi mumkin).
let messaging = null;
try { messaging = firebase.messaging(); } catch (e) { /* messaging not supported here */ }

if (messaging) {
  // Fon rejimida kelgan xabar — bildirishnoma ko'rsatamiz
  messaging.onBackgroundMessage((payload) => {
    const n = (payload && (payload.notification || payload.data)) || {};
    const title = n.title || "Yangi to'lov so'rovi";
    const options = {
      body: n.body || '',
      icon: 'notif-icon.png',
      badge: 'badge.png',
      tag: 'nm-topup',
      data: { url: (n.click_action || './') }
    };
    self.registration.showNotification(title, options);
  });
}

// Bildirishnomani bosganda — ilovani ochamiz/fokuslaymiz
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) { if ('focus' in w) return w.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

const CACHE = 'nurmakon-v5';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-maskable.svg',
  './notif-icon.png',
  './badge.png'
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
