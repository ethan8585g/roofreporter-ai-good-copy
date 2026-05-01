// Activity heartbeat — pings /api/activity/heartbeat every 60s while the
// tab is visible AND the user has interacted within the last 3 minutes.
// Without idle gating a foreground tab racks up "active" hours while the
// user is AFK, which broke the Command Center totals (Trevor's 83h ghost).
//
// Auth: relies on the HttpOnly session cookie (rm_admin_session or
// rm_customer_session). When neither is present the server returns 204 and
// nothing is recorded — safe to inject on public pages too.

(function () {
  'use strict'

  if (window.__rmActivityHeartbeat) return
  window.__rmActivityHeartbeat = true

  var INTERVAL_MS = 60 * 1000
  var IDLE_AFTER_MS = 3 * 60 * 1000 // 3 min of no input = idle
  var lastInputAt = Date.now()

  function markActive() { lastInputAt = Date.now() }

  // Any of these resets the idle timer.
  ;['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click', 'wheel'].forEach(function (evt) {
    window.addEventListener(evt, markActive, { passive: true, capture: true })
  })

  function isIdle() {
    return (Date.now() - lastInputAt) > IDLE_AFTER_MS
  }

  function send() {
    if (document.hidden) return
    if (isIdle()) return // Skip — user has walked away from the screen
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

  // Ping when the tab becomes visible again after being hidden — but
  // markActive first so a tab-switch counts as fresh interaction.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      markActive()
      send()
    }
  })
})()
