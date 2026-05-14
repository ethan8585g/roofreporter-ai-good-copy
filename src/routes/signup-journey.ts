// ============================================================
// SIGNUP-JOURNEY WEBHOOK — bearer-auth endpoint called by the
// /signup-journey slash command (typically wrapped in
// `/loop 1h /signup-journey`).
//
// Mints a synthetic logged-in customer session, walks the entire
// /customer/* surface + the major auth'd APIs + a few toggle
// round-trips, then emails christinegourley04@gmail.com a digest
// of every dead end found.
//
// Auth: shares FUNNEL_MONITOR_TOKEN with /funnel-monitor, /gmail-health,
// and /signup-health.
// ============================================================

import { Hono } from 'hono'
import type { Bindings, AppEnv } from '../types'
import { runSignupJourney } from '../services/signup-journey'
import { sendJourneyEmail } from '../services/journey-email'
import { recordExternalRun } from '../services/loop-scanner'
import { pruneExpiredScanSessions } from '../services/synthetic-auth'

export const signupJourneyRoutes = new Hono<AppEnv>()

signupJourneyRoutes.use('*', async (c, next) => {
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

signupJourneyRoutes.post('/tick', async (c) => {
  const t0 = Date.now()
  const body = await c.req.json().catch(() => ({})) as {
    skip_email?: boolean
    email_only_on_issues?: boolean
  }

  const result = await runSignupJourney(c.env)

  // Default: only email when something is broken. Daily summaries already
  // come from /signup-health; the journey loop is intentionally noisier
  // about regressions but quiet on healthy hours.
  let email: { ok: boolean; skipped?: boolean; error?: string } = { ok: true, skipped: true }
  if (!body.skip_email) {
    email = await sendJourneyEmail(c.env, result, {
      onlyOnIssues: body.email_only_on_issues !== false, // default true
    })
  }

  // Loop tracker integration — same pattern as /signup-health.
  const status: 'pass' | 'fail' = result.verdict === 'fail' ? 'fail' : 'pass'
  const findings = result.dead_ends.map(d => ({
    severity: d.severity,
    category: 'signup_journey',
    url: d.path,
    message: `[${d.category}] ${d.path}: ${d.message}`,
    details: { status: d.status, ...d.details },
  }))
  const summary = `${result.verdict} · ${result.dead_ends.length} dead end(s) · email ${email.ok ? (email.skipped ? 'skipped (no issues)' : 'sent') : `failed: ${email.error}`}`
  await recordExternalRun(c.env, {
    loopId: 'signup_journey',
    source: 'claude_loop',
    status,
    summary: summary.slice(0, 500),
    durationMs: Date.now() - t0,
    inputs: { skip_email: !!body.skip_email, email_only_on_issues: body.email_only_on_issues !== false },
    outputs: {
      verdict: result.verdict,
      pages: { checked: result.pages_checked, failed: result.pages_failed },
      apis: { checked: result.apis_checked, failed: result.apis_failed },
      toggles: { checked: result.toggles_checked, failed: result.toggles_failed },
      probe_created: result.probe_created,
      email,
    },
    findings,
  }).catch(e => console.warn('[signup-journey] tracker write failed:', e?.message || e))

  // Opportunistic cleanup of any expired probe sessions.
  await pruneExpiredScanSessions(c.env).catch(() => {})

  return c.json({
    verdict: result.verdict,
    pages: { checked: result.pages_checked, failed: result.pages_failed },
    apis: { checked: result.apis_checked, failed: result.apis_failed },
    toggles: { checked: result.toggles_checked, failed: result.toggles_failed },
    probe_created: result.probe_created,
    dead_ends: result.dead_ends,
    email,
    duration_ms: Date.now() - t0,
    checked_at: result.checked_at,
  })
})
