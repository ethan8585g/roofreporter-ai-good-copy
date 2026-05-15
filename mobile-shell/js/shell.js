// Roof Manager — native shell entry point.
//
// Boot sequence:
//  1. Hide the static splash after ~600ms.
//  2. Try `customerMe()` to check for an existing session cookie.
//     • 200 → straight to launcher (skip login entirely).
//     • 401/anything else → show login.
//  3. Login form submits to /api/customer-auth/login; on success → launcher.
//  4. Launcher tile click hands off to the live site via plain navigation
//     (the WebView shares cookies with itself, so the user stays authed).
//
// Apple / native bridges live in js/native.js and are imported lazily so
// the shell still renders cleanly in a browser tab during development.

import { api } from './api.js'
import { renderLauncher } from './launcher.js'

const SCREENS = ['splash', 'auth', 'launcher']
function show(name) {
  for (const s of SCREENS) {
    const el = document.getElementById('screen-' + s)
    if (!el) continue
    if (s === name) { el.hidden = false; el.classList.add('visible') }
    else { el.hidden = true; el.classList.remove('visible') }
  }
}

function setError(msg) {
  const e = document.getElementById('auth-error')
  if (!e) return
  if (!msg) { e.hidden = true; e.textContent = ''; return }
  e.hidden = false; e.textContent = msg
}

async function bootstrap() {
  // Smooth splash → auth/launcher handoff
  await new Promise((r) => setTimeout(r, 600))

  // 1) try existing session
  try {
    const me = await api.customerMe()
    if (me && me.customer) {
      enterLauncher(me.customer, 'customer')
      return
    }
  } catch (e) {
    if (e.status !== 401 && e.status !== 403) console.warn('[shell] customer me probe failed:', e.message)
  }

  // 2) try admin session (super-admins land here without a customer row)
  try {
    const me = await api.adminMe()
    if (me && me.user) {
      const role = (me.user.role || '').toLowerCase()
      enterLauncher(me.user, role === 'superadmin' || role === 'super_admin' ? 'superadmin' : 'admin')
      return
    }
  } catch (e) {
    if (e.status !== 401 && e.status !== 403) console.warn('[shell] admin me probe failed:', e.message)
  }

  show('auth')
}

function enterLauncher(user, role) {
  show('launcher')
  renderLauncher({
    user, role,
    openModule: (url) => {
      // Plain navigation — the WebView keeps its session cookies and we
      // hand off to the live SSR site. Native bridges still work because
      // js/native.js is loaded on every Capacitor page via inject (TBD).
      window.location.href = url
    },
    onLogout: async () => {
      try { await api.customerLogout() } catch {}
      show('auth')
    },
  })
}

function wireAuthForm() {
  const form = document.getElementById('auth-form')
  const btn = document.getElementById('auth-submit')
  if (!form) return
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault()
    setError(null)
    const email = (document.getElementById('auth-email').value || '').trim()
    const password = document.getElementById('auth-password').value
    if (!email || !password) { setError('Email and password are required.'); return }
    btn.disabled = true
    btn.textContent = 'Signing in…'
    try {
      // Try customer first (most users). If that 401s, try admin.
      let result, role = 'customer'
      try {
        result = await api.customerLogin(email, password)
      } catch (e) {
        if (e.status === 401) {
          try {
            result = await api.adminLogin(email, password)
            const r = (result && result.user && result.user.role) ? String(result.user.role).toLowerCase() : 'admin'
            role = (r === 'superadmin' || r === 'super_admin') ? 'superadmin' : 'admin'
          } catch (e2) { throw e2 }
        } else { throw e }
      }
      const profile = (result && (result.customer || result.user)) || { email }
      enterLauncher(profile, role)
    } catch (e) {
      setError(e.message || 'Sign-in failed.')
    } finally {
      btn.disabled = false
      btn.textContent = 'Sign in'
    }
  })

  // Apple / Google buttons: native flow handled by js/native.js once it's
  // wired (task #6 + #7). For now they navigate to the web OAuth pages.
  const appleBtn = document.getElementById('auth-apple')
  if (appleBtn) appleBtn.onclick = async () => {
    try {
      const mod = await import('./native.js')
      if (mod.signInWithApple) {
        const cred = await mod.signInWithApple()
        if (cred) {
          const result = await api.customerApple(cred.identityToken, cred.authorizationCode, cred.fullName, cred.email)
          const profile = (result && (result.customer || result.user)) || { email: cred.email }
          enterLauncher(profile, 'customer')
          return
        }
      }
    } catch (e) { console.warn('[shell] apple sign-in fallback to web:', e.message) }
    window.location.href = 'https://www.roofmanager.ca/customer/login?provider=apple'
  }
  const googleBtn = document.getElementById('auth-google')
  if (googleBtn) googleBtn.onclick = () => {
    window.location.href = 'https://www.roofmanager.ca/customer/login?provider=google'
  }
  const registerLink = document.getElementById('link-register')
  if (registerLink) registerLink.onclick = (ev) => {
    ev.preventDefault()
    window.location.href = 'https://www.roofmanager.ca/customer/register'
  }
  // External links (terms / privacy) — open in same WebView; allowed by
  // capacitor.config.ts allowNavigation entries.
  document.querySelectorAll('a[data-external]').forEach((a) => {
    a.addEventListener('click', (ev) => {
      ev.preventDefault()
      window.location.href = a.getAttribute('data-external')
    })
  })
}

document.addEventListener('DOMContentLoaded', () => {
  wireAuthForm()
  bootstrap()
})
