// 2026-05-15: Bumped to v6 to force-purge stale Roof Reporter AI logos
// from PWA installs that predate the May-4 rebrand. The cache-first
// strategy below kept serving icon-192x192.png from the SW cache,
// so Android Chrome's auto-generated PWA splash screen showed the
// old logo until the site finished loading. Activating v6 deletes
// every prior cache, forcing icons to be re-fetched from origin.
const CACHE_NAME = 'roofmanager-v6';

// RC#4: Removed '/' from precache — always serve fresh HTML for navigation requests
const PRECACHE_URLS = [
  '/static/tailwind.css',
  '/static/style.css',
  '/static/logo.png?v=20260515rebrand',
  '/static/favicon.svg?v=20260515rebrand',
  '/static/icons/icon-192x192.png?v=20260515rebrand',
  '/static/icons/icon-512x512.png?v=20260515rebrand'
];

// Install: precache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: network-first with cache fallback
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip auth, payment, and API mutation endpoints
  if (url.pathname.startsWith('/api/auth') ||
      url.pathname.startsWith('/api/admin/auth') ||
      url.pathname.startsWith('/api/customer/auth') ||
      url.pathname.startsWith('/api/payments') ||
      url.pathname.startsWith('/api/square')) {
    return;
  }

  // RC#4: Never cache HTML navigation — always go to network
  // Prevents Safari from serving stale broken landing page on re-visits
  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/customer/login' || url.pathname === '/pricing') {
    event.respondWith(fetch(request));
    return;
  }

  // Static assets: network-first for fast-iterating JS dashboards,
  // cache-first for everything else (CSS, images, fonts — slower-moving
  // and big enough that the cache hit matters).
  //
  // 2026-05-11: super-admin-dashboard.js was stuck in cache across deploys,
  // breaking new-feature visibility until manual cache clear. The
  // `?v=Date.now()` cache-buster on the script tag wasn't enough because
  // the SW cache key includes the query string, so an HTML page loaded
  // earlier with stale ?v=ABC kept resolving to cached content.
  if (url.pathname.startsWith('/static/')) {
    const isHotJs = url.pathname.endsWith('super-admin-dashboard.js') ||
                    url.pathname.endsWith('customer-dashboard.js') ||
                    url.pathname.endsWith('customer-order.js')
    if (isHotJs) {
      // Network-first: always try fresh JS; fall back to cache only if offline.
      event.respondWith(
        fetch(request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone()
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
            }
            return response
          })
          .catch(() => caches.match(request))
      )
      return
    }
    event.respondWith(
      caches.match(request)
        .then((cached) => {
          if (cached) return cached;
          return fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          });
        })
    );
    return;
  }

  // HTML pages and API GETs: network-first with cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// ============================================================
// PUSH NOTIFICATIONS — Receive and display push messages
// ============================================================
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: 'Roof Manager', body: event.data.text() };
  }

  const options = {
    body: data.body || '',
    icon: data.icon || '/static/icons/icon-192x192.png',
    badge: data.badge || '/static/icons/icon-192x192.png',
    tag: data.tag || 'default',
    data: { link: data.link || '/', type: data.type || '' },
    requireInteraction: true
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Roof Manager', options)
  );
});

// Handle notification click — open the relevant page
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // Focus existing tab if open
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(link);
            return client.focus();
          }
        }
        // Open new window
        return clients.openWindow(link);
      })
  );
});
