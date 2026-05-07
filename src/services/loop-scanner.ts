// Loop Tracker — recurring scans of the deployed site.
// Each scan runs four checks: broken-link crawl, form-submission smoke,
// API-health pings, and (optional) console-error capture via Cloudflare
// Browser Rendering. Findings are persisted to loop_scan_runs /
// loop_scan_findings and surfaced in the Super Admin Loop Tracker page.

import type { Bindings } from '../types'
import { issueScanCustomerJWT, issueScanAdminJWT } from './synthetic-auth'

const PROD_BASE = 'https://www.roofmanager.ca'
const SYNTHETIC_HEADER = { 'X-Synthetic-Test': '1' }

export type ScanType = 'public' | 'customer' | 'admin' | 'health'
type Severity = 'error' | 'warn'
type Category = 'broken_link' | 'form_smoke' | 'console_error' | 'api_health' | 'health_check'

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

type SurfaceConfig = {
  seedPaths: string[]
  apiHealthRoutes: string[]
  formTests: { endpoint: string; method?: 'POST'; body: any; expectStatus?: number }[]
  consolePaths: string[]
  authHeader?: () => Promise<Record<string, string>>
}

// Surfaces are intentionally narrow — adding URLs is cheap, but a runaway
// crawler is expensive (Browser Rendering bills per invocation).
const PUBLIC_SURFACE: SurfaceConfig = {
  seedPaths: ['/', '/pricing', '/contact', '/login', '/signup', '/blog'],
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
export async function runScan(
  env: Bindings,
  type: ScanType,
  triggeredBy: 'cron' | 'manual' = 'cron',
): Promise<ScanResult> {
  const t0 = Date.now()
  const runId = await openRun(env, type, triggeredBy)

  try {
    if (type === 'health') {
      const findings = await runHealthCheck(env)
      return await closeRun(env, runId, t0, 1, findings)
    }

    const cfg =
      type === 'public' ? PUBLIC_SURFACE :
      type === 'customer' ? { ...CUSTOMER_SURFACE, authHeader: () => sessionCookie('rm_customer_session', issueScanCustomerJWT(env)) } :
      { ...ADMIN_SURFACE, authHeader: () => sessionCookie('rm_admin_session', issueScanAdminJWT(env)) }

    const findings: Finding[] = []
    const auth = cfg.authHeader ? await cfg.authHeader() : {}

    // Run all four categories in parallel — each is independent.
    const [linkF, apiF, formF, consoleF] = await Promise.all([
      crawlLinks(cfg.seedPaths, auth).catch(e => fatalFinding('broken_link', e)),
      pingApiHealth(cfg.apiHealthRoutes, auth).catch(e => fatalFinding('api_health', e)),
      submitFormSmokes(cfg.formTests, auth).catch(e => fatalFinding('form_smoke', e)),
      captureConsoleErrors(env, cfg.consolePaths, auth).catch(e => fatalFinding('console_error', e)),
    ])
    findings.push(...linkF, ...apiF, ...formF, ...consoleF)

    return await closeRun(env, runId, t0, cfg.seedPaths.length, findings)
  } catch (err: any) {
    await env.DB.prepare(
      `UPDATE loop_scan_runs SET status='error', finished_at=datetime('now'), duration_ms=?, summary=? WHERE id=?`
    ).bind(Date.now() - t0, `Error: ${err?.message || err}`.slice(0, 500), runId).run()
    return { runId, status: 'error', pagesChecked: 0, okCount: 0, failCount: 0, summary: err?.message || 'unknown' }
  }
}

// ── Check: broken-link crawl ────────────────────────────────────
async function crawlLinks(seedPaths: string[], auth: Record<string, string>): Promise<Finding[]> {
  const findings: Finding[] = []
  const visited = new Set<string>()
  const queue: { path: string; from: string }[] = seedPaths.map(p => ({ path: p, from: 'seed' }))
  const maxPages = 40
  let processed = 0

  while (queue.length > 0 && processed < maxPages) {
    const batch = queue.splice(0, 5)
    await Promise.all(batch.map(async ({ path, from }) => {
      if (visited.has(path)) return
      visited.add(path)
      processed++

      const url = `${PROD_BASE}${path}`
      try {
        const res = await fetch(url, { headers: { ...auth, 'User-Agent': 'RoofManagerLoopScanner/1.0' }, redirect: 'manual' })
        if (res.status >= 400) {
          findings.push({
            severity: res.status >= 500 ? 'error' : 'warn',
            category: 'broken_link',
            url: path,
            message: `HTTP ${res.status} on ${path}`,
            details: { status: res.status, linkedFrom: from },
          })
          return
        }
        if (res.status >= 300 && res.status < 400) return // redirects ok

        // Discover internal hrefs from HTML responses (depth ≤ 1 from seeds).
        const ct = res.headers.get('content-type') || ''
        if (!ct.includes('html')) return
        const html = await res.text()
        for (const href of extractInternalHrefs(html)) {
          if (!visited.has(href) && processed < maxPages) {
            queue.push({ path: href, from: path })
          }
        }
      } catch (e: any) {
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

function extractInternalHrefs(html: string): string[] {
  const out = new Set<string>()
  const re = /href="([^"#?]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const href = m[1]
    if (href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/static/') && !href.match(/\.(jpg|jpeg|png|svg|webp|css|js|ico|pdf|xml|map)$/i)) {
      out.add(href)
    }
  }
  return Array.from(out).slice(0, 30) // cap fan-out per page
}

// ── Check: API health pings ─────────────────────────────────────
async function pingApiHealth(routes: string[], auth: Record<string, string>): Promise<Finding[]> {
  const findings: Finding[] = []
  await Promise.all(routes.map(async route => {
    const url = `${PROD_BASE}${route}`
    try {
      const res = await fetch(url, { headers: auth })
      if (res.status >= 400) {
        findings.push({
          severity: 'error',
          category: 'api_health',
          url: route,
          message: `API ${route} returned ${res.status}`,
          details: { status: res.status },
        })
        return
      }
      const text = await res.text()
      if (!text || text.length < 2) {
        findings.push({
          severity: 'warn',
          category: 'api_health',
          url: route,
          message: `API ${route} returned empty body`,
        })
      }
    } catch (e: any) {
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
): Promise<Finding[]> {
  const findings: Finding[] = []
  await Promise.all(tests.map(async t => {
    const url = `${PROD_BASE}${t.endpoint}`
    try {
      const res = await fetch(url, {
        method: t.method || 'POST',
        headers: { ...auth, ...SYNTHETIC_HEADER, 'Content-Type': 'application/json' },
        body: JSON.stringify(t.body),
      })
      const expected = t.expectStatus || 200
      if (res.status !== expected && !(expected === 200 && res.status === 201)) {
        const body = await res.text().catch(() => '')
        findings.push({
          severity: 'error',
          category: 'form_smoke',
          url: t.endpoint,
          message: `Form ${t.endpoint}: expected ${expected}, got ${res.status}`,
          details: { responseBodyPrefix: body.slice(0, 200) },
        })
      }
    } catch (e: any) {
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
): Promise<Finding[]> {
  const findings: Finding[] = []
  const acct = (env as any).CLOUDFLARE_ACCOUNT_ID
  const token = (env as any).CLOUDFLARE_API_TOKEN
  if (!acct || !token) {
    return [{ severity: 'warn', category: 'console_error', message: 'Browser Rendering not configured (CLOUDFLARE_ACCOUNT_ID/API_TOKEN unset) — console errors skipped' }]
  }

  for (const path of paths) {
    const url = `${PROD_BASE}${path}`
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
async function runHealthCheck(env: Bindings): Promise<Finding[]> {
  const findings: Finding[] = []

  // 1. D1 round-trip latency
  try {
    const t0 = Date.now()
    await env.DB.prepare(`SELECT 1 as ok`).first()
    const ms = Date.now() - t0
    if (ms > 1000) findings.push({ severity: 'warn', category: 'health_check', message: `D1 latency ${ms}ms (>1s)` })
  } catch (e: any) {
    findings.push({ severity: 'error', category: 'health_check', message: `D1 SELECT 1 failed: ${e?.message}` })
  }

  // 2. Critical secrets present
  const required = ['GOOGLE_SOLAR_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_VERTEX_API_KEY', 'SQUARE_ACCESS_TOKEN', 'RESEND_API_KEY', 'JWT_SECRET']
  for (const key of required) {
    const val = (env as any)[key]
    if (!val || (typeof val === 'string' && val.length < 4)) {
      findings.push({ severity: 'error', category: 'health_check', message: `Required secret missing or empty: ${key}` })
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

// ── Helpers ─────────────────────────────────────────────────────
async function sessionCookie(cookieName: string, tokenPromise: Promise<string>): Promise<Record<string, string>> {
  const token = await tokenPromise
  return { Cookie: `${cookieName}=${token}` }
}

function fatalFinding(category: Category, err: any): Finding[] {
  return [{ severity: 'error', category, message: `Check threw: ${err?.message || err}` }]
}

async function openRun(env: Bindings, type: ScanType, triggeredBy: string): Promise<number> {
  const r = await env.DB.prepare(
    `INSERT INTO loop_scan_runs (scan_type, status, triggered_by) VALUES (?, 'running', ?) RETURNING id`
  ).bind(type, triggeredBy).first<{ id: number }>()
  return r!.id
}

async function closeRun(
  env: Bindings,
  runId: number,
  t0: number,
  pagesChecked: number,
  findings: Finding[],
): Promise<ScanResult> {
  const fails = findings.filter(f => f.severity === 'error').length
  const status = fails > 0 ? 'fail' : 'pass'
  const summary = findings.length === 0
    ? `OK · ${pagesChecked} page(s) checked`
    : `${findings.length} finding(s): ${fails} error, ${findings.length - fails} warn`

  if (findings.length > 0) {
    const stmts = findings.map(f =>
      env.DB.prepare(
        `INSERT INTO loop_scan_findings (run_id, severity, category, url, message, details_json) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(runId, f.severity, f.category, f.url || null, f.message.slice(0, 500), f.details ? JSON.stringify(f.details).slice(0, 4000) : null)
    )
    await env.DB.batch(stmts)
  }

  await env.DB.prepare(
    `UPDATE loop_scan_runs SET status=?, finished_at=datetime('now'), duration_ms=?, pages_checked=?, ok_count=?, fail_count=?, summary=? WHERE id=?`
  ).bind(status, Date.now() - t0, pagesChecked, pagesChecked - fails, fails, summary.slice(0, 500), runId).run()

  return {
    runId,
    status,
    pagesChecked,
    okCount: pagesChecked - fails,
    failCount: fails,
    summary,
  }
}
