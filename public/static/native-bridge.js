/* Roof Manager — universal native bridge.
 *
 * Loaded by SSR pages via <script defer src="/static/native-bridge.js"></script>.
 * Auto-detects whether the page is running inside the Capacitor iOS / Android
 * shell and exposes a unified `window.RoofNative` API for camera / GPS / push
 * registration. In a regular browser it falls back to web equivalents (file
 * picker with camera capture, navigator.geolocation, Web Push) so app pages
 * keep working in both contexts.
 *
 * Also tags <html class="in-app"> early so CSS can hide site chrome that does
 * not belong inside a wrapped app (e.g., the PWA install banner, marketing
 * nav links, "Open in Safari" tooltips).
 */
(function () {
  'use strict'

  function isInsideCapacitor() {
    if (typeof window === 'undefined') return false
    if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function') {
      try { return !!window.Capacitor.isNativePlatform() } catch (_) {}
    }
    var ua = (navigator && navigator.userAgent) || ''
    return /Capacitor(WebView)?\b|com\.roofmanager|RoofManagerApp/i.test(ua)
  }

  var IN_APP = isInsideCapacitor()
  if (IN_APP) {
    try { document.documentElement.classList.add('in-app') } catch (_) {}
    // Mark every fetch request from app pages so the server knows.
    var origFetch = window.fetch
    if (typeof origFetch === 'function') {
      window.fetch = function (input, init) {
        init = init || {}
        var headers = new Headers(init.headers || (input && input.headers) || {})
        if (!headers.has('x-roof-manager-app')) headers.set('x-roof-manager-app', '1')
        init.headers = headers
        return origFetch.call(this, input, init)
      }
    }
  }

  function notReady() { return Promise.reject(new Error('Native bridge not available outside the Roof Manager app.')) }

  // ---- camera ----
  function takePhoto(opts) {
    opts = opts || {}
    if (!IN_APP) {
      // Web fallback: open a file picker that prefers the rear camera on mobile.
      return new Promise(function (resolve, reject) {
        var input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/*'
        if (opts.source !== 'PHOTOS') input.capture = 'environment'
        input.onchange = function () {
          var file = input.files && input.files[0]
          if (!file) return reject(new Error('No photo captured.'))
          var reader = new FileReader()
          reader.onload = function () { resolve({ base64: reader.result, format: file.type, name: file.name }) }
          reader.onerror = function () { reject(reader.error) }
          reader.readAsDataURL(file)
        }
        input.click()
      })
    }
    // Capacitor path — load the plugin from CDN (no build step).
    return import('https://cdn.jsdelivr.net/npm/@capacitor/camera@6/dist/esm/index.js').then(function (mod) {
      return mod.Camera.getPhoto({
        quality: opts.quality || 80,
        allowEditing: false,
        resultType: 'base64',
        source: opts.source === 'PHOTOS' ? 'PHOTOS' : 'CAMERA',
        saveToGallery: false,
      })
    }).then(function (photo) {
      return { base64: 'data:image/' + (photo.format || 'jpeg') + ';base64,' + photo.base64String, format: 'image/' + (photo.format || 'jpeg') }
    })
  }

  // ---- geolocation ----
  function getCurrentPosition(opts) {
    opts = opts || {}
    var highAccuracy = opts.highAccuracy !== false
    var timeout = opts.timeout || 10000
    if (IN_APP) {
      return import('https://cdn.jsdelivr.net/npm/@capacitor/geolocation@6/dist/esm/index.js').then(function (mod) {
        return mod.Geolocation.getCurrentPosition({ enableHighAccuracy: highAccuracy, timeout })
      }).then(function (pos) {
        return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }
      })
    }
    if (!navigator.geolocation) return Promise.reject(new Error('Geolocation unavailable.'))
    return new Promise(function (resolve, reject) {
      navigator.geolocation.getCurrentPosition(
        function (p) { resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }) },
        reject,
        { enableHighAccuracy: highAccuracy, timeout }
      )
    })
  }

  // ---- push registration ----
  function registerForPush(opts) {
    opts = opts || {}
    if (!IN_APP) return Promise.resolve(false)
    return import('https://cdn.jsdelivr.net/npm/@capacitor/push-notifications@6/dist/esm/index.js').then(function (mod) {
      return mod.PushNotifications.requestPermissions().then(function (perm) {
        if (perm.receive !== 'granted') return false
        return mod.PushNotifications.register().then(function () {
          mod.PushNotifications.addListener('registration', function (token) {
            try {
              fetch('/api/customer-auth/push-token', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: token.value, platform: 'ios' }),
              })
            } catch (_) {}
            if (typeof opts.onToken === 'function') opts.onToken(token.value)
          })
          return true
        })
      })
    }).catch(notReady)
  }

  window.RoofNative = {
    isInApp: IN_APP,
    takePhoto: takePhoto,
    getCurrentPosition: getCurrentPosition,
    registerForPush: registerForPush,
  }

  // Convenience for legacy code that just wants to feature-detect.
  window.IS_NATIVE_APP = IN_APP
})()
