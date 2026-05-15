// ============================================================
// SIGNUP-HEALTH CHECK — Daily comprehensive sweep of every signal
// that could indicate Roof Manager is losing prospective or new
// customers. Composes the result for sendSignupHealthEmail().
//
// Triggered by: /loop /signup-health (POST /api/signup-health/tick)
//
// Sections, in order of business impact:
//   1. signup_smoke      HTTP probes of the customer-auth surface
//   2. gmail_transport   Mints a Gmail OAuth2 access token
//   3. funnel_regression Trailing 24h vs 7×24h baseline (signups, orders)
//   4. backend_core      D1 latency + critical secrets present
//   5. surface_scans     Last scan_public/customer/admin findings
//   6. reports_health    Stuck-enhancing, failed, orphan reports
//   7. payments_health   Unmatched square_payments + recent failures
//
// Each section returns { status: 'pass' | 'warn' | 'fail', details, summary }.
// The overall verdict is the worst section.
// ============================================================

import type { Bindings } from '../types'
import { loadGmailCreds } from './email'

const PROD_BASE = 'https://www.roofmanager.ca'

export type SectionStatus = 'pass' | 'warn' | 'fail'

export interface SectionResult {
  key: string
  label: string
  status: SectionStatus
  summary: string
  details: Record<string, any>
}

export interface SignupHealthResult {
  ok: boolean
  verdict: SectionStatus
  checked_at: string
  duration_ms: number
  sections: SectionResult[]
  issues: Array<{ section: string; severity: 'warn' | 'error'; message: string }>
}

export async function runSignupHealthCheck(env: Bindings): Promise<SignupHealthResult> {
  const t0 = Date.now()
  const checkedAt = new Date().toISOString()

  const sections = await Promise.all([
    section('signup_smoke', 'Sign-up surface', () => checkSignupSmoke()),
    section('gmail_transport', 'Email delivery (Gmail OAuth2)', () => checkGmailTransport(env)),
    section('funnel_regression', 'Funnel volume vs 7-day baseline', () => checkFunnelRegression(env)),
    section('backend_core', 'Backend foundations', () => checkBackendCore(env)),
    section('surface_scans', 'Public + customer surface scans', () => checkSurfaceScans(env)),
    section('reports_health', 'Reports — stuck, failed, orphan', () => checkReportsHealth(env)),
    section('payments_health', 'Payments — unmatched + recent failures', () => checkPaymentsHealth(env)),
  ])

  const verdict: SectionStatus =
    sections.some(s => s.status === 'fail') ? 'fail' :
    sections.some(s => s.status === 'warn') ? 'warn' : 'pass'

  const issues = sections.flatMap(s => {
    if (s.status === 'pass') return []
    return [{
      section: s.key,
      severity: (s.status === 'fail' ? 'error' : 'warn') as 'error' | 'warn',
      message: `${s.label}: ${s.summary}`,
    }]
  })

  return {
    ok: verdict === 'pass',
    verdict,
    checked_at: checkedAt,
    duration_ms: Date.now() - t0,
    sections,
    issues,
  }
}

// Wrap each check so a thrown error becomes a 'fail' section instead of
// nuking the whole sweep — the email still goes out describing what broke.
async function section(
  key: string,
  label: string,
  fn: () => Promise<Omit<SectionResult, 'key' | 'label'>>,
): Promise<SectionResult> {
  try {
    const r = await fn()
    return { key, label, ...r }
  } catch (e: any) {
    return {
      key,
      label,
      status: 'fail',
      summary: `check threw: ${String(e?.message || e).slice(0, 200)}`,
      details: { error: String(e?.message || e) },
    }
  }
}

// ── 1. Sign-up surface smoke probes ─────────────────────────────
// Don't actually create a user (would dirty prod data + send a real
// verification email). Just confirm the endpoints are alive and the
// /register page renders. Each probe has an "expected" status range.
async function checkSignupSmoke(): Promise<Omit<SectionResult, 'key' | 'label'>> {
  const probes: Array<{ name: string; method: 'GET' | 'POST'; path: string; body?: any; expectIn: number[]; expectBodyContains?: string[] }> = [
    {
      name: 'GET /register renders',
      method: 'GET',
      path: '/register',
      expectIn: [200],
      expectBodyContains: ['email', 'password'],
    },
    {
      name: 'GET /signup redirects',
      method: 'GET',
      path: '/signup',
      // Hono's redirect can return 302; following redirects we land on /register.
      // Treat any 2xx or 3xx as alive.
      expectIn: [200, 301, 302, 303, 307, 308],
    },
    {
      name: 'POST /api/customer-auth/login (empty body)',
      method: 'POST',
      path: '/api/customer-auth/login',
      body: {},
      expectIn: [400, 401, 422],
    },
    {
      name: 'POST /api/customer-auth/send-verification (empty body)',
      method: 'POST',
      path: '/api/customer-auth/send-verification',
      body: {},
      expectIn: [400, 422],
    },
    {
      name: 'POST /api/customer-auth/register (empty body)',
      method: 'POST',
      path: '/api/customer-auth/register',
      body: {},
      expectIn: [400, 422],
    },
  ]

  const results: Array<{ name: string; ok: boolean; status: number | null; note?: string }> = []
  for (const p of probes) {
    try {
      const init: RequestInit = {
        method: p.method,
        headers: { 'User-Agent': 'RoofManagerSignupHealth/1.0', 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
        redirect: 'manual',
      }
      if (p.body !== undefined) init.body = JSON.stringify(p.body)
      const res = await fetch(`${PROD_BASE}${p.path}`, init)
      const ok = p.expectIn.includes(res.status)
      let note: string | undefined
      if (ok && p.expectBodyContains && p.expectBodyContains.length) {
        const text = (await res.text()).toLowerCase()
        const missing = p.expectBodyContains.filter(s => !text.includes(s.toLowerCase()))
        if (missing.length) {
          results.push({ name: p.name, ok: false, status: res.status, note: `missing fields: ${missing.join(', ')}` })
          continue
        }
      } else if (!ok) {
        note = `expected ${p.expectIn.join('/')}, got ${res.status}`
      }
      results.push({ name: p.name, ok, status: res.status, note })
    } catch (e: any) {
      results.push({ name: p.name, ok: false, status: null, note: String(e?.message || e).slice(0, 160) })
    }
  }

  const failed = results.filter(r => !r.ok)
  const status: SectionStatus = failed.length === 0 ? 'pass' : 'fail'
  const summary = failed.length === 0
    ? `${results.length} probes OK`
    : `${failed.length}/${results.length} probes failed: ${failed.map(f => f.name).join('; ')}`
  return { status, summary, details: { probes: results } }
}

// ── 2. Gmail OAuth2 transport ───────────────────────────────────
// Mint a real access token. If this fails, every welcome / verification /
// trace-completed email silently dies and the user thinks we ghosted them.
async function checkGmailTransport(env: Bindings): Promise<Omit<SectionResult, 'key' | 'label'>> {
  const creds = await loadGmailCreds(env as any)
  if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
    const missing = [
      !creds.clientId && 'client_id',
      !creds.clientSecret && 'client_secret',
      !creds.refreshToken && 'refresh_token',
    ].filter(Boolean) as string[]
    return {
      status: 'fail',
      summary: `Gmail creds missing: ${missing.join(', ')} — sends will fail`,
      details: { creds_summary: { client_id: !!creds.clientId, client_secret: creds.source.clientSecret, refresh_token: creds.source.refreshToken, sender_email: creds.source.senderEmail } },
    }
  }
  try {
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: creds.refreshToken,
      }).toString(),
      signal: AbortSignal.timeout(10000),
    })
    if (!resp.ok) {
      const text = (await resp.text()).slice(0, 200)
      return {
        status: 'fail',
        summary: `token mint failed (${resp.status}): ${text}`,
        details: { status: resp.status, body: text },
      }
    }
    const body: any = await resp.json().catch(() => ({}))
    if (!body?.access_token) {
      return { status: 'fail', summary: 'token mint returned 200 with no access_token', details: { body } }
    }
    return {
      status: 'pass',
      summary: `OK · expires_in ${body.expires_in}s`,
      details: { expires_in_s: body.expires_in, scope: body.scope || null },
    }
  } catch (e: any) {
    return { status: 'fail', summary: `token mint network error: ${String(e?.message || e).slice(0, 200)}`, details: {} }
  }
}

// ── 3. Funnel regression (trailing 24h vs 7×24h baseline) ───────
// Trimmed-down port of evaluateFunnel(); we only need the headline
// numbers for the email — full per-stage breakdown lives in the
// dedicated /funnel-monitor command for those who want it.
async function checkFunnelRegression(env: Bindings): Promise<Omit<SectionResult, 'key' | 'label'>> {
  const HOUR_MS = 60 * 60 * 1000
  const now = Date.now()
  const win = 24 * HOUR_MS

  const customersRes = await env.DB.prepare(`
    SELECT created_at FROM customers
    WHERE created_at >= ?
      AND email NOT LIKE '%@invalid.local'
      AND email NOT LIKE 'signup-journey-probe@%'
      AND (notes IS NULL OR notes NOT LIKE '[journey-probe]%')
  `).bind(new Date(now - 8 * win).toISOString().slice(0, 19).replace('T', ' ')).all<{ created_at: string }>()

  const ordersRes = await env.DB.prepare(`
    SELECT created_at, payment_status FROM orders WHERE created_at >= ?
  `).bind(new Date(now - 8 * win).toISOString().slice(0, 19).replace('T', ' ')).all<{ created_at: string; payment_status: string }>()

  const inWindow = (created: string, start: number, end: number) => {
    const t = new Date((created.includes('T') ? created : created.replace(' ', 'T')) + (created.endsWith('Z') ? '' : 'Z')).getTime()
    return t >= start && t < end
  }

  const currentStart = now - win
  let curSignups = 0, curOrders = 0, curPaid = 0
  const baseline: Array<{ signups: number; orders: number; paid: number }> = []
  for (let i = 0; i < 7; i++) baseline.push({ signups: 0, orders: 0, paid: 0 })

  for (const r of (customersRes.results || [])) {
    if (inWindow(r.created_at, currentStart, now)) curSignups++
    else for (let i = 0; i < 7; i++) {
      const s = currentStart - (i + 1) * win
      const e = currentStart - i * win
      if (inWindow(r.created_at, s, e)) { baseline[i].signups++; break }
    }
  }
  for (const r of (ordersRes.results || [])) {
    const isPaid = r.payment_status === 'paid'
    if (inWindow(r.created_at, currentStart, now)) {
      curOrders++
      if (isPaid) curPaid++
    } else for (let i = 0; i < 7; i++) {
      const s = currentStart - (i + 1) * win
      const e = currentStart - i * win
      if (inWindow(r.created_at, s, e)) {
        baseline[i].orders++
        if (isPaid) baseline[i].paid++
        break
      }
    }
  }

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
  const baseSignups = avg(baseline.map(b => b.signups))
  const baseOrders = avg(baseline.map(b => b.orders))
  const basePaid = avg(baseline.map(b => b.paid))

  // Insufficient-data guard: with very low traffic, % swings are noisy.
  const totalBaselineSignups = baseline.reduce((a, b) => a + b.signups, 0)
  if (totalBaselineSignups < 3) {
    return {
      status: 'pass',
      summary: `Insufficient 7-day baseline (${totalBaselineSignups} signups) — current 24h: ${curSignups} signups, ${curOrders} orders (${curPaid} paid)`,
      details: { current: { signups: curSignups, orders: curOrders, paid: curPaid }, baseline_avg: { signups: baseSignups, orders: baseOrders, paid: basePaid }, insufficient_data: true },
    }
  }

  const drop = (cur: number, base: number) => base > 0 ? ((cur - base) / base) * 100 : null
  const sigDrop = drop(curSignups, baseSignups)
  const ordDrop = drop(curOrders, baseOrders)
  const paidDrop = drop(curPaid, basePaid)

  const flags: string[] = []
  if (sigDrop !== null && sigDrop <= -50) flags.push(`signups ${sigDrop.toFixed(0)}% vs baseline (${curSignups} vs ${baseSignups.toFixed(1)})`)
  if (ordDrop !== null && ordDrop <= -50) flags.push(`orders ${ordDrop.toFixed(0)}% vs baseline (${curOrders} vs ${baseOrders.toFixed(1)})`)
  if (paidDrop !== null && paidDrop <= -50) flags.push(`paid orders ${paidDrop.toFixed(0)}% vs baseline (${curPaid} vs ${basePaid.toFixed(1)})`)

  const status: SectionStatus = flags.length ? 'warn' : 'pass'
  const summary = flags.length
    ? flags.join(' · ')
    : `OK · 24h: ${curSignups} signups, ${curOrders} orders (${curPaid} paid). Baseline: ${baseSignups.toFixed(1)} signups, ${baseOrders.toFixed(1)} orders.`

  return {
    status,
    summary,
    details: {
      current: { signups: curSignups, orders: curOrders, paid: curPaid },
      baseline_avg: { signups: baseSignups, orders: baseOrders, paid: basePaid },
      delta_pct: { signups: sigDrop, orders: ordDrop, paid: paidDrop },
    },
  }
}

// ── 4. Backend foundations ──────────────────────────────────────
async function checkBackendCore(env: Bindings): Promise<Omit<SectionResult, 'key' | 'label'>> {
  const findings: string[] = []
  let worst: SectionStatus = 'pass'

  // D1 round-trip
  let d1Ms: number | null = null
  try {
    const t0 = Date.now()
    await env.DB.prepare(`SELECT 1 as ok`).first()
    d1Ms = Date.now() - t0
    if (d1Ms > 1000) { findings.push(`D1 latency ${d1Ms}ms (>1s)`); worst = 'warn' }
  } catch (e: any) {
    findings.push(`D1 SELECT 1 failed: ${e?.message}`)
    worst = 'fail'
  }

  // Secrets via /api/health (cron worker has its own near-empty secret store)
  let envConfigured: Record<string, boolean> = {}
  try {
    const res = await fetch(`${PROD_BASE}/api/health`, { headers: { 'User-Agent': 'RoofManagerSignupHealth/1.0' }, signal: AbortSignal.timeout(8000) })
    if (res.ok) {
      const j: any = await res.json().catch(() => ({}))
      envConfigured = j?.env_configured || {}
    } else {
      findings.push(`/api/health returned ${res.status}`)
      worst = worst === 'fail' ? 'fail' : 'warn'
    }
  } catch (e: any) {
    findings.push(`/api/health unreachable: ${String(e?.message || e).slice(0, 120)}`)
    worst = worst === 'fail' ? 'fail' : 'warn'
  }

  let d1HasGmailRefresh = false
  try {
    const r = await env.DB.prepare(`SELECT setting_value FROM settings WHERE setting_key='gmail_refresh_token' AND master_company_id=1 LIMIT 1`).first<{ setting_value: string }>()
    d1HasGmailRefresh = !!(r?.setting_value && r.setting_value.length >= 4)
  } catch {}

  const secretChecks: Array<{ label: string; keys: string[]; extraOk?: () => boolean }> = [
    { label: 'Google Solar API', keys: ['GOOGLE_SOLAR_API_KEY'] },
    { label: 'Google Maps', keys: ['GOOGLE_MAPS_API_KEY'] },
    { label: 'Gemini', keys: ['GEMINI_API_KEY', 'GEMINI_ENHANCE_API_KEY', 'default_gemini_googleaistudio_key', 'google_ai_studio_secret_key', 'GOOGLE_VERTEX_API_KEY'] },
    { label: 'Square payments', keys: ['SQUARE_ACCESS_TOKEN'] },
    { label: 'Email delivery', keys: ['RESEND_API_KEY', 'GMAIL_REFRESH_TOKEN'], extraOk: () => d1HasGmailRefresh },
  ]
  const missing: string[] = []
  for (const { label, keys, extraOk } of secretChecks) {
    const ok = keys.some(k => !!envConfigured[k]) || (extraOk?.() ?? false)
    if (!ok) missing.push(label)
  }
  if (missing.length) {
    findings.push(`Missing: ${missing.join(', ')}`)
    worst = 'fail'
  }

  return {
    status: worst,
    summary: findings.length === 0 ? `D1 ${d1Ms}ms · all secrets configured` : findings.join(' · '),
    details: { d1_latency_ms: d1Ms, missing_secrets: missing, env_configured: envConfigured, d1_has_gmail_refresh: d1HasGmailRefresh },
  }
}

// ── 5. Surface scans (last scan_public/customer/admin findings) ─
async function checkSurfaceScans(env: Bindings): Promise<Omit<SectionResult, 'key' | 'label'>> {
  const types = ['public', 'customer', 'admin']
  const summaryByType: Record<string, { last_run: string | null; status: string | null; ok_count: number; fail_count: number; unresolved_findings: number }> = {}
  let worst: SectionStatus = 'pass'

  for (const t of types) {
    const last = await env.DB.prepare(`
      SELECT id, status, finished_at, ok_count, fail_count
      FROM loop_scan_runs
      WHERE scan_type = ? AND finished_at IS NOT NULL
      ORDER BY id DESC LIMIT 1
    `).bind(t).first<{ id: number; status: string; finished_at: string; ok_count: number; fail_count: number }>()

    // loop_scan_findings has no scan_type column — join through run_id.
    const findings = await env.DB.prepare(`
      SELECT COUNT(*) AS n
        FROM loop_scan_findings f
        JOIN loop_scan_runs r ON r.id = f.run_id
       WHERE r.scan_type = ? AND f.severity = 'error' AND f.resolved_at IS NULL
    `).bind(t).first<{ n: number }>()

    const unresolved = findings?.n || 0
    summaryByType[t] = {
      last_run: last?.finished_at || null,
      status: last?.status || null,
      ok_count: last?.ok_count || 0,
      fail_count: last?.fail_count || 0,
      unresolved_findings: unresolved,
    }
    if (unresolved > 0) worst = worst === 'fail' ? 'fail' : 'warn'
    if (last && last.fail_count > 0) worst = worst === 'fail' ? 'fail' : 'warn'
  }

  const lines = types.map(t => {
    const s = summaryByType[t]
    if (!s.last_run) return `scan_${t}: never run`
    return `scan_${t}: ${s.status} · ${s.ok_count} ok / ${s.fail_count} fail · ${s.unresolved_findings} unresolved error finding(s)`
  })

  return {
    status: worst,
    summary: lines.join(' · '),
    details: summaryByType,
  }
}

// ── 6. Reports health ───────────────────────────────────────────
async function checkReportsHealth(env: Bindings): Promise<Omit<SectionResult, 'key' | 'label'>> {
  const r = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM reports WHERE status='enhancing' AND updated_at < datetime('now','-1 hour')) AS stuck_enhancing,
      (SELECT COUNT(*) FROM reports WHERE status='failed' AND created_at > datetime('now','-1 day')) AS failed_24h,
      (SELECT COUNT(*) FROM reports r LEFT JOIN orders o ON o.id = r.order_id WHERE o.id IS NULL) AS orphan
  `).first<{ stuck_enhancing: number; failed_24h: number; orphan: number }>()

  const stuck = r?.stuck_enhancing || 0
  const failed = r?.failed_24h || 0
  const orphan = r?.orphan || 0

  const flags: string[] = []
  if (stuck > 0) flags.push(`${stuck} stuck in 'enhancing' >1h`)
  if (failed > 0) flags.push(`${failed} failed in last 24h`)
  if (orphan > 0) flags.push(`${orphan} orphan(s) without parent order`)

  const status: SectionStatus = (stuck > 0 || failed > 5 || orphan > 0) ? 'warn' : 'pass'
  return {
    status,
    summary: flags.length ? flags.join(' · ') : 'No stuck, failed, or orphan reports',
    details: { stuck_enhancing: stuck, failed_24h: failed, orphan },
  }
}

// ── 7. Payments health ──────────────────────────────────────────
async function checkPaymentsHealth(env: Bindings): Promise<Omit<SectionResult, 'key' | 'label'>> {
  let unmatched = 0
  let recentFailedPayments = 0
  let unpaidOrdersWithoutAttempt = 0
  try {
    const um = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM square_payments WHERE status='unmatched'`
    ).first<{ n: number }>().catch(() => null)
    unmatched = um?.n || 0
  } catch {}
  try {
    const fp = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM payments WHERE status='failed' AND created_at > datetime('now','-1 day')`
    ).first<{ n: number }>().catch(() => null)
    recentFailedPayments = fp?.n || 0
  } catch {}
  // Orders that say payment_status='failed' in the last 24h — independent
  // of whether a payments row exists.
  try {
    const fo = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM orders WHERE payment_status='failed' AND created_at > datetime('now','-1 day')`
    ).first<{ n: number }>().catch(() => null)
    unpaidOrdersWithoutAttempt = fo?.n || 0
  } catch {}

  const flags: string[] = []
  if (unmatched > 0) flags.push(`${unmatched} unmatched square_payments`)
  if (recentFailedPayments > 0) flags.push(`${recentFailedPayments} failed payment(s) in last 24h`)
  if (unpaidOrdersWithoutAttempt > 0) flags.push(`${unpaidOrdersWithoutAttempt} order(s) with payment_status=failed`)

  const status: SectionStatus = unmatched > 0 ? 'warn' : 'pass'
  return {
    status,
    summary: flags.length ? flags.join(' · ') : 'No unmatched payments or recent failures',
    details: { unmatched, recent_failed_payments: recentFailedPayments, orders_failed_payment: unpaidOrdersWithoutAttempt },
  }
}
