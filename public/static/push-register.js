// Web Push registration helper. Exposes window.ssEnablePush().
// Supported on Chrome/Edge/Firefox/Safari 16.4+. iOS PWAs must be added
// to home screen first.
(function () {
  function urlBase64ToUint8Array(b64) {
    var padding = '='.repeat((4 - b64.length % 4) % 4);
    var base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function getToken() { return localStorage.getItem('rc_customer_token') || ''; }

  function fetchJson(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }, opts.headers || {});
    return fetch(url, opts).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
        if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
        return j;
      });
    });
  }

  window.ssPushSupported = function () {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  };

  window.ssEnablePush = async function () {
    if (!window.ssPushSupported()) throw new Error('Push is not supported in this browser');
    var perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications permission denied');

    var reg = await navigator.serviceWorker.register('/service-worker.js');
    await navigator.serviceWorker.ready;

    var existing = await reg.pushManager.getSubscription();
    if (existing) {
      await fetchJson('/api/push/subscribe', { method: 'POST', body: JSON.stringify(existing.toJSON()) });
      return { ok: true, reused: true };
    }

    var keyRes = await fetchJson('/api/push/vapid-public-key');
    var sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyRes.publicKey)
    });
    await fetchJson('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
    return { ok: true, reused: false };
  };

  window.ssDisablePush = async function () {
    if (!('serviceWorker' in navigator)) return;
    var reg = await navigator.serviceWorker.getRegistration('/service-worker.js');
    if (!reg) return;
    var sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await fetchJson('/api/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(function(){});
    await sub.unsubscribe();
  };

  window.ssTestPush = function () {
    return fetchJson('/api/push/test', { method: 'POST' });
  };
})();
