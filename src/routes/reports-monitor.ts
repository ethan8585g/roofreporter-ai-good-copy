// ============================================================
// REPORTS MONITOR — Bearer-token tick endpoint for the
// /reports-monitor slash command (typically wrapped in
// `/loop 1h /reports-monitor`). Triggers the loop-scanner
// 'reports' sweep and returns a one-line summary.
//
// Auth: bearer token matched against env.REPORTS_MONITOR_TOKEN.
// The slash command stores the token in a local gitignored file.
// We deliberately don't reuse the admin session cookie because
// the loop runs from outside a browser.
// ============================================================

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { runScan } from '../services/loop-scanner'

export const reportsMonitorRoutes = new Hono<{ Bindings: Bindings }>()

reportsMonitorRoutes.use('*', async (c, next) => {
  const expected = (c.env as any).REPORTS_MONITOR_TOKEN
  if (!expected) {
    return c.json({ error: 'REPORTS_MONITOR_TOKEN is not configured on the server' }, 503)
  }
  const auth = c.req.header('Authorization') || ''
  const presented = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!presented || presented !== expected) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  return next()
})

reportsMonitorRoutes.post('/tick', async (c) => {
  const result = await runScan(c.env, 'reports', 'manual')

  // Pull the findings for this run so the slash command can produce
  // a per-category breakdown without a second round-trip.
  const findings = await c.env.DB.prepare(
    `SELECT severity, category, message, url, details_json
     FROM loop_scan_findings
     WHERE run_id = ?
     ORDER BY severity DESC, id ASC
     LIMIT 50`,
  ).bind(result.runId).all<{
    severity: string
    category: string
    message: string
    url: string | null
    details_json: string | null
  }>()

  const byCategory: Record<string, number> = {}
  for (const f of findings.results || []) {
    byCategory[f.category] = (byCategory[f.category] || 0) + 1
  }

  return c.json({
    run_id: result.runId,
    status: result.status,
    pages_checked: result.pagesChecked,
    fail_count: result.failCount,
    summary: result.summary,
    by_category: byCategory,
    findings: (findings.results || []).slice(0, 20),
  })
})
