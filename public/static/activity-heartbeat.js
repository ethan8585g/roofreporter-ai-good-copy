// Activity heartbeat — pings /api/activity/heartbeat every 60s while the
// tab is visible so the server can compute accurate "time spent in module"
// for the super-admin User Activity dashboard.
//
// Auth: relies on the HttpOnly session cookie (rm_admin_session or
// rm_customer_session). When neither is present the server returns 204 and
// nothing is recorded — safe to inject on public pages too.

(function () {
  'use strict'

  if (window.__rmActivityHeartbeat) return
  window.__rmActivityHeartbeat = true

  var INTERVAL_MS = 60 * 1000

  function send() {
    if (document.hidden) return
    try {
      var path = window.location.pathname || '/'
      var token = (function () {
        try { return localStorage.getItem('rc_token') || '' } catch (e) { return '' }
      })()
      var headers = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = 'Bearer ' + token
      fetch('/api/activity/heartbeat', {
        method: 'POST',
        credentials: 'include',
        headers: headers,
        body: JSON.stringify({ path: path }),
        keepalive: true,
      }).catch(function () { /* swallow */ })
    } catch (e) { /* swallow */ }
  }

  // First ping shortly after load so quick visits still register.
  setTimeout(send, 4000)
  setInterval(send, INTERVAL_MS)

  // Ping when the tab becomes visible again after being hidden.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) send()
  })
})()
