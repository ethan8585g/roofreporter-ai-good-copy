// ============================================================
// CART RECOVERY WEBHOOK — bearer-auth endpoint called by the
// /cart-recovery slash command (typically wrapped in
// `/loop 10m /cart-recovery` or fired on-demand from the
// super-admin loop tracker).
//
// Runs runAbandonedCheckoutRecovery() across the 2h + 24h
// stages, writes a heartbeat into the loop tracker so the
// unified dashboard surfaces the run.
//
// Auth: shares FUNNEL_MONITOR_TOKEN with /funnel-monitor,
// /signup-health, /gmail-health — same secret, same /loop
// pattern.
// ============================================================

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { runAbandonedCheckoutRecovery } from '../services/abandoned-checkout-recovery'
import { recordExternalRun } from '../services/loop-scanner'

export const cartRecoveryRoutes = new Hono<{ Bindings: Bindings }>()

cartRecoveryRoutes.use('*', async (c, next) => {
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

cartRecoveryRoutes.post('/tick', async (c) => {
  const t0 = Date.now()
  const results = await runAbandonedCheckoutRecovery(c.env)

  const totals = results.reduce(
    (acc, r) => ({
      found: acc.found + r.found,
      sent: acc.sent + r.sent,
      failed: acc.failed + r.failed,
      skipped: acc.skipped + r.skipped,
    }),
    { found: 0, sent: 0, failed: 0, skipped: 0 },
  )

  const status: 'pass' | 'fail' = totals.failed > 0 && totals.sent === 0 ? 'fail' : 'pass'
  const summary = `Cart recovery — found ${totals.found}, sent ${totals.sent}, failed ${totals.failed}, skipped ${totals.skipped} ` +
    `(by stage: ${results.map(r => `${r.stage}=${r.sent}/${r.found}`).join(' ')})`

  const findings = results
    .flatMap(r => r.errors.map(err => ({
      severity: 'warn' as const,
      category: 'cart_recovery',
      message: err.slice(0, 500),
      details: { stage: r.stage },
    })))

  await recordExternalRun(c.env, {
    loopId: 'cart_recovery',
    source: 'claude_loop',
    status,
    summary: summary.slice(0, 500),
    durationMs: Date.now() - t0,
    inputs: {},
    outputs: { results, totals },
    findings,
  }).catch(e => console.warn('[cart-recovery] tracker write failed:', e?.message || e))

  return c.json({
    verdict: status === 'pass' ? (totals.sent > 0 ? 'sent' : 'idle') : 'fail',
    totals,
    stages: results,
    duration_ms: Date.now() - t0,
    checked_at: new Date().toISOString(),
  })
})
