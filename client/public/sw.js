// Nest service worker: shows pushes, opens the right page when one is tapped,
// and keeps the app shell so it opens with no signal.
//
// On iOS 18.4+ the phone shows our (declarative) pushes itself and this push handler
// doesn't run; it's here for older iOS and for desktop browsers.

const CACHE = 'nest-shell-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png']).catch(() => {})));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/l/')) return;

  // Pages: the network first (so a deploy shows at once), the saved shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(CACHE).then((c) => c.put('/', copy));
          }
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || Response.error())),
    );
    return;
  }

  // Fingerprinted assets never change: cache first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              void caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Nest', body: event.data ? event.data.text() : '' };
  }
  const n = data.web_push === 8030 ? data.notification : data;
  const title = n.title || 'Nest';
  const jobs = [
    self.registration.showNotification(title, {
      body: n.body || '',
      tag: n.tag,
      renotify: !!n.tag,
      icon: '/icon-192.png',
      badge: '/badge-96.png',
      lang: n.lang || 'en-GB',
      data: { url: n.navigate || '/' },
    }),
  ];
  if (typeof n.app_badge === 'number' && self.navigator.setAppBadge) {
    jobs.push(n.app_badge > 0 ? self.navigator.setAppBadge(n.app_badge) : self.navigator.clearAppBadge());
  }
  event.waitUntil(Promise.all(jobs.map((p) => Promise.resolve(p).catch(() => {}))));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) {
        if (new URL(w.url).origin === location.origin) {
          await w.focus();
          if ('navigate' in w) return w.navigate(target);
          return;
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});
