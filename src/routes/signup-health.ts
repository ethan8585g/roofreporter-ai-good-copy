// ============================================================
// SIGNUP-HEALTH WEBHOOK — bearer-auth endpoint called by the
// /signup-health slash command (typically wrapped in
// `/loop 24h /signup-health`).
//
// Runs runSignupHealthCheck() across every signal that could
// indicate Roof Manager is losing prospective or new customers,
// emails the summary to christinegourley04@gmail.com, and writes
// a heartbeat into the loop tracker so the unified dashboard
// shows it next to the cf_cron scans.
//
// Auth: shares FUNNEL_MONITOR_TOKEN with /funnel-monitor and
// /gmail-health — same secret, same /loop pattern.
// ============================================================

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { runSignupHealthCheck } from '../services/signup-health'
import { sendSignupHealthEmail } from '../services/health-email'
import { recordExternalRun } from '../services/loop-scanner'

export const signupHealthRoutes = new Hono<{ Bindings: Bindings }>()

signupHealthRoutes.use('*', async (c, next) => {
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

signupHealthRoutes.post('/tick', async (c) => {
  const t0 = Date.now()
  const body = await c.req.json().catch(() => ({})) as { skip_email?: boolean }
  const skipEmail = body.skip_email === true

  const result = await runSignupHealthCheck(c.env)

  // Send email unless caller explicitly opts out (handy for dry-run).
  let email: { ok: boolean; error?: string } = { ok: false, error: 'skipped' }
  if (!skipEmail) {
    email = await sendSignupHealthEmail(c.env, result)
  }

  // Record into the loop tracker so the unified dashboard updates and
  // the loop_definitions row gets last_run_at + last_status.
  const status: 'pass' | 'fail' = result.verdict === 'fail' ? 'fail' : 'pass'
  const summary = `${result.verdict} · ${result.issues.length} issue(s) · email ${email.ok ? 'sent' : `failed: ${email.error}`}`
  const findings = result.issues.map(i => ({
    severity: (i.severity === 'error' ? 'error' : 'warn') as 'error' | 'warn',
    category: 'signup_health',
    message: i.message,
    details: { section: i.section },
  }))
  await recordExternalRun(c.env, {
    loopId: 'signup_health',
    source: 'claude_loop',
    status,
    summary: summary.slice(0, 500),
    durationMs: Date.now() - t0,
    inputs: { skip_email: skipEmail },
    outputs: { verdict: result.verdict, sections: result.sections.map(s => ({ key: s.key, status: s.status, summary: s.summary })), email },
    findings,
  }).catch(e => console.warn('[signup-health] tracker write failed:', e?.message || e))

  return c.json({
    verdict: result.verdict,
    issues: result.issues,
    sections: result.sections.map(s => ({ key: s.key, label: s.label, status: s.status, summary: s.summary })),
    email,
    duration_ms: Date.now() - t0,
    checked_at: result.checked_at,
  })
})
