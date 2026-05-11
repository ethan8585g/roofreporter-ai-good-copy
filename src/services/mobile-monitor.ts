// ============================================================
// MOBILE-MONITOR — Loads the public webfront + customer module in
// a real Cloudflare browser at iPhone viewport (375×667 @ 2x DPR,
// isMobile + hasTouch) to catch layout breaks, missing viewport
// meta, and JS console errors that desktop fetches miss.
//
// Triggered by: /loop /mobile-monitor (POST /api/mobile-monitor/tick)
//               + cron-worker every 12h.
// Synthetic auth (customer pages): issueJourneyProbeSession (same
// probe customer the signup-journey loop uses).
// ============================================================

import type { Bindings } from '../types'
import { issueJourneyProbeSession } from './synthetic-auth'

const PROD_BASE = 'https://www.roofmanager.ca'

// iPhone 13 mini viewport — narrowest common modern phone, catches
// the most layout breaks. iOS Safari 17 UA so any UA-conditional
// code paths route through the iPhone branch.
const MOBILE_VIEWPORT = { width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const PUBLIC_PAGES = ['/', '/pricing', '/features', '/contact', '/register', '/login']
const CUSTOMER_PAGES = [
  '/customer/dashboard',
  '/customer/order',
  '/customer/profile',
  '/customer/reports',
  '/customer/jobs',
  '/customer/buy-reports',
  '/customer/storm-scout',
  '/customer/secretary',
]

export type MobileSeverity = 'error' | 'warn'
export type MobileSection = 'public' | 'customer'

export interface MobileFinding {
  section: MobileSection
  category: 'http_5xx' | 'http_4xx' | 'auth_drop' | 'no_viewport_meta' | 'no_h1' | 'console_error' | 'render_threw' | 'browser_rendering_skipped'
  severity: MobileSeverity
  path: string
  status: number | null
  message: string
  details?: Record<string, any>
}

export interface MobileResult {
  ok: boolean
  verdict: 'pass' | 'warn' | 'fail'
  checked_at: string
  duration_ms: number
  probe_created: boolean
  public: { checked: number; failed: number; console_errors: number }
  customer: { checked: number; failed: number; console_errors: number }
  findings: MobileFinding[]
  browser_rendering_available: boolean
}

interface ProbeOutcome {
  status: number | null
  finalUrl: string | null
  hasViewportMeta: boolean
  h1Count: number
  consoleErrors: Array<{ text: string }>
  renderThrew: string | null
}

export async function runMobileMonitor(env: Bindings): Promise<MobileResult> {
  const t0 = Date.now()
  const checkedAt = new Date().toISOString()
  const findings: MobileFinding[] = []

  const acct = (env as any).CLOUDFLARE_ACCOUNT_ID
  const token = (env as any).CLOUDFLARE_API_TOKEN
  if (!acct || !token) {
    findings.push({
      section: 'public',
      category: 'browser_rendering_skipped',
      severity: 'warn',
      path: '*',
      status: null,
      message: 'Browser Rendering creds (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN) not configured — mobile probes cannot run.',
    })
    return {
      ok: false,
      verdict: 'warn',
      checked_at: checkedAt,
      duration_ms: Date.now() - t0,
      probe_created: false,
      public: { checked: 0, failed: 0, console_errors: 0 },
      customer: { checked: 0, failed: 0, console_errors: 0 },
      findings,
      browser_rendering_available: false,
    }
  }

  // Public pages — no auth.
  let publicFailed = 0
  let publicConsoleErrors = 0
  for (const path of PUBLIC_PAGES) {
    const out = await renderMobile(acct, token, `${PROD_BASE}${path}`, {})
    const pageFindings = classify('public', path, out, false)
    findings.push(...pageFindings)
    if (pageFindings.some(f => f.severity === 'error')) publicFailed++
    publicConsoleErrors += out.consoleErrors.length
  }

  // Customer module — mint synthetic session, pass cookie via extra headers.
  // CSRF token only matters for state-changing PUTs; the GET-only walk just
  // needs the session cookie, but we mint both for parity with signup-journey.
  let customerFailed = 0
  let customerConsoleErrors = 0
  let probeCreated = false
  try {
    const probe = await issueJourneyProbeSession(env)
    probeCreated = probe.createdProbe
    const csrfBytes = crypto.getRandomValues(new Uint8Array(24))
    let s = ''
    for (let i = 0; i < csrfBytes.length; i++) s += String.fromCharCode(csrfBytes[i])
    const csrfToken = btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
    const cookie = `rm_customer_session=${probe.token}; rm_csrf=${csrfToken}`

    for (const path of CUSTOMER_PAGES) {
      const out = await renderMobile(acct, token, `${PROD_BASE}${path}`, { Cookie: cookie })
      const pageFindings = classify('customer', path, out, true)
      findings.push(...pageFindings)
      if (pageFindings.some(f => f.severity === 'error')) customerFailed++
      customerConsoleErrors += out.consoleErrors.length
    }
  } catch (e: any) {
    findings.push({
      section: 'customer',
      category: 'auth_drop',
      severity: 'error',
      path: '*',
      status: null,
      message: `Failed to mint synthetic customer session: ${e?.message || e}`,
    })
    customerFailed = CUSTOMER_PAGES.length
  }

  const verdict: 'pass' | 'warn' | 'fail' = findings.some(f => f.severity === 'error')
    ? 'fail'
    : findings.length > 0 ? 'warn' : 'pass'

  return {
    ok: verdict !== 'fail',
    verdict,
    checked_at: checkedAt,
    duration_ms: Date.now() - t0,
    probe_created: probeCreated,
    public: { checked: PUBLIC_PAGES.length, failed: publicFailed, console_errors: publicConsoleErrors },
    customer: { checked: CUSTOMER_PAGES.length, failed: customerFailed, console_errors: customerConsoleErrors },
    findings,
    browser_rendering_available: true,
  }
}

function classify(section: MobileSection, path: string, out: ProbeOutcome, isAuthed: boolean): MobileFinding[] {
  const out_findings: MobileFinding[] = []

  if (out.renderThrew) {
    out_findings.push({
      section, category: 'render_threw', severity: 'error', path, status: null,
      message: `Browser Rendering threw: ${out.renderThrew}`,
    })
    return out_findings
  }

  // Auth drop — customer page redirected to /login (final URL betrays it).
  if (isAuthed && out.finalUrl && /\/login(?:\?|$)/.test(out.finalUrl)) {
    out_findings.push({
      section, category: 'auth_drop', severity: 'error', path, status: out.status,
      message: `Authed page redirected to login (final ${out.finalUrl}) — synthetic session may have been rejected`,
    })
    return out_findings
  }

  if (out.status !== null && out.status >= 500) {
    out_findings.push({
      section, category: 'http_5xx', severity: 'error', path, status: out.status,
      message: `HTTP ${out.status} on mobile render`,
    })
  } else if (out.status !== null && out.status >= 400) {
    // Treat 4xx as error too — a customer-facing page shouldn't 4xx for
    // a real visitor. (signup-journey already flags /customer bare 404.)
    out_findings.push({
      section, category: 'http_4xx', severity: 'error', path, status: out.status,
      message: `HTTP ${out.status} on mobile render`,
    })
  }

  if (out.status !== null && out.status < 400 && !out.hasViewportMeta) {
    out_findings.push({
      section, category: 'no_viewport_meta', severity: 'warn', path, status: out.status,
      message: 'Page is missing <meta name="viewport"> — will render at desktop width on iPhone',
    })
  }

  if (out.status !== null && out.status < 400 && out.h1Count === 0) {
    out_findings.push({
      section, category: 'no_h1', severity: 'warn', path, status: out.status,
      message: 'Page rendered but contains zero <h1> elements (likely layout/JS break)',
    })
  }

  for (const e of out.consoleErrors.slice(0, 3)) {
    out_findings.push({
      section, category: 'console_error', severity: 'warn', path, status: out.status,
      message: `Console error: ${e.text.slice(0, 200)}`,
    })
  }

  return out_findings
}

async function renderMobile(
  accountId: string,
  apiToken: string,
  url: string,
  extraHeaders: Record<string, string>,
): Promise<ProbeOutcome> {
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/json`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        waitForTimeout: 4000,
        userAgent: MOBILE_UA,
        viewport: MOBILE_VIEWPORT,
        setExtraHTTPHeaders: { 'User-Agent': MOBILE_UA, ...extraHeaders },
        // Ask the browser to extract the few signals we actually care about.
        // Browser Rendering's structured-output mode runs this against the
        // final DOM, which means it implicitly waits for hydration.
        response_format: {
          type: 'json_schema',
          json_schema: {
            type: 'object',
            properties: {
              hasViewportMeta: { type: 'boolean' },
              h1Count: { type: 'integer' },
              title: { type: 'string' },
            },
            required: ['hasViewportMeta', 'h1Count'],
          },
        },
      }),
    })
    if (res.status === 401 || res.status === 403) {
      return { status: null, finalUrl: null, hasViewportMeta: false, h1Count: 0, consoleErrors: [], renderThrew: `Cloudflare API ${res.status} — token not scoped for Browser Rendering` }
    }
    const json: any = await res.json().catch(() => ({}))
    const result = json?.result ?? json
    const extracted = result?.response ?? result?.json ?? result ?? {}
    const consoleMessages: any[] = result?.consoleMessages || json?.consoleMessages || []
    const consoleErrors = consoleMessages
      .filter((m: any) => m.type === 'error' || m.level === 'error')
      .map((m: any) => ({ text: String(m.text || m.message || '') }))
    return {
      status: typeof result?.status === 'number' ? result.status : (res.ok ? 200 : res.status),
      finalUrl: result?.url || result?.finalUrl || null,
      hasViewportMeta: !!extracted.hasViewportMeta,
      h1Count: typeof extracted.h1Count === 'number' ? extracted.h1Count : 0,
      consoleErrors,
      renderThrew: null,
    }
  } catch (e: any) {
    return { status: null, finalUrl: null, hasViewportMeta: false, h1Count: 0, consoleErrors: [], renderThrew: e?.message || String(e) }
  }
}
