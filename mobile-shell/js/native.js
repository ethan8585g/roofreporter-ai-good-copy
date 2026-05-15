// Roof Manager — native bridges (Capacitor plugins).
//
// This module exposes a single `RoofNative` object that web pages can call
// from anywhere inside the app. It works in two modes:
//   • Native (Capacitor.isNativePlatform() === true) → real plugin calls
//   • Web (browser dev / PWA)                       → polyfills + clear no-ops
//
// To make these bridges available to the live site once we've navigated to
// /customer, /admin, etc., js/native.js is also exposed at runtime via the
// global `window.RoofNative` so server-rendered pages can use it directly
// without a build step. The Hono server detects the Capacitor user-agent
// (task #9) and injects a <script src="..."> tag when present.

const PLUGINS = {}

async function load() {
  try {
    const core = await import('https://cdn.jsdelivr.net/npm/@capacitor/core@6.1.2/dist/index.esm.js')
    PLUGINS.Capacitor = core.Capacitor
  } catch { PLUGINS.Capacitor = null }
  if (!PLUGINS.Capacitor || !PLUGINS.Capacitor.isNativePlatform()) return false
  try {
    const cam = await import('https://cdn.jsdelivr.net/npm/@capacitor/camera@6/dist/esm/index.js')
    PLUGINS.Camera = cam.Camera
  } catch {}
  try {
    const geo = await import('https://cdn.jsdelivr.net/npm/@capacitor/geolocation@6/dist/esm/index.js')
    PLUGINS.Geolocation = geo.Geolocation
  } catch {}
  try {
    const push = await import('https://cdn.jsdelivr.net/npm/@capacitor/push-notifications@6/dist/esm/index.js')
    PLUGINS.PushNotifications = push.PushNotifications
  } catch {}
  return true
}

const ready = load()

export async function isNative() {
  await ready
  return !!(PLUGINS.Capacitor && PLUGINS.Capacitor.isNativePlatform())
}

// ---- camera ----
export async function takePhoto({ source = 'CAMERA', quality = 80 } = {}) {
  await ready
  if (!PLUGINS.Camera) {
    // Web fallback: open a file picker that accepts camera capture.
    return new Promise((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.capture = 'environment'
      input.onchange = () => {
        const file = input.files && input.files[0]
        if (!file) return reject(new Error('No photo captured.'))
        const reader = new FileReader()
        reader.onload = () => resolve({ base64: reader.result, format: file.type, name: file.name })
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      }
      input.click()
    })
  }
  const photo = await PLUGINS.Camera.getPhoto({
    quality,
    allowEditing: false,
    resultType: 'base64',
    source: source === 'PHOTOS' ? 'PHOTOS' : 'CAMERA',
    saveToGallery: false,
  })
  return { base64: 'data:image/' + (photo.format || 'jpeg') + ';base64,' + photo.base64String, format: 'image/' + (photo.format || 'jpeg') }
}

// ---- geolocation ----
export async function getCurrentPosition({ highAccuracy = true, timeout = 10000 } = {}) {
  await ready
  if (PLUGINS.Geolocation) {
    const pos = await PLUGINS.Geolocation.getCurrentPosition({ enableHighAccuracy: highAccuracy, timeout })
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }
  }
  // Web fallback
  if (!navigator.geolocation) throw new Error('Geolocation unavailable.')
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (err) => reject(err),
      { enableHighAccuracy: highAccuracy, timeout },
    )
  })
}

// ---- push notifications ----
// Called once on first launch (or after sign-in) to register for APNs and
// post the token back to the server so we can deliver alerts.
export async function registerForPush({ onToken } = {}) {
  await ready
  if (!PLUGINS.PushNotifications) return false
  const perm = await PLUGINS.PushNotifications.requestPermissions()
  if (perm.receive !== 'granted') return false
  await PLUGINS.PushNotifications.register()
  PLUGINS.PushNotifications.addListener('registration', (token) => {
    try {
      fetch('https://www.roofmanager.ca/api/customer-auth/push-token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.value, platform: 'ios' }),
      })
    } catch (e) { console.warn('[native] push-token post failed:', e.message) }
    if (typeof onToken === 'function') onToken(token.value)
  })
  PLUGINS.PushNotifications.addListener('registrationError', (err) => {
    console.warn('[native] push registration error:', err && err.error)
  })
  return true
}

// ---- Sign in with Apple ----
// Placeholder. The real flow uses @capacitor-community/apple-sign-in. We add
// the plugin dependency in task #7 along with the server-side callback.
export async function signInWithApple() {
  await ready
  if (!PLUGINS.Capacitor) return null
  try {
    const mod = await import('https://cdn.jsdelivr.net/npm/@capacitor-community/apple-sign-in@6/dist/esm/index.js')
    const result = await mod.SignInWithApple.authorize({
      clientId: 'ca.roofmanager.app',
      redirectURI: 'https://www.roofmanager.ca/api/customer-auth/apple/callback',
      scopes: 'email name',
      state: cryptoRandom(),
      nonce: cryptoRandom(),
    })
    return {
      identityToken: result.response.identityToken,
      authorizationCode: result.response.authorizationCode,
      fullName: result.response.givenName || result.response.familyName
        ? [result.response.givenName, result.response.familyName].filter(Boolean).join(' ')
        : null,
      email: result.response.email || null,
    }
  } catch (e) {
    console.warn('[native] apple sign-in failed:', e && e.message)
    return null
  }
}

function cryptoRandom() {
  const a = new Uint8Array(16)
  crypto.getRandomValues(a)
  return Array.from(a).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Expose globally so server-rendered pages can call it without an import.
const RoofNative = { isNative, takePhoto, getCurrentPosition, registerForPush, signInWithApple }
if (typeof window !== 'undefined') window.RoofNative = RoofNative
export default RoofNative
