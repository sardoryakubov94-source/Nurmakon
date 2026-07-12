/* ============================================================
   NurMakon — Firebase Cloud Messaging Service Worker
   Ilova YOPIQ yoki fonda bo'lganda push bildirishnomalarni ko'rsatadi.
   Bu fayl asosiy sw.js dan alohida ishlaydi (Firebase uni o'z maxsus
   scope'ida ro'yxatdan o'tkazadi, shuning uchun cache SW ga xalaqit bermaydi).
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

const messaging = firebase.messaging();

// Fon rejimida kelgan xabar — bildirishnoma ko'rsatamiz
messaging.onBackgroundMessage((payload) => {
  const n = (payload && (payload.notification || payload.data)) || {};
  const title = n.title || "Yangi to'lov so'rovi";
  const options = {
    body: n.body || '',
    icon: 'icon.svg',
    badge: 'icon.svg',
    tag: 'nm-topup',
    data: { url: (n.click_action || './') }
  };
  self.registration.showNotification(title, options);
});

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
