// ============================================================
// MOBILE-MONITOR WEBHOOK — bearer-auth endpoint called by the
// /mobile-monitor slash command (typically wrapped in
// `/loop 12h /mobile-monitor`).
//
// Loads each public + customer page in a real Cloudflare browser
// at iPhone viewport, classifies per-page outcomes, then emails
// christinegourley04@gmail.com a digest of every issue found.
//
// Auth: shares FUNNEL_MONITOR_TOKEN with /funnel-monitor,
// /signup-journey, /signup-health, /gmail-health, /ads-health.
// ============================================================

import { Hono } from 'hono'
import type { Bindings, AppEnv } from '../types'
import { runMobileMonitor } from '../services/mobile-monitor'
import { sendMobileMonitorEmail } from '../services/mobile-monitor-email'
import { recordExternalRun } from '../services/loop-scanner'
import { pruneExpiredScanSessions } from '../services/synthetic-auth'

export const mobileMonitorRoutes = new Hono<AppEnv>()

mobileMonitorRoutes.use('*', async (c, next) => {
  const expected = c.env.FUNNEL_MONITOR_TOKEN
  if (!expected) {
    return c.json({ error: 'FUNNEL_MONITOR_TOKEN is not configured on the server' }, 503)
  }
  const auth = c.req.header('Authorization') || ''
  const presented = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!presented || presented !== expected) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  return next()
})

mobileMonitorRoutes.post('/tick', async (c) => {
  const t0 = Date.now()
  const body = await c.req.json().catch(() => ({})) as {
    skip_email?: boolean
    email_only_on_issues?: boolean
  }

  const result = await runMobileMonitor(c.env)

  // Default: only email when something is broken. /loop 12h cadence is
  // intentionally noisy on regression but quiet on healthy ticks.
  let email: { ok: boolean; skipped?: boolean; error?: string } = { ok: true, skipped: true }
  if (!body.skip_email) {
    email = await sendMobileMonitorEmail(c.env, result, {
      onlyOnIssues: body.email_only_on_issues !== false,
    })
  }

  const status: 'pass' | 'fail' = result.verdict === 'fail' ? 'fail' : 'pass'
  const findings = result.findings.map(f => ({
    severity: f.severity,
    category: 'mobile_monitor',
    url: f.path,
    message: `[${f.section}/${f.category}] ${f.path} → ${f.status ?? '—'}: ${f.message}`,
    details: { section: f.section, status: f.status, ...f.details },
  }))
  const summary = `${result.verdict} · public ${result.public.checked - result.public.failed}/${result.public.checked} · customer ${result.customer.checked - result.customer.failed}/${result.customer.checked} · ${result.findings.length} issue(s) · email ${email.ok ? (email.skipped ? 'skipped (no issues)' : 'sent') : `failed: ${email.error}`}`
  await recordExternalRun(c.env, {
    loopId: 'mobile_monitor',
    source: 'claude_loop',
    status,
    summary: summary.slice(0, 500),
    durationMs: Date.now() - t0,
    inputs: { skip_email: !!body.skip_email, email_only_on_issues: body.email_only_on_issues !== false },
    outputs: {
      verdict: result.verdict,
      public: result.public,
      customer: result.customer,
      probe_created: result.probe_created,
      browser_rendering_available: result.browser_rendering_available,
      email,
    },
    findings,
  }).catch(e => console.warn('[mobile-monitor] tracker write failed:', e?.message || e))

  await pruneExpiredScanSessions(c.env).catch(() => {})

  return c.json({
    verdict: result.verdict,
    public: result.public,
    customer: result.customer,
    probe_created: result.probe_created,
    browser_rendering_available: result.browser_rendering_available,
    findings: result.findings,
    email,
    duration_ms: Date.now() - t0,
    checked_at: result.checked_at,
  })
})
