// ============================================================
// FUNNEL MONITOR — Hourly signup-funnel regression detector.
// ============================================================
// Called by the /funnel-monitor slash command (typically wrapped in
// `/loop 1h /funnel-monitor`). Reads site_analytics + customers, compares
// the last hour to the same hour-of-day averaged over the last 7 days,
// and queues a super-admin notification when conversion drops sharply.
//
// Auth: bearer token matched against env.FUNNEL_MONITOR_TOKEN. The slash
// command stores the token in a local gitignored file. We deliberately
// don't reuse the admin session cookie because the loop runs from
// outside a browser.

import { Hono } from 'hono'
import type { Bindings } from '../types'

export const funnelMonitorRoutes = new Hono<{ Bindings: Bindings }>()

// Conversion-rate drop (relative) that triggers an alert. 0.25 = "current
// stage rate is 25% below baseline". Tunable; pick conservatively because
// hourly samples are noisy.
const REGRESSION_RATIO = 0.25

// Don't fire on tiny samples — n=3 visitors converting at 0% means nothing.
const MIN_BASELINE_VISITS = 20

// Pages that count as the signup funnel entry. /signup is a 302 to /register
// but is occasionally hit directly. utm/query strings are stripped via LIKE.
const REGISTER_PATH_PATTERNS = ["/register", "/register?%", "/register#%", "/signup", "/signup?%"]

interface BucketCounts {
  pageviews: number
  form_starts: number
  form_submits: number
  customers_created: number
  email_verified: number
  unique_visitors: number
}

interface FunnelStage {
  name: string
  numerator: number
  denominator: number
  rate: number | null
  baseline_rate: number | null
  delta_pct: number | null
}

interface TickResult {
  window: { start: string; end: string }
  current: BucketCounts
  baseline_avg: BucketCounts
  stages: FunnelStage[]
  verdict: 'healthy' | 'watch' | 'alert' | 'insufficient_data'
  drop_stage: string | null
  alert_id: number | null
  notes: string[]
}

funnelMonitorRoutes.use('*', async (c, next) => {
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

funnelMonitorRoutes.post('/tick', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { dry_run?: boolean }
  const dryRun = body.dry_run === true

  const result = await evaluateFunnel(c.env)

  if (result.verdict === 'alert' && !dryRun) {
    result.alert_id = await queueRegressionAlert(c.env, result)
  }

  return c.json(result)
})

async function evaluateFunnel(env: Bindings): Promise<TickResult> {
  const now = new Date()
  const currentEnd = new Date(now)
  const currentStart = new Date(now.getTime() - 60 * 60 * 1000)

  // 8 days of analytics events covers: current hour + 7 same-hour-of-day buckets
  const fetchStart = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000)
  const fetchStartIso = isoForSqlite(fetchStart)

  const registerLikes = REGISTER_PATH_PATTERNS.map(() => 'page_url LIKE ?').join(' OR ')

  const analyticsRes = await env.DB.prepare(`
    SELECT created_at, event_type, visitor_id
    FROM site_analytics
    WHERE created_at >= ?
      AND (${registerLikes})
      AND event_type IN ('pageview', 'form_start', 'form_submit')
  `).bind(fetchStartIso, ...REGISTER_PATH_PATTERNS).all()

  const customersRes = await env.DB.prepare(`
    SELECT created_at, COALESCE(email_verified, 0) AS email_verified
    FROM customers
    WHERE created_at >= ?
  `).bind(fetchStartIso).all()

  const analyticsRows = (analyticsRes.results || []) as Array<{ created_at: string; event_type: string; visitor_id: string | null }>
  const customerRows = (customersRes.results || []) as Array<{ created_at: string; email_verified: number }>

  const current = emptyBucket()
  const baselineBuckets: BucketCounts[] = []
  for (let i = 0; i < 7; i++) baselineBuckets.push(emptyBucket())

  const currentVisitors = new Set<string>()
  const baselineVisitors: Array<Set<string>> = baselineBuckets.map(() => new Set())

  for (const row of analyticsRows) {
    const slot = classifySlot(row.created_at, currentStart, currentEnd)
    if (slot === null) continue
    const bucket = slot === 'current' ? current : baselineBuckets[slot]
    const vSet = slot === 'current' ? currentVisitors : baselineVisitors[slot]
    if (row.event_type === 'pageview') bucket.pageviews++
    else if (row.event_type === 'form_start') bucket.form_starts++
    else if (row.event_type === 'form_submit') bucket.form_submits++
    if (row.visitor_id) vSet.add(row.visitor_id)
  }

  for (const row of customerRows) {
    const slot = classifySlot(row.created_at, currentStart, currentEnd)
    if (slot === null) continue
    const bucket = slot === 'current' ? current : baselineBuckets[slot]
    bucket.customers_created++
    if (row.email_verified) bucket.email_verified++
  }

  current.unique_visitors = currentVisitors.size
  baselineBuckets.forEach((b, i) => { b.unique_visitors = baselineVisitors[i].size })

  const baseline = averageBuckets(baselineBuckets)
  const stages = buildStages(current, baseline)

  const notes: string[] = []
  let verdict: TickResult['verdict'] = 'healthy'
  let dropStage: string | null = null

  const baselineTotalVisits = baseline.pageviews
  if (baselineTotalVisits < MIN_BASELINE_VISITS) {
    verdict = 'insufficient_data'
    notes.push(`baseline pageviews avg ${baselineTotalVisits.toFixed(1)} < ${MIN_BASELINE_VISITS}; not enough history to flag regressions`)
  } else {
    let worstDrop = 0
    for (const s of stages) {
      if (s.delta_pct === null || s.baseline_rate === null) continue
      // We care about NEGATIVE deltas (rate fell below baseline)
      if (s.delta_pct < -worstDrop) {
        worstDrop = -s.delta_pct
        dropStage = s.name
      }
    }
    if (worstDrop >= REGRESSION_RATIO * 100) {
      verdict = 'alert'
      notes.push(`${dropStage} dropped ${worstDrop.toFixed(0)}% vs same-hour-of-day 7d avg`)
    } else if (worstDrop >= (REGRESSION_RATIO * 100) / 2) {
      verdict = 'watch'
      notes.push(`${dropStage} down ${worstDrop.toFixed(0)}%, below alert threshold`)
    }
  }

  // Backend-failure heuristic: form_submit rate normal but customer rows missing.
  // If submits exist but no rows landed, /api/customer/register is probably broken.
  if (current.form_submits >= 3 && current.customers_created === 0) {
    verdict = 'alert'
    dropStage = dropStage || 'submit_to_customer'
    notes.push(`${current.form_submits} form_submits but 0 customer rows — registration endpoint likely failing`)
  }

  return {
    window: { start: isoForSqlite(currentStart), end: isoForSqlite(currentEnd) },
    current,
    baseline_avg: baseline,
    stages,
    verdict,
    drop_stage: dropStage,
    alert_id: null,
    notes,
  }
}

function emptyBucket(): BucketCounts {
  return { pageviews: 0, form_starts: 0, form_submits: 0, customers_created: 0, email_verified: 0, unique_visitors: 0 }
}

// Returns 'current' if ts falls in [currentStart, currentEnd], or an index 0..6
// for the same-hour-of-day window N+1 days ago, else null.
function classifySlot(ts: string, currentStart: Date, currentEnd: Date): 'current' | number | null {
  const t = parseSqliteTs(ts).getTime()
  if (t >= currentStart.getTime() && t < currentEnd.getTime()) return 'current'
  for (let n = 1; n <= 7; n++) {
    const dayMs = 24 * 60 * 60 * 1000
    const bStart = currentStart.getTime() - n * dayMs
    const bEnd = currentEnd.getTime() - n * dayMs
    if (t >= bStart && t < bEnd) return n - 1
  }
  return null
}

function averageBuckets(buckets: BucketCounts[]): BucketCounts {
  if (buckets.length === 0) return emptyBucket()
  const sum = emptyBucket()
  for (const b of buckets) {
    sum.pageviews += b.pageviews
    sum.form_starts += b.form_starts
    sum.form_submits += b.form_submits
    sum.customers_created += b.customers_created
    sum.email_verified += b.email_verified
    sum.unique_visitors += b.unique_visitors
  }
  const n = buckets.length
  return {
    pageviews: sum.pageviews / n,
    form_starts: sum.form_starts / n,
    form_submits: sum.form_submits / n,
    customers_created: sum.customers_created / n,
    email_verified: sum.email_verified / n,
    unique_visitors: sum.unique_visitors / n,
  }
}

function buildStages(cur: BucketCounts, base: BucketCounts): FunnelStage[] {
  const definitions: Array<{ name: string; num: keyof BucketCounts; den: keyof BucketCounts }> = [
    { name: 'pageview_to_form_start', num: 'form_starts', den: 'pageviews' },
    { name: 'form_start_to_submit', num: 'form_submits', den: 'form_starts' },
    { name: 'submit_to_customer', num: 'customers_created', den: 'form_submits' },
    { name: 'customer_to_verified', num: 'email_verified', den: 'customers_created' },
  ]
  return definitions.map(({ name, num, den }) => {
    const curRate = rate(cur[num], cur[den])
    const baseRate = rate(base[num], base[den])
    const delta = curRate !== null && baseRate !== null && baseRate > 0
      ? ((curRate - baseRate) / baseRate) * 100
      : null
    return {
      name,
      numerator: cur[num],
      denominator: cur[den],
      rate: curRate,
      baseline_rate: baseRate,
      delta_pct: delta,
    }
  })
}

function rate(num: number, den: number): number | null {
  if (!den || den <= 0) return null
  return num / den
}

async function queueRegressionAlert(env: Bindings, result: TickResult): Promise<number | null> {
  const orderNumber = `FUNNEL-${result.window.end.replace(/[^0-9]/g, '').slice(0, 12)}`
  const noteSummary = result.notes.join(' | ')
  try {
    const ins = await env.DB.prepare(`
      INSERT INTO super_admin_notifications (
        kind, order_number, property_address, severity, email_status, payload_json
      ) VALUES ('funnel_regression', ?, ?, 'warn', 'skipped', ?)
    `).bind(
      orderNumber,
      `Signup funnel regression — ${result.drop_stage || 'unknown stage'}`,
      JSON.stringify({
        window: result.window,
        drop_stage: result.drop_stage,
        notes: result.notes,
        current: result.current,
        baseline_avg: result.baseline_avg,
        stages: result.stages,
      }),
    ).run()
    return (ins?.meta?.last_row_id as number) || null
  } catch (e: any) {
    console.error('[funnel-monitor] failed to insert regression alert:', e?.message || e, noteSummary)
    return null
  }
}

function parseSqliteTs(ts: string): Date {
  // SQLite CURRENT_TIMESTAMP yields 'YYYY-MM-DD HH:MM:SS' (UTC, no Z).
  // Treat as UTC by appending 'Z'. Handles ISO too since 'Z' on a valid ISO is harmless.
  if (ts.includes('T')) return new Date(ts.endsWith('Z') ? ts : ts + 'Z')
  return new Date(ts.replace(' ', 'T') + 'Z')
}

function isoForSqlite(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ')
}
