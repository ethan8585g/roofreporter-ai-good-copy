// ============================================================
// ADS-HEALTH WEBHOOK — bearer-auth endpoint called by the
// /ads-health slash command (typically wrapped in
// `/loop 4h /ads-health`) AND by the cron-worker every 4 hours.
//
// Runs runAdsHealthCheck() across every signal that could indicate
// our paid Google Ads / Meta Ads / organic social attribution stack
// is silently failing. Emails the summary to christinegourley04@gmail.com
// on warn/fail (silent on pass), and writes a heartbeat into the loop
// tracker so the unified dashboard surfaces it.
//
// Auth: shares FUNNEL_MONITOR_TOKEN with /signup-health, /signup-journey,
// /gmail-health — same secret, same /loop pattern.
// ============================================================

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { runAdsHealthCheck } from '../services/ads-health'
import { sendAdsHealthEmail } from '../services/ads-health-email'
import { recordExternalRun } from '../services/loop-scanner'

export const adsHealthRoutes = new Hono<{ Bindings: Bindings }>()

adsHealthRoutes.use('*', async (c, next) => {
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

adsHealthRoutes.post('/tick', async (c) => {
  const t0 = Date.now()
  const body = await c.req.json().catch(() => ({})) as { skip_email?: boolean }
  const skipEmail = body.skip_email === true

  const result = await runAdsHealthCheck(c.env)

  let email: { ok: boolean; error?: string; skipped?: boolean } = { ok: false, error: 'skipped' }
  if (!skipEmail) {
    email = await sendAdsHealthEmail(c.env, result)
  }

  const status: 'pass' | 'fail' = result.verdict === 'fail' ? 'fail' : 'pass'
  const summary = `${result.verdict} · ${result.issues.length} issue(s) · email ${
    email.skipped ? 'skipped (verdict pass)' : email.ok ? 'sent' : `failed: ${email.error}`
  }`
  const findings = result.issues.map(i => ({
    severity: (i.severity === 'error' ? 'error' : 'warn') as 'error' | 'warn',
    category: 'ads_health',
    message: i.message,
    details: { section: i.section },
  }))
  await recordExternalRun(c.env, {
    loopId: 'ads_health',
    source: 'claude_loop',
    status,
    summary: summary.slice(0, 500),
    durationMs: Date.now() - t0,
    inputs: { skip_email: skipEmail },
    outputs: { verdict: result.verdict, sections: result.sections.map(s => ({ key: s.key, status: s.status, summary: s.summary })), email },
    findings,
  }).catch(e => console.warn('[ads-health] tracker write failed:', e?.message || e))

  return c.json({
    verdict: result.verdict,
    issues: result.issues,
    sections: result.sections.map(s => ({ key: s.key, label: s.label, status: s.status, summary: s.summary })),
    email,
    duration_ms: Date.now() - t0,
    checked_at: result.checked_at,
  })
})
