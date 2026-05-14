// ============================================================
// Roof Manager — GA4 Grant (super-admin only)
//
// One-time helper that grants the GCP service account Viewer access on the
// configured GA4 property by mounting an OAuth flow with the admin's Google
// account. Avoids manually clicking through GA4 Admin → Property Access.
//
// Flow:
//   GET  /                       Page with "Authorize Google" button
//   GET  /start                  302 → Google OAuth consent (analytics.edit)
//   GET  /callback?code=...      Exchange code → token → call GA4 Admin API
//                                to add SA as Viewer → render result
// ============================================================

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { validateAdminSession, requireSuperadmin } from './auth'

export const ga4GrantRoutes = new Hono<{ Bindings: Bindings }>()

async function requireSuperAdmin(c: any): Promise<boolean> {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  return requireSuperadmin(admin)
}

ga4GrantRoutes.use('/*', async (c, next) => {
  const ok = await requireSuperAdmin(c)
  if (!ok) {
    return c.html(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:40px;text-align:center;">
<h2>Super-admin login required</h2>
<p><a href="/admin/login?next=/super-admin/ga4-grant">Sign in →</a></p>
</body></html>`, 403)
  }
  return next()
})

// Pull the SA client_email out of GCP_SERVICE_ACCOUNT_KEY safely.
function getSaEmail(env: Bindings): string | null {
  try { return JSON.parse(env.GCP_SERVICE_ACCOUNT_KEY || '{}').client_email || null } catch { return null }
}
// Normalize GA4_PROPERTY_ID to the numeric tail (Admin API uses `properties/{id}` paths).
function getPropertyNumeric(env: Bindings): string | null {
  const raw = String(env.GA4_PROPERTY_ID || '').trim()
  if (!raw) return null
  const m = raw.match(/(\d+)$/)
  return m ? m[1] : null
}

// ── Landing page ──
ga4GrantRoutes.get('/', async (c) => {
  const saEmail = getSaEmail(c.env)
  const propId = getPropertyNumeric(c.env)
  const clientId = (c.env as any).GMAIL_CLIENT_ID || ''
  const url = new URL(c.req.url)
  const redirectUri = `${url.protocol}//${url.host}/super-admin/ga4-grant/callback`

  const missing: string[] = []
  if (!saEmail) missing.push('GCP_SERVICE_ACCOUNT_KEY (or it is malformed)')
  if (!propId) missing.push('GA4_PROPERTY_ID')
  if (!clientId) missing.push('GMAIL_CLIENT_ID (reused as OAuth client for this flow)')

  return c.html(`<!DOCTYPE html>
<html><head>
<title>Grant GA4 Access</title>
<link rel="stylesheet" href="/static/tailwind.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"></script>
</head>
<body class="bg-gray-50 min-h-screen p-8">
<div class="max-w-2xl mx-auto bg-white rounded-2xl shadow p-8">
  <a href="/super-admin/dashboard" class="text-sm text-gray-500 hover:text-gray-700"><i class="fas fa-arrow-left mr-1"></i> Back to dashboard</a>
  <h1 class="text-2xl font-bold text-gray-900 mt-2 mb-1">Grant GA4 Viewer Access</h1>
  <p class="text-gray-600 mb-6">One-click helper. Authorize with your Google account (the one that admins the GA4 property), and we'll add the service account as a Viewer for you.</p>

  ${missing.length ? `
  <div class="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
    <p class="text-sm font-bold text-red-800"><i class="fas fa-exclamation-triangle mr-1"></i> Missing configuration</p>
    <ul class="list-disc ml-6 mt-2 text-sm text-red-700">
      ${missing.map(m => `<li>${m}</li>`).join('')}
    </ul>
  </div>` : ''}

  <div class="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6 text-sm">
    <div class="flex justify-between mb-2"><span class="text-gray-500">Service account</span><code class="font-mono">${saEmail || '—'}</code></div>
    <div class="flex justify-between mb-2"><span class="text-gray-500">GA4 property</span><code class="font-mono">${propId ? `properties/${propId}` : '—'}</code></div>
    <div class="flex justify-between"><span class="text-gray-500">Role to grant</span><code class="font-mono">predefinedRoles/read (Viewer)</code></div>
  </div>

  <div class="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-900">
    <p class="font-semibold mb-1"><i class="fas fa-info-circle mr-1"></i> First time only</p>
    <p>This page reuses your existing Google OAuth client (the same one used for Gmail send). You must add this redirect URI in your <a href="https://console.cloud.google.com/apis/credentials" target="_blank" class="underline">GCP OAuth client</a> before clicking the button below:</p>
    <code class="block bg-white border border-amber-300 rounded px-2 py-1 mt-2 break-all font-mono text-xs">${redirectUri}</code>
    <p class="mt-2">Also ensure <code>https://www.googleapis.com/auth/analytics.edit</code> is listed in your OAuth consent screen's scopes (and that your Google account is a test user if the app is in testing mode).</p>
  </div>

  <button id="auth-btn" onclick="window.location.href='/super-admin/ga4-grant/start'"
    class="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl shadow ${missing.length ? 'opacity-50 cursor-not-allowed' : ''}"
    ${missing.length ? 'disabled' : ''}>
    <i class="fab fa-google mr-2"></i> Authorize Google &amp; Grant Viewer
  </button>
</div>
</body></html>`)
})

// ── OAuth start ──
ga4GrantRoutes.get('/start', async (c) => {
  const clientId = (c.env as any).GMAIL_CLIENT_ID
  if (!clientId) return c.json({ error: 'GMAIL_CLIENT_ID not configured' }, 400)
  const propId = getPropertyNumeric(c.env)
  const saEmail = getSaEmail(c.env)
  if (!propId || !saEmail) return c.json({ error: 'GA4_PROPERTY_ID or service account missing' }, 400)

  const url = new URL(c.req.url)
  const redirectUri = `${url.protocol}//${url.host}/super-admin/ga4-grant/callback`
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  // analytics.edit covers Admin-API access-binding writes; we don't need offline/refresh here
  // because the grant is a one-shot call.
  authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/analytics.edit')
  authUrl.searchParams.set('access_type', 'online')
  authUrl.searchParams.set('prompt', 'consent')
  return c.redirect(authUrl.toString())
})

// ── OAuth callback: exchange code, call Admin API, render outcome ──
ga4GrantRoutes.get('/callback', async (c) => {
  const code = c.req.query('code')
  const oauthErr = c.req.query('error')

  const renderResult = (title: string, body: string, ok: boolean) => c.html(`<!DOCTYPE html>
<html><head><title>${title}</title><link rel="stylesheet" href="/static/tailwind.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"></script></head>
<body class="bg-gray-50 min-h-screen p-8">
<div class="max-w-2xl mx-auto bg-white rounded-2xl shadow p-8">
  <div class="flex items-center gap-3 mb-4">
    <i class="fas ${ok ? 'fa-check-circle text-green-500' : 'fa-times-circle text-red-500'} text-3xl"></i>
    <h1 class="text-2xl font-bold ${ok ? 'text-green-800' : 'text-red-800'}">${title}</h1>
  </div>
  ${body}
  <div class="mt-6 flex gap-3">
    <a href="/super-admin/dashboard" class="bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg text-sm">← Dashboard</a>
    <a href="/super-admin/ga4-grant" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm">Try again</a>
  </div>
</div></body></html>`)

  if (oauthErr || !code) {
    return renderResult('OAuth declined', `<p class="text-gray-700">Google returned: <code class="bg-gray-100 px-1 rounded">${oauthErr || 'no code'}</code></p>`, false)
  }

  const clientId = (c.env as any).GMAIL_CLIENT_ID
  const clientSecret = (c.env as any).GMAIL_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return renderResult('Configuration error', `<p>GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET not configured.</p>`, false)
  }
  const url = new URL(c.req.url)
  const redirectUri = `${url.protocol}//${url.host}/super-admin/ga4-grant/callback`

  // Exchange code → access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  })
  const tokenData: any = await tokenRes.json().catch(() => ({}))
  if (!tokenRes.ok || !tokenData.access_token) {
    return renderResult('Token exchange failed', `<p>Google said:</p><pre class="bg-gray-100 p-3 rounded text-xs overflow-auto">${JSON.stringify(tokenData, null, 2)}</pre>`, false)
  }
  const accessToken: string = tokenData.access_token

  const saEmail = getSaEmail(c.env)
  const propId = getPropertyNumeric(c.env)
  if (!saEmail || !propId) {
    return renderResult('Missing config', `<p>Service account email or GA4 property ID is missing.</p>`, false)
  }

  // Call GA4 Admin API: create access binding for the SA as Viewer.
  // Predefined roles in v1beta: predefinedRoles/read (Viewer), /collaborate, /edit, /manage-users, /no-cost-data, /no-revenue-data.
  const bindingRes = await fetch(`https://analyticsadmin.googleapis.com/v1beta/properties/${propId}/accessBindings`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user: saEmail,
      roles: ['predefinedRoles/read'],
    }),
  })
  const bindingBody = await bindingRes.text()
  let parsed: any = null
  try { parsed = JSON.parse(bindingBody) } catch {}

  if (!bindingRes.ok) {
    // 409 Conflict means the binding already exists — that's actually success for our purposes.
    const msg = String(parsed?.error?.message || bindingBody).toLowerCase()
    if (bindingRes.status === 409 || msg.includes('already')) {
      return renderResult('Already granted', `<p class="text-gray-700"><code class="bg-gray-100 px-1 rounded">${saEmail}</code> already has access on <code class="bg-gray-100 px-1 rounded">properties/${propId}</code>.</p><p class="mt-2 text-sm text-gray-500">If GA4 is still 403'ing, double-check the Google Analytics Data API is enabled in your GCP project, then reload Growth → Traffic.</p>`, true)
    }
    return renderResult('Admin API call failed', `
<p class="text-gray-700 mb-2">HTTP ${bindingRes.status} from GA4 Admin API.</p>
<pre class="bg-gray-100 p-3 rounded text-xs overflow-auto">${(parsed?.error?.message || bindingBody).slice(0, 1200)}</pre>
<p class="mt-3 text-sm text-gray-500">Common causes: your Google account doesn't have Admin role on the GA4 property; Google Analytics Admin API not enabled in any project you have access to.</p>`, false)
  }

  return renderResult('GA4 access granted', `
<p class="text-gray-700">Added <code class="bg-gray-100 px-1 rounded">${saEmail}</code> as Viewer on <code class="bg-gray-100 px-1 rounded">properties/${propId}</code>.</p>
<p class="mt-2 text-sm text-gray-500">Reload Growth → Traffic — the red banner should disappear within a few seconds.</p>
<details class="mt-3"><summary class="text-xs text-gray-400 cursor-pointer">API response</summary>
<pre class="bg-gray-50 p-2 rounded text-xs overflow-auto">${JSON.stringify(parsed, null, 2)}</pre></details>`, true)
})
