// Loop Tracker — recurring scans of the deployed site.
// Each scan runs four checks: broken-link crawl, form-submission smoke,
// API-health pings, and (optional) console-error capture via Cloudflare
// Browser Rendering. Findings are persisted to loop_scan_runs /
// loop_scan_findings and surfaced in the Super Admin Loop Tracker page.

import type { Bindings } from '../types'
import { issueScanCustomerJWT, issueScanAdminJWT } from './synthetic-auth'
import {
  fetchReportsForSweep,
  scanReportsBatch,
  type ReportFindingCategory,
} from './report-error-scanner'

const PROD_BASE = 'https://www.roofmanager.ca'
const SYNTHETIC_HEADER = { 'X-Synthetic-Test': '1' }

export type ScanType = 'public' | 'customer' | 'admin' | 'health' | 'reports'
type Severity = 'error' | 'warn'
type Category =
  | 'broken_link'
  | 'form_smoke'
  | 'console_error'
  | 'api_health'
  | 'health_check'
  | ReportFindingCategory

type Finding = {
  severity: Severity
  category: Category
  url?: string
  message: string
  details?: any
}

type ScanResult = {
  runId: number
  status: 'pass' | 'fail' | 'error'
  pagesChecked: number
  okCount: number
  failCount: number
  summary: string
}

// Caller-supplied context. Source distinguishes cron vs manual vs Claude
// /loop vs Anthropic-hosted /schedule. expectedAt lets us measure schedule
// skew (cron actually fires at e.g. :30:08 instead of :30:00).
export type RunSource = 'cf_cron' | 'manual' | 'inline' | 'claude_loop' | 'cloud_routine'
export type RunOptions = {
  source?: RunSource
  expectedAt?: Date
  inputs?: any
  // Override the default loop_id (`scan_${type}`). Used when the same
  // scanner is invoked from multiple loops — e.g. /reports-monitor calls
  // runScan('reports') but its loop_id should be 'reports_monitor', not
  // 'scan_reports', so the tracker shows distinct rows for cron vs Claude.
  loopId?: string
}

type SurfaceConfig = {
  seedPaths: string[]
  apiHealthRoutes: string[]
  formTests: { endpoint: string; method?: 'POST'; body: any; expectStatus?: number }[]
  consolePaths: string[]
  authHeader?: () => Promise<Record<string, string>>
}

// Per-probe latency capture. Stored as metrics_json on the run so the
// drill-down can render full request waterfalls.
type ProbeMetric = { kind: 'link' | 'api' | 'form' | 'console' | 'health'; path?: string; status?: number; durationMs: number; bodyLen?: number; ok: boolean }

// Surfaces are intentionally narrow — adding URLs is cheap, but a runaway
// crawler is expensive (Browser Rendering bills per invocation).
// Public list is the explicit set of marketing surfaces — the broken-link
// crawler does NOT recurse into discovered hrefs (would blow the 50-subrequest
// Worker cap once /blog and /coverage fan out to dozens of pages).
const PUBLIC_SURFACE: SurfaceConfig = {
  seedPaths: [
    '/', '/pricing', '/contact', '/login', '/signup',
    '/coverage', '/lander', '/faq', '/tools',
    '/tools/pitch-calculator', '/tools/material-estimator',
    '/blog',
    '/blog/roof-manager-vs-eagleview',
    '/blog/roof-manager-vs-roofsnap',
    '/blog/roof-measurement-report-api-developer-access-2026',
    '/blog/fort-lauderdale-luxury-real-estate-roof-audit',
    '/blog/living-on-a-canal-cape-coral-roofing',
    '/blog/student-activities-tallahassee-landlord-roofing',
    '/blog/port-st-lucie-vs-fort-lauderdale-family-roofing',
    '/roof-measurement/new-york', '/roof-measurement/los-angeles',
    '/roof-measurement/chicago', '/roof-measurement/houston',
    '/roof-measurement/dallas', '/roof-measurement/miami',
    '/roof-measurement/atlanta', '/roof-measurement/denver',
    '/roof-measurement/phoenix',
  ],
  apiHealthRoutes: [],
  formTests: [
    {
      endpoint: '/api/agents/leads',
      body: { name: 'Loop Tracker', email: 'loop-tracker@roofmanager.ca', source_page: 'loop-tracker-scan' },
    },
  ],
  consolePaths: ['/', '/pricing'],
}

const CUSTOMER_SURFACE: SurfaceConfig = {
  seedPaths: ['/customer/dashboard', '/customer/buy-reports'],
  apiHealthRoutes: ['/api/customer/me'],
  formTests: [],
  consolePaths: ['/customer/dashboard'],
}

const ADMIN_SURFACE: SurfaceConfig = {
  seedPaths: ['/super-admin', '/super-admin/loop-tracker', '/super-admin/attribution'],
  apiHealthRoutes: ['/api/auth/me', '/api/super-admin/loop-tracker/api/status'],
  formTests: [],
  consolePaths: ['/super-admin', '/super-admin/loop-tracker'],
}

// ── Public entry point ──────────────────────────────────────────
// Back-compat: the third positional arg is still 'cron'|'manual' (legacy
// triggered_by). For richer context callers should pass a RunOptions object
// as the 4th arg with source/expectedAt/inputs. The legacy signature still
// works — both files in the repo and external /loop callers continue to
// compile without change.
export async function runScan(
  env: Bindings,
  type: ScanType,
  triggeredBy: 'cron' | 'manual' | 'inline' = 'manual',
  opts: RunOptions = {},
): Promise<ScanResult> {
  const t0 = Date.now()
  const loopId = opts.loopId || `scan_${type}`
  const source: RunSource = opts.source
    ?? (triggeredBy === 'cron' ? 'cf_cron' : (triggeredBy === 'inline' ? 'inline' : 'manual'))
  const skewMs = opts.expectedAt ? (Date.now() - opts.expectedAt.getTime()) : null
  const runId = await openRun(env, type, triggeredBy, {
    loopId,
    source,
    expectedAt: opts.expectedAt,
    skewMs,
    inputs: opts.inputs,
  })
  const metrics: ProbeMetric[] = []

  try {
    if (type === 'health') {
      const findings = await runHealthCheck(env, metrics)
      return await closeRun(env, runId, t0, 1, findings, metrics, loopId, source)
    }

    if (type === 'reports') {
      const findings = await runReportSweep(env)
      return await closeRun(env, runId, t0, findings.pagesChecked, findings.list, metrics, loopId, source)
    }

    // Skip-with-warning if the synthetic-auth secret for this surface isn't
    // set, instead of throwing on the first cron firing (which crashes the
    // whole loop tick before downstream sweeps run).
    if (type === 'admin' && !(env as any).SCAN_ADMIN_EMAIL) {
      console.warn('[runScan:admin] SCAN_ADMIN_EMAIL not set — skipping admin scan')
      return await closeRun(env, runId, t0, 0, [], metrics, loopId, source)
    }
    if (type === 'customer' && !(env as any).SCAN_CUSTOMER_EMAIL) {
      console.warn('[runScan:customer] SCAN_CUSTOMER_EMAIL not set — skipping customer scan')
      return await closeRun(env, runId, t0, 0, [], metrics, loopId, source)
    }

    const cfg =
      type === 'public' ? PUBLIC_SURFACE :
      type === 'customer' ? { ...CUSTOMER_SURFACE, authHeader: () => sessionCookie('rm_customer_session', issueScanCustomerJWT(env)) } :
      { ...ADMIN_SURFACE, authHeader: () => sessionCookie('rm_admin_session', issueScanAdminJWT(env)) }

    const findings: Finding[] = []
    const auth = cfg.authHeader ? await cfg.authHeader() : {}

    // Run all four categories in parallel — each is independent.
    const [linkF, apiF, formF, consoleF] = await Promise.all([
      crawlLinks(cfg.seedPaths, auth, metrics).catch(e => fatalFinding('broken_link', e)),
      pingApiHealth(cfg.apiHealthRoutes, auth, metrics).catch(e => fatalFinding('api_health', e)),
      submitFormSmokes(cfg.formTests, auth, metrics).catch(e => fatalFinding('form_smoke', e)),
      captureConsoleErrors(env, cfg.consolePaths, auth, metrics).catch(e => fatalFinding('console_error', e)),
    ])
    findings.push(...linkF, ...apiF, ...formF, ...consoleF)

    return await closeRun(env, runId, t0, cfg.seedPaths.length, findings, metrics, loopId, source)
  } catch (err: any) {
    const errSummary = `Error: ${err?.message || err}`.slice(0, 500)
    await env.DB.prepare(
      `UPDATE loop_scan_runs SET status='error', finished_at=datetime('now'), duration_ms=?, summary=?, metrics_json=?, error_stack=? WHERE id=?`
    ).bind(
      Date.now() - t0,
      errSummary,
      metrics.length ? JSON.stringify(metrics).slice(0, 32000) : null,
      err?.stack ? String(err.stack).slice(0, 4000) : null,
      runId,
    ).run()
    await writeHeartbeat(env, loopId, 'error', Date.now() - t0, runId, errSummary, source).catch(() => {})
    await touchDefinition(env, loopId, 'error', runId).catch(() => {})
    return { runId, status: 'error', pagesChecked: 0, okCount: 0, failCount: 0, summary: err?.message || 'unknown' }
  }
}

// ── Check: broken-link crawl ────────────────────────────────────
async function crawlLinks(seedPaths: string[], auth: Record<string, string>, metrics: ProbeMetric[]): Promise<Finding[]> {
  const findings: Finding[] = []
  const visited = new Set<string>()
  const queue: { path: string; from: string }[] = seedPaths.map(p => ({ path: p, from: 'seed' }))
  // No recursion: every URL must be in seedPaths. Why: discovered-href fan-out
  // blew past the Worker 50-subrequest cap (/blog alone links to ~10 posts,
  // / links to /coverage + /tools/* + 9 city pages). Cap stays as a safety
  // net in case seedPaths grows past the budget.
  const maxPages = 30
  let processed = 0

  while (queue.length > 0 && processed < maxPages) {
    const batch = queue.splice(0, 5)
    await Promise.all(batch.map(async ({ path, from }) => {
      if (visited.has(path)) return
      visited.add(path)
      processed++

      const url = `${PROD_BASE}${path}`
      const probeT0 = Date.now()
      try {
        const res = await fetch(url, { headers: { ...auth, 'User-Agent': 'RoofManagerLoopScanner/1.0' }, redirect: 'manual' })
        const dur = Date.now() - probeT0
        metrics.push({ kind: 'link', path, status: res.status, durationMs: dur, ok: res.status < 400 })
        if (res.status >= 400) {
          findings.push({
            severity: res.status >= 500 ? 'error' : 'warn',
            category: 'broken_link',
            url: path,
            message: `HTTP ${res.status} on ${path}`,
            details: { status: res.status, linkedFrom: from, durationMs: dur },
          })
        }
      } catch (e: any) {
        metrics.push({ kind: 'link', path, durationMs: Date.now() - probeT0, ok: false })
        findings.push({
          severity: 'error',
          category: 'broken_link',
          url: path,
          message: `Network error: ${e?.message || e}`,
          details: { linkedFrom: from },
        })
      }
    }))
  }
  return findings
}

// ── Check: API health pings ─────────────────────────────────────
async function pingApiHealth(routes: string[], auth: Record<string, string>, metrics: ProbeMetric[]): Promise<Finding[]> {
  const findings: Finding[] = []
  await Promise.all(routes.map(async route => {
    const url = `${PROD_BASE}${route}`
    const probeT0 = Date.now()
    try {
      const res = await fetch(url, { headers: auth })
      const text = await res.text()
      const dur = Date.now() - probeT0
      metrics.push({ kind: 'api', path: route, status: res.status, durationMs: dur, bodyLen: text.length, ok: res.status < 400 })
      if (res.status >= 400) {
        findings.push({
          severity: 'error',
          category: 'api_health',
          url: route,
          message: `API ${route} returned ${res.status}`,
          details: { status: res.status, durationMs: dur, bodyPrefix: text.slice(0, 200) },
        })
        return
      }
      if (!text || text.length < 2) {
        findings.push({
          severity: 'warn',
          category: 'api_health',
          url: route,
          message: `API ${route} returned empty body`,
          details: { durationMs: dur },
        })
      }
    } catch (e: any) {
      metrics.push({ kind: 'api', path: route, durationMs: Date.now() - probeT0, ok: false })
      findings.push({
        severity: 'error',
        category: 'api_health',
        url: route,
        message: `API ${route} threw: ${e?.message || e}`,
      })
    }
  }))
  return findings
}

// ── Check: form submission smoke tests ──────────────────────────
async function submitFormSmokes(
  tests: SurfaceConfig['formTests'],
  auth: Record<string, string>,
  metrics: ProbeMetric[],
): Promise<Finding[]> {
  const findings: Finding[] = []
  await Promise.all(tests.map(async t => {
    const url = `${PROD_BASE}${t.endpoint}`
    const probeT0 = Date.now()
    try {
      const res = await fetch(url, {
        method: t.method || 'POST',
        headers: { ...auth, ...SYNTHETIC_HEADER, 'Content-Type': 'application/json' },
        body: JSON.stringify(t.body),
      })
      const dur = Date.now() - probeT0
      const expected = t.expectStatus || 200
      const ok = res.status === expected || (expected === 200 && res.status === 201)
      metrics.push({ kind: 'form', path: t.endpoint, status: res.status, durationMs: dur, ok })
      if (!ok) {
        const body = await res.text().catch(() => '')
        findings.push({
          severity: 'error',
          category: 'form_smoke',
          url: t.endpoint,
          message: `Form ${t.endpoint}: expected ${expected}, got ${res.status}`,
          details: { responseBodyPrefix: body.slice(0, 200), durationMs: dur },
        })
      }
    } catch (e: any) {
      metrics.push({ kind: 'form', path: t.endpoint, durationMs: Date.now() - probeT0, ok: false })
      findings.push({
        severity: 'error',
        category: 'form_smoke',
        url: t.endpoint,
        message: `Form ${t.endpoint} threw: ${e?.message || e}`,
      })
    }
  }))
  return findings
}

// ── Check: console errors via Cloudflare Browser Rendering REST API ───
// Uses the /content endpoint with includeConsoleMessages — no @cloudflare/puppeteer
// package required. Skips silently if CLOUDFLARE_ACCOUNT_ID/API_TOKEN unset.
async function captureConsoleErrors(
  env: Bindings,
  paths: string[],
  auth: Record<string, string>,
  metrics: ProbeMetric[],
): Promise<Finding[]> {
  const findings: Finding[] = []
  const acct = (env as any).CLOUDFLARE_ACCOUNT_ID
  const token = (env as any).CLOUDFLARE_API_TOKEN
  if (!acct || !token) {
    // Documented degraded mode — Browser Rendering is optional. Stay silent
    // so we don't pollute the findings feed with a warning every 30 min.
    return []
  }

  for (const path of paths) {
    const url = `${PROD_BASE}${path}`
    const probeT0 = Date.now()
    try {
      const apiRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/browser-rendering/json`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          waitForTimeout: 3000,
          setExtraHTTPHeaders: auth,
          // ask for a tiny extraction to keep cost minimal — we only really
          // care about the page side-effects (console + JS errors).
          response_format: { type: 'json_schema', json_schema: { type: 'object', properties: { title: { type: 'string' } } } },
        }),
      })
      const json: any = await apiRes.json().catch(() => ({}))
      const dur = Date.now() - probeT0
      metrics.push({ kind: 'console', path, status: apiRes.status, durationMs: dur, ok: apiRes.ok })
      // 401/403 from the Cloudflare API itself = our token isn't scoped for
      // Browser Rendering. That's an infra-cred state, not an app bug — bail
      // silently for the rest of the paths so we don't emit a warn finding
      // per path every scan. (The same path is taken when the secret is
      // unset above; this just extends "degraded mode" to "scope missing".)
      if (apiRes.status === 401 || apiRes.status === 403) {
        return []
      }
      // Browser Rendering returns console messages on errors.
      const consoleMsgs: any[] = json?.result?.consoleMessages || json?.consoleMessages || []
      const errors = consoleMsgs.filter(m => m.type === 'error' || m.level === 'error')
      for (const e of errors) {
        findings.push({
          severity: 'warn',
          category: 'console_error',
          url: path,
          message: `Console error on ${path}: ${(e.text || e.message || '').slice(0, 200)}`,
          details: e,
        })
      }
      if (!apiRes.ok && apiRes.status !== 200) {
        findings.push({
          severity: 'warn',
          category: 'console_error',
          url: path,
          message: `Browser Rendering returned ${apiRes.status} for ${path}`,
        })
      }
    } catch (e: any) {
      metrics.push({ kind: 'console', path, durationMs: Date.now() - probeT0, ok: false })
      findings.push({
        severity: 'warn',
        category: 'console_error',
        url: path,
        message: `Browser Rendering threw: ${e?.message || e}`,
      })
    }
  }
  return findings
}

// ── Daily system health check ───────────────────────────────────
async function runHealthCheck(env: Bindings, metrics: ProbeMetric[]): Promise<Finding[]> {
  const findings: Finding[] = []

  // 1. D1 round-trip latency
  try {
    const t0 = Date.now()
    await env.DB.prepare(`SELECT 1 as ok`).first()
    const ms = Date.now() - t0
    metrics.push({ kind: 'health', path: 'd1_select_1', durationMs: ms, ok: true })
    if (ms > 1000) findings.push({ severity: 'warn', category: 'health_check', message: `D1 latency ${ms}ms (>1s)` })
  } catch (e: any) {
    metrics.push({ kind: 'health', path: 'd1_select_1', durationMs: 0, ok: false })
    findings.push({ severity: 'error', category: 'health_check', message: `D1 SELECT 1 failed: ${e?.message}` })
  }

  // 2. Critical secrets present. Probe the Pages app's /api/health rather
  // than reading env directly: scan_health runs in the cron worker, which
  // has its own (mostly empty) secret store, so checking `env` here would
  // false-flag every key that's only bound on the Pages deployment.
  // /api/health returns an env_configured map of booleans (no values).
  let envConfigured: Record<string, boolean | string> = {}
  try {
    const res = await fetch(`${PROD_BASE}/api/health`, { headers: { 'User-Agent': 'RoofManagerLoopScanner/1.0' } })
    if (res.ok) {
      const j: any = await res.json().catch(() => ({}))
      envConfigured = j?.env_configured || {}
    } else {
      findings.push({ severity: 'warn', category: 'health_check', message: `/api/health returned ${res.status} — secret presence not verified this run` })
    }
  } catch (e: any) {
    findings.push({ severity: 'warn', category: 'health_check', message: `/api/health unreachable: ${e?.message} — secret presence not verified this run` })
  }
  // GMAIL_REFRESH_TOKEN by design lives in D1 settings table when not in env
  // (loadGmailCreds() in services/email.ts resolves env-first, then D1).
  // Treat the D1-stored token as equivalent for the email-delivery check.
  let d1HasGmailRefresh = false
  try {
    const r = await env.DB.prepare(`SELECT setting_value FROM settings WHERE setting_key='gmail_refresh_token' AND master_company_id=1 LIMIT 1`).first<{ setting_value: string }>()
    d1HasGmailRefresh = !!(r?.setting_value && r.setting_value.length >= 4)
  } catch {}
  const requiredAny: Array<{ label: string; keys: string[]; extraOk?: () => boolean }> = [
    { label: 'Google Solar API', keys: ['GOOGLE_SOLAR_API_KEY'] },
    { label: 'Google Maps', keys: ['GOOGLE_MAPS_API_KEY'] },
    { label: 'Gemini API', keys: ['GEMINI_API_KEY', 'GEMINI_ENHANCE_API_KEY', 'default_gemini_googleaistudio_key', 'google_ai_studio_secret_key', 'GOOGLE_VERTEX_API_KEY'] },
    { label: 'Square payments', keys: ['SQUARE_ACCESS_TOKEN'] },
    { label: 'Email delivery (Resend or Gmail OAuth)', keys: ['RESEND_API_KEY', 'GMAIL_REFRESH_TOKEN'], extraOk: () => d1HasGmailRefresh },
  ]
  for (const { label, keys, extraOk } of requiredAny) {
    const ok = keys.some(k => !!envConfigured[k]) || (extraOk?.() ?? false)
    if (!ok) {
      findings.push({
        severity: 'error',
        category: 'health_check',
        message: `${label} not configured — none of [${keys.join(', ')}] are set`,
      })
    }
  }

  // 3. Volume sanity — orders/reports in last 24h
  try {
    const r = await env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM orders WHERE created_at > datetime('now','-1 day')) as orders_24h,
        (SELECT COUNT(*) FROM reports WHERE created_at > datetime('now','-1 day')) as reports_24h,
        (SELECT COUNT(*) FROM reports WHERE status='enhancing' AND updated_at < datetime('now','-1 hour')) as stuck_enhancing
    `).first<{ orders_24h: number; reports_24h: number; stuck_enhancing: number }>()
    if (r && r.stuck_enhancing > 0) {
      findings.push({
        severity: 'warn',
        category: 'health_check',
        message: `${r.stuck_enhancing} report(s) stuck in 'enhancing' >1h`,
        details: r,
      })
    }
  } catch (e: any) {
    findings.push({ severity: 'warn', category: 'health_check', message: `Volume query failed: ${e?.message}` })
  }

  // 4. Orphan reports (no parent order)
  try {
    const r = await env.DB.prepare(`
      SELECT COUNT(*) as n FROM reports r LEFT JOIN orders o ON o.id = r.order_id WHERE o.id IS NULL
    `).first<{ n: number }>()
    if (r && r.n > 0) {
      findings.push({
        severity: 'warn',
        category: 'health_check',
        message: `${r.n} orphan report(s) without parent order`,
      })
    }
  } catch {}

  return findings
}

// ── Inline: scan ONE report immediately after generation ────────
// Writes findings under a tiny single-report loop_scan_runs row tagged
// triggered_by='inline' so the Super Admin Loop Tracker UI shows them
// in the same feed as batch sweep results. Non-fatal: a scanner error
// must never block report delivery to the customer.
export async function scanReportInline(env: Bindings, orderId: number | string): Promise<void> {
  try {
    const { scanReportForErrors } = await import('./report-error-scanner')
    const reportFindings = await scanReportForErrors(env, orderId)
    if (reportFindings.length === 0) return // silent pass — no row needed

    const t0 = Date.now()
    const run = await env.DB.prepare(
      `INSERT INTO loop_scan_runs (scan_type, status, triggered_by, pages_checked, loop_id, source, inputs_json)
       VALUES ('reports', 'running', 'inline', 1, 'scan_reports', 'inline', ?) RETURNING id`,
    ).bind(JSON.stringify({ order_id: orderId })).first<{ id: number }>()
    if (!run) return
    const findings: Finding[] = reportFindings.map(f => ({
      severity: f.severity,
      category: f.category as Category,
      url: f.url,
      message: f.message,
      details: { ...(f.details || {}), order_id: f.order_id },
    }))
    await closeRun(env, run.id, t0, 1, findings, [], 'scan_reports', 'inline')
  } catch (e: any) {
    console.warn('[scanReportInline] non-fatal scanner error:', e?.message || e)
  }
}

// ── Sweep: scan recent reports for generation errors ────────────
// Covers reports created/updated in the last ~75 minutes (overlap with
// the hourly cron) plus any review-flagged report not yet resolved.
async function runReportSweep(env: Bindings): Promise<{ pagesChecked: number; list: Finding[] }> {
  const rows = await fetchReportsForSweep(env, 75)
  const reportFindings = await scanReportsBatch(env, rows)
  const list: Finding[] = reportFindings.map(f => ({
    severity: f.severity,
    category: f.category as Category,
    url: f.url,
    message: f.message,
    details: { ...(f.details || {}), order_id: f.order_id },
  }))
  return { pagesChecked: rows.length, list }
}

// ── Helpers ─────────────────────────────────────────────────────
async function sessionCookie(cookieName: string, tokenPromise: Promise<string>): Promise<Record<string, string>> {
  const token = await tokenPromise
  return { Cookie: `${cookieName}=${token}` }
}

function fatalFinding(category: Category, err: any): Finding[] {
  return [{ severity: 'error', category, message: `Check threw: ${err?.message || err}` }]
}

type OpenRunCtx = {
  loopId?: string
  source?: RunSource
  expectedAt?: Date
  skewMs?: number | null
  inputs?: any
}

async function openRun(env: Bindings, type: ScanType, triggeredBy: string, ctx: OpenRunCtx = {}): Promise<number> {
  const r = await env.DB.prepare(
    `INSERT INTO loop_scan_runs
       (scan_type, status, triggered_by, loop_id, source, expected_at, skew_ms, inputs_json)
     VALUES (?, 'running', ?, ?, ?, ?, ?, ?)
     RETURNING id`
  ).bind(
    type,
    triggeredBy,
    ctx.loopId || `scan_${type}`,
    ctx.source || 'manual',
    ctx.expectedAt ? ctx.expectedAt.toISOString().slice(0, 19).replace('T', ' ') : null,
    ctx.skewMs ?? null,
    ctx.inputs ? JSON.stringify(ctx.inputs).slice(0, 32000) : null,
  ).first<{ id: number }>()
  return r!.id
}

async function closeRun(
  env: Bindings,
  runId: number,
  t0: number,
  pagesChecked: number,
  findings: Finding[],
  metrics: ProbeMetric[] = [],
  loopId?: string,
  source?: RunSource,
): Promise<ScanResult> {
  const fails = findings.filter(f => f.severity === 'error').length
  const status = fails > 0 ? 'fail' : 'pass'
  const summary = findings.length === 0
    ? `OK · ${pagesChecked} page(s) checked`
    : `${findings.length} finding(s): ${fails} error, ${findings.length - fails} warn`
  const durationMs = Date.now() - t0

  if (findings.length > 0) {
    const stmts = findings.map(f =>
      env.DB.prepare(
        `INSERT INTO loop_scan_findings (run_id, severity, category, url, message, details_json) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(runId, f.severity, f.category, f.url || null, f.message.slice(0, 500), f.details ? JSON.stringify(f.details).slice(0, 4000) : null)
    )
    await env.DB.batch(stmts)
  }

  // Roll-up metrics: counts + p50/p95 across probes for the dashboard.
  const rollup = summarizeMetrics(metrics)
  const metricsBlob = metrics.length > 0
    ? JSON.stringify({ rollup, probes: metrics }).slice(0, 32000)
    : null

  await env.DB.prepare(
    `UPDATE loop_scan_runs SET status=?, finished_at=datetime('now'), duration_ms=?, pages_checked=?, ok_count=?, fail_count=?, summary=?, metrics_json=? WHERE id=?`
  ).bind(status, durationMs, pagesChecked, pagesChecked - fails, fails, summary.slice(0, 500), metricsBlob, runId).run()

  if (loopId) {
    await writeHeartbeat(env, loopId, status, durationMs, runId, summary, source).catch(() => {})
    await touchDefinition(env, loopId, status, runId).catch(() => {})
  }

  return {
    runId,
    status,
    pagesChecked,
    okCount: pagesChecked - fails,
    failCount: fails,
    summary,
  }
}

function summarizeMetrics(metrics: ProbeMetric[]): Record<string, any> {
  if (metrics.length === 0) return {}
  const byKind: Record<string, number[]> = {}
  let okN = 0, failN = 0
  for (const m of metrics) {
    if (m.ok) okN++; else failN++
    if (!byKind[m.kind]) byKind[m.kind] = []
    byKind[m.kind].push(m.durationMs)
  }
  const out: Record<string, any> = { ok: okN, fail: failN, total: metrics.length, by_kind: {} }
  for (const [k, ds] of Object.entries(byKind)) {
    const sorted = [...ds].sort((a, b) => a - b)
    out.by_kind[k] = {
      count: ds.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1],
      max: sorted[sorted.length - 1],
    }
  }
  return out
}

// ── External-run recorder ──────────────────────────────────────
// Lets non-scan loops (Claude /loop endpoints, cloud routines) write a
// fully-formed run row + heartbeat in one call. Used by funnel-monitor,
// gmail-health, and the routines heartbeat endpoint.
export async function recordExternalRun(
  env: Bindings,
  args: {
    loopId: string
    source: RunSource
    status: 'pass' | 'fail' | 'error'
    summary: string
    durationMs: number
    inputs?: any
    outputs?: any
    findings?: Array<{ severity: 'error' | 'warn'; category: string; url?: string; message: string; details?: any }>
    expectedAt?: Date
  },
): Promise<{ runId: number }> {
  const skewMs = args.expectedAt ? (Date.now() - args.expectedAt.getTime()) : null
  // Store as scan_type='external' so the existing schema + dashboard
  // continue working. Real distinction is loop_id + source.
  const row = await env.DB.prepare(
    `INSERT INTO loop_scan_runs
       (scan_type, status, triggered_by, loop_id, source, expected_at, skew_ms, inputs_json, outputs_json,
        finished_at, duration_ms, pages_checked, ok_count, fail_count, summary)
     VALUES ('external', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?)
     RETURNING id`
  ).bind(
    args.status,
    args.source === 'cf_cron' ? 'cron' : (args.source === 'manual' ? 'manual' : 'external'),
    args.loopId,
    args.source,
    args.expectedAt ? args.expectedAt.toISOString().slice(0, 19).replace('T', ' ') : null,
    skewMs,
    args.inputs ? JSON.stringify(args.inputs).slice(0, 32000) : null,
    args.outputs ? JSON.stringify(args.outputs).slice(0, 32000) : null,
    args.durationMs,
    1,
    args.status === 'pass' ? 1 : 0,
    args.findings?.filter(f => f.severity === 'error').length || 0,
    args.summary.slice(0, 500),
  ).first<{ id: number }>()
  const runId = row!.id

  if (args.findings && args.findings.length > 0) {
    const stmts = args.findings.map(f =>
      env.DB.prepare(
        `INSERT INTO loop_scan_findings (run_id, severity, category, url, message, details_json) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(runId, f.severity, f.category, f.url || null, f.message.slice(0, 500), f.details ? JSON.stringify(f.details).slice(0, 4000) : null)
    )
    await env.DB.batch(stmts)
  }

  await writeHeartbeat(env, args.loopId, args.status, args.durationMs, runId, args.summary, args.source).catch(() => {})
  await touchDefinition(env, args.loopId, args.status, runId).catch(() => {})
  return { runId }
}

// ── Heartbeat / definition helpers ─────────────────────────────
// Writes one lightweight row per loop execution. Used by the dashboard
// for the 24h heatmap and "last seen" / staleness detection.
export async function writeHeartbeat(
  env: Bindings,
  loopId: string,
  status: string,
  durationMs: number,
  runId: number | null,
  summary: string | null,
  source?: RunSource,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO loop_heartbeats (loop_id, status, duration_ms, run_id, summary, source) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(loopId, status, durationMs, runId, (summary || '').slice(0, 500), source || null).run()
}

// Updates the rollup row in loop_definitions. Auto-creates a stub row if
// the loop_id isn't in the seed catalog yet (keeps the registry self-healing
// when new loops are added without a migration).
export async function touchDefinition(
  env: Bindings,
  loopId: string,
  status: string,
  runId: number | null,
): Promise<void> {
  const isFail = status === 'fail' || status === 'error'
  const upd = await env.DB.prepare(
    `UPDATE loop_definitions
        SET last_run_at = datetime('now'),
            last_status = ?,
            last_run_id = ?,
            consecutive_failures = CASE WHEN ? THEN consecutive_failures + 1 ELSE 0 END,
            total_runs = total_runs + 1,
            total_failures = total_failures + CASE WHEN ? THEN 1 ELSE 0 END,
            updated_at = datetime('now')
      WHERE loop_id = ?`
  ).bind(status, runId, isFail ? 1 : 0, isFail ? 1 : 0, loopId).run()
  if ((upd.meta?.changes || 0) === 0) {
    await env.DB.prepare(
      `INSERT INTO loop_definitions
         (loop_id, name, category, source, schedule_human, owner, last_run_at, last_status, last_run_id, total_runs, total_failures, consecutive_failures)
       VALUES (?, ?, 'cron', 'cf_cron', 'unknown', 'cron_worker', datetime('now'), ?, ?, 1, ?, ?)`
    ).bind(loopId, loopId, status, runId, isFail ? 1 : 0, isFail ? 1 : 0).run()
  }
}
