// ============================================================
// FUNNEL MONITOR — Hourly signup-funnel regression detector.
// ============================================================
// Called by the /funnel-monitor slash command (typically wrapped in
// `/loop 1h /funnel-monitor`). Reads site_analytics + customers and runs
// two checks:
//   1. CONVERSION TREND — last 24h vs. trailing 7×24h baseline avg.
//      Window is 24h (not 1h) because /register traffic is ~7-8 pv/day;
//      hourly buckets give 0-1 visits each — no statistical signal.
//   2. BACKEND TRIPWIRE — last 1h: form_submits ≥ 3 with 0 customer rows
//      means /api/customer/register is failing. Fires regardless of (1).
// Either check can queue a super-admin funnel_regression notification.
//
// Auth: bearer token matched against env.FUNNEL_MONITOR_TOKEN. The slash
// command stores the token in a local gitignored file. We deliberately
// don't reuse the admin session cookie because the loop runs from
// outside a browser.

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { recordExternalRun } from '../services/loop-scanner'

export const funnelMonitorRoutes = new Hono<{ Bindings: Bindings }>()

// Conversion-rate drop (relative) that triggers an alert. 0.25 = "current
// stage rate is 25% below baseline". Tunable; pick conservatively because
// daily samples are still moderately noisy at low traffic.
const REGRESSION_RATIO = 0.25

// Don't fire on tiny samples — n=3 visitors converting at 0% means nothing.
// 5 is set for a site with ~7-8 register pv/day; raise as traffic grows.
const MIN_BASELINE_VISITS = 5

// Window the conversion-trend check spans, in hours. 24 = trailing 1d vs.
// 7-day-of-1d-windows avg.
const TREND_WINDOW_HOURS = 24

// Backend-failure tripwire window. Stays at 1h — a sudden break should fire
// fast and doesn't need statistical baselines.
const BACKEND_TRIPWIRE_HOURS = 1
const BACKEND_TRIPWIRE_MIN_SUBMITS = 3

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
  // Informational stages (form_start/form_submit) are surfaced in the
  // response for context but never trigger alerts — their tracking is
  // client-side and brittle (Google OAuth signups skip the form_submit
  // beacon; redirects can race the beacon). Only stages backed by D1
  // ground truth (customers, email_verified) gate the verdict.
  alerts_on_drop: boolean
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
  last_hour: { form_submits: number; customers_created: number }
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
  const t0 = Date.now()
  const body = await c.req.json().catch(() => ({})) as { dry_run?: boolean }
  const dryRun = body.dry_run === true

  const result = await evaluateFunnel(c.env)

  if (result.verdict === 'alert' && !dryRun) {
    result.alert_id = await queueRegressionAlert(c.env, result)
  }

  // Mirror into the Loop Tracker so this /loop heartbeat shows up in the
  // unified dashboard alongside the cron scans.
  const status: 'pass' | 'fail' = result.verdict === 'alert' ? 'fail' : 'pass'
  const findings = result.verdict === 'alert'
    ? [{
        severity: 'error' as const,
        category: 'funnel_regression',
        message: `${result.drop_stage || 'unknown stage'} — ${result.notes.join(' | ')}`.slice(0, 500),
        details: { drop_stage: result.drop_stage, notes: result.notes, current: result.current, baseline: result.baseline_avg },
      }]
    : []
  await recordExternalRun(c.env, {
    loopId: 'funnel_monitor',
    source: 'claude_loop',
    status,
    summary: `Verdict: ${result.verdict}${result.drop_stage ? ` (${result.drop_stage})` : ''} · ${result.notes.length} note(s)`,
    durationMs: Date.now() - t0,
    inputs: { dry_run: dryRun },
    outputs: { verdict: result.verdict, drop_stage: result.drop_stage, alert_id: result.alert_id, last_hour: result.last_hour },
    findings,
  }).catch(e => console.warn('[funnel-monitor] tracker write failed:', e?.message || e))

  return c.json(result)
})

async function evaluateFunnel(env: Bindings): Promise<TickResult> {
  const HOUR_MS = 60 * 60 * 1000
  const now = new Date()
  const windowEnd = new Date(now)
  const windowStart = new Date(now.getTime() - TREND_WINDOW_HOURS * HOUR_MS)
  const tripwireStart = new Date(now.getTime() - BACKEND_TRIPWIRE_HOURS * HOUR_MS)

  // Pull trend-window + 7 baseline windows of identical width = 8 windows total.
  const fetchStart = new Date(now.getTime() - 8 * TREND_WINDOW_HOURS * HOUR_MS)
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

  // Backend tripwire counters — last BACKEND_TRIPWIRE_HOURS only.
  let tripwireSubmits = 0
  let tripwireCustomers = 0

  for (const row of analyticsRows) {
    const ts = parseSqliteTs(row.created_at).getTime()
    if (ts >= tripwireStart.getTime() && ts < windowEnd.getTime() && row.event_type === 'form_submit') {
      tripwireSubmits++
    }
    const slot = classifySlot(row.created_at, windowStart, windowEnd, TREND_WINDOW_HOURS)
    if (slot === null) continue
    const bucket = slot === 'current' ? current : baselineBuckets[slot]
    const vSet = slot === 'current' ? currentVisitors : baselineVisitors[slot]
    if (row.event_type === 'pageview') bucket.pageviews++
    else if (row.event_type === 'form_start') bucket.form_starts++
    else if (row.event_type === 'form_submit') bucket.form_submits++
    if (row.visitor_id) vSet.add(row.visitor_id)
  }

  for (const row of customerRows) {
    const ts = parseSqliteTs(row.created_at).getTime()
    if (ts >= tripwireStart.getTime() && ts < windowEnd.getTime()) tripwireCustomers++
    const slot = classifySlot(row.created_at, windowStart, windowEnd, TREND_WINDOW_HOURS)
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
    notes.push(`baseline pageviews avg ${baselineTotalVisits.toFixed(1)} < ${MIN_BASELINE_VISITS}; not enough history to flag conversion regressions`)
  } else {
    let worstDrop = 0
    for (const s of stages) {
      if (!s.alerts_on_drop) continue
      if (s.delta_pct === null || s.baseline_rate === null) continue
      // We care about NEGATIVE deltas (rate fell below baseline)
      if (s.delta_pct < -worstDrop) {
        worstDrop = -s.delta_pct
        dropStage = s.name
      }
    }
    if (worstDrop >= REGRESSION_RATIO * 100) {
      verdict = 'alert'
      notes.push(`${dropStage} dropped ${worstDrop.toFixed(0)}% vs trailing 7×24h baseline`)
    } else if (worstDrop >= (REGRESSION_RATIO * 100) / 2) {
      verdict = 'watch'
      notes.push(`${dropStage} down ${worstDrop.toFixed(0)}%, below alert threshold`)
    }
  }

  // Backend-failure tripwire (1h): if visitors are submitting the form but
  // no customer rows are landing, /api/customer/register is failing. Fires
  // regardless of trend verdict; this is a different kind of problem.
  if (tripwireSubmits >= BACKEND_TRIPWIRE_MIN_SUBMITS && tripwireCustomers === 0) {
    verdict = 'alert'
    dropStage = dropStage || 'submit_to_customer'
    notes.push(`backend tripwire: ${tripwireSubmits} form_submits in last ${BACKEND_TRIPWIRE_HOURS}h but 0 customer rows — registration endpoint likely failing`)
  }

  return {
    window: { start: isoForSqlite(windowStart), end: isoForSqlite(windowEnd) },
    current,
    baseline_avg: baseline,
    stages,
    verdict,
    drop_stage: dropStage,
    alert_id: null,
    notes,
    last_hour: { form_submits: tripwireSubmits, customers_created: tripwireCustomers },
  }
}

function emptyBucket(): BucketCounts {
  return { pageviews: 0, form_starts: 0, form_submits: 0, customers_created: 0, email_verified: 0, unique_visitors: 0 }
}

// Returns 'current' if ts falls in [currentStart, currentEnd], or an index 0..6
// for the Nth contiguous baseline window of the same width preceding the
// current one (n=1 → window immediately before current, …, n=7 → 7 windows back).
// With windowHours=24, this gives 7 trailing 24h windows averaged. With 1h,
// it would give same-hour-of-day buckets (legacy behavior).
function classifySlot(ts: string, currentStart: Date, currentEnd: Date, windowHours: number): 'current' | number | null {
  const t = parseSqliteTs(ts).getTime()
  if (t >= currentStart.getTime() && t < currentEnd.getTime()) return 'current'
  const windowMs = windowHours * 60 * 60 * 1000
  for (let n = 1; n <= 7; n++) {
    const bStart = currentStart.getTime() - n * windowMs
    const bEnd = currentEnd.getTime() - n * windowMs
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
  const definitions: Array<{ name: string; num: keyof BucketCounts; den: keyof BucketCounts; alerts_on_drop: boolean }> = [
    // Informational only — client-side tracking is leaky (OAuth skips form
    // events, redirects race the beacon). Reported for visibility.
    { name: 'pageview_to_form_start', num: 'form_starts', den: 'pageviews', alerts_on_drop: false },
    { name: 'form_start_to_submit',   num: 'form_submits', den: 'form_starts', alerts_on_drop: false },
    // Authoritative — D1-backed. These gate the verdict.
    { name: 'pageview_to_customer',   num: 'customers_created', den: 'pageviews', alerts_on_drop: true },
    { name: 'customer_to_verified',   num: 'email_verified', den: 'customers_created', alerts_on_drop: true },
  ]
  return definitions.map(({ name, num, den, alerts_on_drop }) => {
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
      alerts_on_drop,
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
