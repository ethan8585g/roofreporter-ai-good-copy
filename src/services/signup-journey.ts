// ============================================================
// SIGNUP-JOURNEY TRACE — Walks the entire logged-in customer
// surface as a freshly-signed-up user would, looking for dead
// ends, broken pages, and broken settings toggles.
//
// Triggered by: /loop /signup-journey (POST /api/signup-journey/tick)
// Synthetic auth: persistent journey-probe customer (see
// services/synthetic-auth.ts ensureJourneyProbeCustomer).
//
// Three classes of checks:
//   1. PAGE WALK     GET each /customer/* page — expect 200 + non-empty
//                    HTML + no obvious error markup.
//   2. API WALK      GET each authenticated /api/customer-auth/* read
//                    endpoint — expect 200 + valid JSON.
//   3. TOGGLE ROUND-TRIP   For a small set of safe PUT endpoints,
//                    GET → PUT same body back → GET → assert value
//                    persisted. Catches toggles that 200 but silently
//                    drop the write.
// ============================================================

import type { Bindings } from '../types'
import { issueJourneyProbeSession } from './synthetic-auth'

const PROD_BASE = 'https://www.roofmanager.ca'

export type DeadEndSeverity = 'error' | 'warn'

export interface DeadEnd {
  category: 'page' | 'api' | 'toggle'
  path: string
  severity: DeadEndSeverity
  status: number | null
  message: string
  details?: Record<string, any>
}

export interface JourneyResult {
  ok: boolean
  verdict: 'pass' | 'warn' | 'fail'
  checked_at: string
  duration_ms: number
  probe_created: boolean
  pages_checked: number
  apis_checked: number
  toggles_checked: number
  pages_failed: number
  apis_failed: number
  toggles_failed: number
  dead_ends: DeadEnd[]
}

// Customer-facing pages a freshly-signed-up user would land on.
// Kept narrow on purpose — Cloudflare Workers cap us at 50 subrequests
// per invocation. Budget: pages + apis + toggles*3 + 2 (email) <= 50.
// Including /customer (bare) on purpose — it currently 404s, which is
// a real dead end for any user who types the URL without a sub-path.
const CUSTOMER_PAGES = [
  '/customer',
  '/customer/dashboard',
  '/customer/new-order',
  '/customer/order',
  '/customer/buy-reports',
  '/customer/profile',
  '/customer/integrations',
  '/customer/material-calculator',
  '/customer/property-imagery',
  '/customer/reports',
  '/customer/customers',
  '/customer/invoices',
  '/customer/proposals',
  '/customer/jobs',
  '/customer/pipeline',
  '/customer/leads',
  '/customer/widget',
  '/customer/google-business',
  '/customer/google-ads',
  '/customer/website-builder',
]

// Authenticated GETs that drive the dashboard. A 5xx here means the
// page renders but its data fails to load — exactly the silent dead
// end we want to catch.
const CUSTOMER_API_GETS = [
  '/api/customer-auth/me',
  '/api/customer-auth/profile',
  '/api/customer-auth/last-order-defaults',
  '/api/customer-auth/orders',
  '/api/customer-auth/invoices',
  '/api/customer-auth/reports-list',
  '/api/customer-auth/item-library',
  '/api/customer-auth/material-preferences',
]

// Strings that, when present in an HTML response with status 200,
// indicate a soft dead end (the framework caught the error but the
// user sees nothing useful). Conservative — flag only obvious tells.
const PAGE_ERROR_TELLS = [
  '<title>Error</title>',
  '<title>Page Not Found</title>',
  'something went wrong',
  '<h1>500</h1>',
  '<h1>404</h1>',
  'this page is not available',
]

export async function runSignupJourney(env: Bindings): Promise<JourneyResult> {
  const t0 = Date.now()
  const checkedAt = new Date().toISOString()
  const dead: DeadEnd[] = []

  // 1. Mint synthetic customer session
  const probe = await issueJourneyProbeSession(env)
  const cookie = `rm_customer_session=${probe.token}`

  // 2. Page walk
  const pageResults = await Promise.all(
    CUSTOMER_PAGES.map(p => probePage(p, cookie))
  )
  for (const r of pageResults) {
    if (!r.ok) dead.push({
      category: 'page',
      path: r.path,
      severity: r.severity,
      status: r.status,
      message: r.message,
      details: r.details,
    })
  }
  const pagesFailed = pageResults.filter(r => !r.ok).length

  // 3. API walk
  const apiResults = await Promise.all(
    CUSTOMER_API_GETS.map(p => probeApi(p, cookie))
  )
  for (const r of apiResults) {
    if (!r.ok) dead.push({
      category: 'api',
      path: r.path,
      severity: r.severity,
      status: r.status,
      message: r.message,
      details: r.details,
    })
  }
  const apisFailed = apiResults.filter(r => !r.ok).length

  // 4. Toggle round-trips (read → write same value back → read again)
  const toggleResults = await runToggleRoundtrips(cookie)
  for (const r of toggleResults) {
    if (!r.ok) dead.push({
      category: 'toggle',
      path: r.endpoint,
      severity: r.severity,
      status: r.status,
      message: r.message,
      details: r.details,
    })
  }
  const togglesFailed = toggleResults.filter(r => !r.ok).length

  // 5. Cleanup the session we minted (probe customer stays).
  await env.DB.prepare(
    `DELETE FROM customer_sessions WHERE session_token = ?`
  ).bind(probe.token).run().catch(() => {})

  const errorCount = dead.filter(d => d.severity === 'error').length
  const verdict: JourneyResult['verdict'] = errorCount > 0 ? 'fail' : dead.length > 0 ? 'warn' : 'pass'

  return {
    ok: verdict === 'pass',
    verdict,
    checked_at: checkedAt,
    duration_ms: Date.now() - t0,
    probe_created: probe.createdProbe,
    pages_checked: CUSTOMER_PAGES.length,
    apis_checked: CUSTOMER_API_GETS.length,
    toggles_checked: toggleResults.length,
    pages_failed: pagesFailed,
    apis_failed: apisFailed,
    toggles_failed: togglesFailed,
    dead_ends: dead,
  }
}

// ── Page probe ──────────────────────────────────────────────────
async function probePage(path: string, cookie: string): Promise<{
  ok: boolean; path: string; status: number | null; severity: DeadEndSeverity; message: string; details?: any
}> {
  try {
    const res = await fetch(`${PROD_BASE}${path}`, {
      method: 'GET',
      headers: { 'Cookie': cookie, 'User-Agent': 'RoofManagerSignupJourney/1.0' },
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    })
    const status = res.status
    // 2xx → check body for error tells
    if (status >= 200 && status < 300) {
      const text = await res.text()
      if (text.length < 500) {
        return { ok: false, path, status, severity: 'warn', message: `body too short (${text.length} bytes) — likely empty render` }
      }
      const lower = text.toLowerCase()
      const tell = PAGE_ERROR_TELLS.find(t => lower.includes(t.toLowerCase()))
      if (tell) {
        return { ok: false, path, status, severity: 'error', message: `error markup detected ("${tell}")` }
      }
      return { ok: true, path, status, severity: 'warn', message: 'OK' }
    }
    // 3xx → flag if redirect target is /login (logged-in user being bounced
    // out is a clear dead end), tolerate other redirects.
    if (status >= 300 && status < 400) {
      const loc = res.headers.get('location') || ''
      if (loc.includes('/login') || loc.includes('/register')) {
        return { ok: false, path, status, severity: 'error', message: `auth bounced: redirected to ${loc}`, details: { location: loc } }
      }
      return { ok: true, path, status, severity: 'warn', message: `redirected to ${loc}` }
    }
    // 4xx/5xx
    const sev: DeadEndSeverity = status >= 500 ? 'error' : 'warn'
    return { ok: false, path, status, severity: sev, message: `HTTP ${status}` }
  } catch (e: any) {
    return { ok: false, path, status: null, severity: 'error', message: `request threw: ${String(e?.message || e).slice(0, 200)}` }
  }
}

// ── API probe ───────────────────────────────────────────────────
async function probeApi(path: string, cookie: string): Promise<{
  ok: boolean; path: string; status: number | null; severity: DeadEndSeverity; message: string; details?: any
}> {
  try {
    const res = await fetch(`${PROD_BASE}${path}`, {
      method: 'GET',
      headers: {
        'Cookie': cookie,
        'User-Agent': 'RoofManagerSignupJourney/1.0',
        'Accept': 'application/json',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    })
    const status = res.status
    if (status >= 200 && status < 300) {
      const text = await res.text()
      try {
        JSON.parse(text)
      } catch {
        return { ok: false, path, status, severity: 'error', message: `2xx but body is not JSON (${text.slice(0, 60)}…)` }
      }
      return { ok: true, path, status, severity: 'warn', message: 'OK' }
    }
    // Some endpoints (gcal/status, referrals/payouts) legitimately 404 when
    // not configured — treat as warn so they don't drown out real errors.
    const sev: DeadEndSeverity = status >= 500 ? 'error' : 'warn'
    return { ok: false, path, status, severity: sev, message: `HTTP ${status}` }
  } catch (e: any) {
    return { ok: false, path, status: null, severity: 'error', message: `request threw: ${String(e?.message || e).slice(0, 200)}` }
  }
}

// ── Toggle round-trip ───────────────────────────────────────────
// Tests that GET → PUT (same body) → GET round-trips successfully.
// A toggle that 200s but loses the write is a classic dead end:
// the user clicks save, sees a checkmark, refreshes the page, and
// the change is gone.
type Toggle = {
  name: string
  getEndpoint: string
  putEndpoint: string
  // Pull the round-trippable subset of the GET response that we'll
  // PUT back. Returning null → the GET shape is unexpected, abort.
  // The PUT body we send is exactly what extract returns.
  extract: (json: any) => Record<string, any> | null
  // After the PUT and second GET, confirm the values we sent are
  // still present. Returns the offending field name if drift detected.
  verify: (sent: Record<string, any>, after: any) => string | null
}

const TOGGLES: Toggle[] = [
  {
    name: 'profile (name/phone)',
    getEndpoint: '/api/customer-auth/profile',
    putEndpoint: '/api/customer-auth/profile',
    extract: (j) => {
      // GET /profile returns { customer: { ... } }; the PUT endpoint expects
      // top-level name/phone/etc. Send the existing values back so the
      // round-trip is idempotent (name uses COALESCE so null wouldn't
      // overwrite anyway, but we'd then mis-flag drift).
      const c = j?.customer || j?.profile || j
      if (!c || typeof c !== 'object' || !c.name) return null
      return {
        name: c.name,
        phone: c.phone ?? null,
        company_name: c.company_name ?? null,
      }
    },
    verify: (sent, after) => {
      const a = after?.customer || after?.profile || after
      if (!a) return 'response shape changed'
      for (const k of ['name', 'phone', 'company_name']) {
        if ((sent as any)[k] !== a[k]) return k
      }
      return null
    },
  },
  {
    name: 'material-preferences',
    getEndpoint: '/api/customer-auth/material-preferences',
    putEndpoint: '/api/customer-auth/material-preferences',
    extract: (j) => {
      // Endpoint shape: { preferences: {...} } or {...} directly
      const p = j?.preferences || j
      if (!p || typeof p !== 'object') return null
      // Round-trip a single benign field if present, otherwise empty obj.
      return p.preferred_shingle ? { preferred_shingle: p.preferred_shingle } : {}
    },
    verify: (sent, after) => {
      const a = after?.preferences || after
      if (!a) return 'response shape changed'
      if ('preferred_shingle' in sent && sent.preferred_shingle !== a.preferred_shingle) return 'preferred_shingle'
      return null
    },
  },
]

async function runToggleRoundtrips(cookie: string): Promise<Array<{
  ok: boolean; endpoint: string; status: number | null; severity: DeadEndSeverity; message: string; details?: any
}>> {
  const out: Array<{ ok: boolean; endpoint: string; status: number | null; severity: DeadEndSeverity; message: string; details?: any }> = []
  for (const t of TOGGLES) {
    try {
      // 1. Initial GET
      const get1 = await fetch(`${PROD_BASE}${t.getEndpoint}`, {
        method: 'GET',
        headers: { 'Cookie': cookie, 'Accept': 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      })
      if (get1.status !== 200) {
        out.push({ ok: false, endpoint: t.name, status: get1.status, severity: 'error', message: `initial GET failed (HTTP ${get1.status})` })
        continue
      }
      const get1Json: any = await get1.json().catch(() => null)
      const sent = t.extract(get1Json)
      if (sent === null) {
        out.push({ ok: false, endpoint: t.name, status: get1.status, severity: 'warn', message: 'GET response shape unexpected — extract returned null' })
        continue
      }

      // 2. PUT same body back
      const put = await fetch(`${PROD_BASE}${t.putEndpoint}`, {
        method: 'PUT',
        headers: { 'Cookie': cookie, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(sent),
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      })
      if (put.status < 200 || put.status >= 300) {
        out.push({ ok: false, endpoint: t.name, status: put.status, severity: 'error', message: `PUT failed (HTTP ${put.status})` })
        continue
      }

      // 3. GET again, verify persistence
      const get2 = await fetch(`${PROD_BASE}${t.getEndpoint}`, {
        method: 'GET',
        headers: { 'Cookie': cookie, 'Accept': 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      })
      if (get2.status !== 200) {
        out.push({ ok: false, endpoint: t.name, status: get2.status, severity: 'error', message: `verify GET failed (HTTP ${get2.status})` })
        continue
      }
      const get2Json: any = await get2.json().catch(() => null)
      const drift = t.verify(sent, get2Json)
      if (drift) {
        out.push({
          ok: false, endpoint: t.name, status: 200, severity: 'error',
          message: `toggle dropped write — '${drift}' did not persist after PUT`,
          details: { sent, after: get2Json },
        })
        continue
      }
      out.push({ ok: true, endpoint: t.name, status: 200, severity: 'warn', message: 'round-trip OK' })
    } catch (e: any) {
      out.push({ ok: false, endpoint: t.name, status: null, severity: 'error', message: `threw: ${String(e?.message || e).slice(0, 200)}` })
    }
  }
  return out
}
