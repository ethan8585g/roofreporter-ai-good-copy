// Storm Scout service worker — handles Web Push + notification click routing.
self.addEventListener('install', function (event) {
  self.skipWaiting();
});
self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function (event) {
  var data = { title: 'Storm Scout', body: 'New storm event', url: '/customer/storm-scout' };
  if (event.data) {
    try { data = Object.assign(data, event.data.json()); }
    catch (e) { try { data.body = event.data.text(); } catch (_) {} }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Storm Scout', {
      body: data.body || '',
      icon: '/static/logo.png',
      badge: '/static/logo.png',
      data: { url: data.url || '/customer/storm-scout' },
      tag: data.tag || 'storm-scout',
      renotify: true
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/customer/storm-scout';
  event.waitUntil((async function () {
    var all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (var i = 0; i < all.length; i++) {
      var c = all[i];
      if (c.url.indexOf(url) >= 0) { return c.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});
