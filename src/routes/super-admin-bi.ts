/**
 * Super Admin BI Analytics Hub — API Routes
 * Mounted at /api/admin/bi
 *
 * Endpoints:
 *   GET /api/admin/bi/business-intel   — MRR, ARR, ARPC, trial→paid, churn, report stats
 *   GET /api/admin/bi/funnel           — 5-stage conversion funnel (7d / 30d)
 *   GET /api/admin/bi/customer-health  — Per-customer health score (0-100) + at-risk flag
 *   GET /api/admin/bi/live-visitors    — Active sessions in last 5min + recent event feed
 *   GET /api/admin/bi/revenue-waterfall — Orders → paid breakdown by tier (last 30d)
 *   GET /api/admin/bi/anomalies        — Threshold-based alerts (revenue drop, error spike, etc.)
 *   GET /api/admin/bi/api-performance  — Avg/P95 response time + error rate by endpoint
 */
import { Hono } from 'hono'
import { validateAdminSession, requireSuperadmin } from './auth'

type Bindings = { DB: D1Database; [key: string]: any }
const superAdminBi = new Hono<{ Bindings: Bindings }>()

// Auth middleware — superadmin only
superAdminBi.use('/*', async (c, next) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Admin authentication required' }, 401)
  if (!requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  c.set('admin' as any, admin)
  return next()
})

// ── BUSINESS INTELLIGENCE ─────────────────────────────────────
superAdminBi.get('/business-intel', async (c) => {
  try {
    const db = c.env.DB
    const [
      mrrRow, revenue30dRow, trialRow, arpcRow,
      monthlyNewRow, churnRow, reportStatsRow
    ] = await db.batch([
      db.prepare(`SELECT COALESCE(SUM(monthly_price_cents),0) as mrr_cents FROM secretary_subscriptions WHERE status='active'`),
      db.prepare(`SELECT COALESCE(SUM(amount),0) as revenue_30d FROM square_payments WHERE status='completed' AND created_at >= datetime('now','-30 days')`),
      db.prepare(`SELECT COUNT(CASE WHEN is_trial=1 THEN 1 END) as trial_orders, COUNT(CASE WHEN is_trial=1 AND payment_status='paid' THEN 1 END) as trial_converted FROM orders WHERE created_at >= datetime('now','-90 days')`),
      db.prepare(`SELECT COUNT(DISTINCT customer_id) as paying_customers, COALESCE(SUM(amount),0) as total_revenue_12m FROM square_payments WHERE status='completed' AND created_at >= datetime('now','-12 months')`),
      db.prepare(`SELECT strftime('%Y-%m',created_at) as month, COUNT(*) as new_customers FROM customers WHERE created_at >= datetime('now','-6 months') GROUP BY strftime('%Y-%m',created_at) ORDER BY month`),
      db.prepare(`SELECT COUNT(*) as churned FROM customers WHERE is_active=1 AND last_login IS NOT NULL AND last_login < datetime('now','-60 days')`),
      db.prepare(`SELECT COUNT(*) as total_reports, COUNT(CASE WHEN status='completed' THEN 1 END) as completed_reports, ROUND(AVG(CASE WHEN confidence_score IS NOT NULL THEN confidence_score END),1) as avg_quality_score FROM reports WHERE created_at >= datetime('now','-30 days')`)
    ]) as any[]

    const mrr_cents = (mrrRow.results?.[0]?.mrr_cents as number) || 0
    const revenue_30d = (revenue30dRow.results?.[0]?.revenue_30d as number) || 0
    const trial_orders = (trialRow.results?.[0]?.trial_orders as number) || 0
    const trial_converted = (trialRow.results?.[0]?.trial_converted as number) || 0
    const paying_customers = (arpcRow.results?.[0]?.paying_customers as number) || 0
    const total_revenue_12m = (arpcRow.results?.[0]?.total_revenue_12m as number) || 0
    const churned = (churnRow.results?.[0]?.churned as number) || 0
    const total_reports = (reportStatsRow.results?.[0]?.total_reports as number) || 0
    const completed_reports = (reportStatsRow.results?.[0]?.completed_reports as number) || 0
    const avg_quality_score = (reportStatsRow.results?.[0]?.avg_quality_score as number) || 0

    return c.json({
      mrr_cents,
      arr_cents: mrr_cents * 12,
      revenue_30d_cents: Math.round(revenue_30d * 100),
      trial_orders,
      trial_converted,
      trial_conversion_rate: trial_orders > 0 ? Math.round((trial_converted / trial_orders) * 100) : 0,
      paying_customers,
      total_revenue_12m_cents: Math.round(total_revenue_12m * 100),
      arpc_cents: paying_customers > 0 ? Math.round((total_revenue_12m / paying_customers) * 100) : 0,
      monthly_new_customers: (monthlyNewRow.results || []) as any[],
      churned_customers: churned,
      total_reports_30d: total_reports,
      completed_reports_30d: completed_reports,
      report_completion_rate: total_reports > 0 ? Math.round((completed_reports / total_reports) * 100) : 0,
      avg_quality_score
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── CONVERSION FUNNEL ─────────────────────────────────────────
superAdminBi.get('/funnel', async (c) => {
  const period = c.req.query('period') === '30d' ? '-30 days' : '-7 days'
  const periodLabel = period === '-30 days' ? '30d' : '7d'

  try {
    const db = c.env.DB
    const [visitorsRow, pricingRow, signupsRow, ordersRow, paidRow] = await db.batch([
      db.prepare(`SELECT COUNT(DISTINCT visitor_id) as cnt FROM site_analytics WHERE event_type='pageview' AND created_at >= datetime('now',?) AND visitor_id IS NOT NULL AND page_url NOT LIKE '/admin%' AND page_url NOT LIKE '/super-admin%' AND page_url NOT LIKE '/login%'`).bind(period),
      db.prepare(`SELECT COUNT(DISTINCT visitor_id) as cnt FROM site_analytics WHERE event_type='pageview' AND page_url LIKE '/pricing%' AND created_at >= datetime('now',?) AND visitor_id IS NOT NULL`).bind(period),
      db.prepare(`SELECT COUNT(*) as cnt FROM customers WHERE created_at >= datetime('now',?)`).bind(period),
      db.prepare(`SELECT COUNT(*) as cnt FROM orders WHERE created_at >= datetime('now',?) AND (is_trial IS NULL OR is_trial=0)`).bind(period),
      db.prepare(`SELECT COUNT(*) as cnt FROM orders WHERE payment_status='paid' AND (is_trial IS NULL OR is_trial=0) AND updated_at >= datetime('now',?)`).bind(period)
    ]) as any[]

    const counts = [
      (visitorsRow.results?.[0]?.cnt as number) || 0,
      (pricingRow.results?.[0]?.cnt as number) || 0,
      (signupsRow.results?.[0]?.cnt as number) || 0,
      (ordersRow.results?.[0]?.cnt as number) || 0,
      (paidRow.results?.[0]?.cnt as number) || 0
    ]
    const labels = ['Site Visitors', 'Pricing Page', 'Signed Up', 'Order Created', 'Order Paid']
    const base = counts[0] || 1

    const stages = counts.map((count, i) => ({
      stage: i + 1,
      label: labels[i],
      count,
      pct_of_stage1: Math.round((count / base) * 100)
    }))

    const dropoffs = stages.slice(0, -1).map((s, i) => ({
      from: s.stage,
      to: stages[i + 1].stage,
      from_label: s.label,
      to_label: stages[i + 1].label,
      lost_pct: s.count > 0 ? Math.round(((s.count - stages[i + 1].count) / s.count) * 100) : 0
    }))

    return c.json({ period: periodLabel, stages, dropoffs })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── CUSTOMER HEALTH SCORES ────────────────────────────────────
superAdminBi.get('/customer-health', async (c) => {
  try {
    const db = c.env.DB
    const [customersRow, reportsRow, paymentsRow, callsRow] = await db.batch([
      db.prepare(`SELECT c.id, c.name, c.email, c.company_name, c.is_active, c.last_login, c.membership_tier_id, c.created_at, mt.name as tier_name FROM customers c LEFT JOIN membership_tiers mt ON c.membership_tier_id=mt.id WHERE c.is_active=1 ORDER BY c.last_login DESC LIMIT 200`),
      db.prepare(`SELECT customer_id, COUNT(*) as reports_30d FROM orders WHERE created_at >= datetime('now','-30 days') AND status NOT IN ('cancelled','failed') GROUP BY customer_id`),
      db.prepare(`SELECT customer_id, status, MAX(created_at) as last_payment_at FROM square_payments GROUP BY customer_id`),
      db.prepare(`SELECT customer_id, COUNT(*) as calls_30d FROM secretary_call_logs WHERE created_at >= datetime('now','-30 days') GROUP BY customer_id`)
    ]) as any[]

    const reportMap = new Map<number, number>()
    for (const r of (reportsRow.results || [])) reportMap.set(r.customer_id, r.reports_30d)

    const paymentMap = new Map<number, { status: string; last_payment_at: string }>()
    for (const r of (paymentsRow.results || [])) paymentMap.set(r.customer_id, { status: r.status, last_payment_at: r.last_payment_at })

    const callMap = new Map<number, number>()
    for (const r of (callsRow.results || [])) callMap.set(r.customer_id, r.calls_30d)

    const now = Date.now()
    const customers = (customersRow.results || []).map((c: any) => {
      const lastLoginMs = c.last_login ? new Date(c.last_login).getTime() : null
      const daysSinceLogin = lastLoginMs ? Math.floor((now - lastLoginMs) / 86400000) : null

      let loginScore = 0
      if (daysSinceLogin === null) loginScore = 0
      else if (daysSinceLogin <= 7) loginScore = 40
      else if (daysSinceLogin <= 30) loginScore = 25
      else if (daysSinceLogin <= 60) loginScore = 10
      else loginScore = 0

      const reports30d = reportMap.get(c.id) || 0
      const reportScore = reports30d >= 3 ? 30 : reports30d >= 1 ? 20 : 0

      const payment = paymentMap.get(c.id)
      let paymentScore = 10 // no history = new user
      if (payment) {
        if (payment.status === 'completed') paymentScore = 20
        else if (payment.status === 'pending') paymentScore = 10
        else if (payment.status === 'failed') paymentScore = 0
      }

      const calls30d = callMap.get(c.id) || 0
      const secretaryScore = calls30d >= 5 ? 10 : calls30d >= 1 ? 5 : 0

      const score = loginScore + reportScore + paymentScore + secretaryScore

      return {
        id: c.id,
        name: c.name,
        email: c.email,
        company_name: c.company_name,
        tier_name: c.tier_name || 'Free',
        last_login: c.last_login,
        days_since_login: daysSinceLogin,
        reports_30d: reports30d,
        last_payment_status: payment?.status || null,
        secretary_calls_30d: calls30d,
        score,
        at_risk: score < 30
      }
    })

    const at_risk_count = customers.filter((c: any) => c.at_risk).length

    return c.json({ customers, at_risk_count, total: customers.length })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── LIVE VISITORS ─────────────────────────────────────────────
superAdminBi.get('/live-visitors', async (c) => {
  try {
    const db = c.env.DB
    const [activeRow, eventsRow] = await db.batch([
      db.prepare(`SELECT COUNT(DISTINCT session_id) as active_sessions, COUNT(DISTINCT visitor_id) as active_visitors FROM site_analytics WHERE created_at >= datetime('now','-5 minutes') AND page_url NOT LIKE '/admin%' AND page_url NOT LIKE '/super-admin%'`),
      db.prepare(`SELECT id, event_type, page_url, page_title, country, city, device_type, referrer, created_at FROM site_analytics WHERE page_url NOT LIKE '/admin%' AND page_url NOT LIKE '/super-admin%' ORDER BY created_at DESC LIMIT 20`)
    ]) as any[]

    return c.json({
      active_sessions: (activeRow.results?.[0]?.active_sessions as number) || 0,
      active_visitors: (activeRow.results?.[0]?.active_visitors as number) || 0,
      recent_events: (eventsRow.results || []) as any[]
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── REVENUE WATERFALL ─────────────────────────────────────────
superAdminBi.get('/revenue-waterfall', async (c) => {
  try {
    const db = c.env.DB
    const [tiersRow, totalsRow] = await db.batch([
      db.prepare(`SELECT service_tier, COUNT(*) as total_orders, COUNT(CASE WHEN payment_status='paid' THEN 1 END) as paid_orders, COALESCE(SUM(CASE WHEN payment_status='paid' THEN price ELSE 0 END),0) as paid_revenue, COUNT(CASE WHEN is_trial=1 THEN 1 END) as trial_orders, COUNT(CASE WHEN payment_status='unpaid' OR payment_status='pending' THEN 1 END) as unpaid_orders FROM orders WHERE created_at >= datetime('now','-30 days') GROUP BY service_tier ORDER BY paid_revenue DESC`),
      db.prepare(`SELECT COUNT(*) as total_orders, COUNT(CASE WHEN payment_status='paid' THEN 1 END) as paid_orders, COALESCE(SUM(CASE WHEN payment_status='paid' THEN price ELSE 0 END),0) as paid_revenue, COUNT(CASE WHEN is_trial=1 THEN 1 END) as trial_orders FROM orders WHERE created_at >= datetime('now','-30 days')`)
    ]) as any[]

    const tiers = (tiersRow.results || []) as any[]
    const totals = (totalsRow.results?.[0] || {}) as any
    const maxRevenue = Math.max(...tiers.map((t: any) => t.paid_revenue || 0), 1)

    return c.json({
      tiers: tiers.map((t: any) => ({
        ...t,
        conversion_rate: t.total_orders > 0 ? Math.round((t.paid_orders / t.total_orders) * 100) : 0,
        bar_pct: Math.round(((t.paid_revenue || 0) / maxRevenue) * 100)
      })),
      totals: {
        total_orders: totals.total_orders || 0,
        paid_orders: totals.paid_orders || 0,
        paid_revenue: totals.paid_revenue || 0,
        trial_orders: totals.trial_orders || 0,
        conversion_rate: totals.total_orders > 0 ? Math.round((totals.paid_orders / totals.total_orders) * 100) : 0
      }
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── ANOMALY ALERTS ────────────────────────────────────────────
superAdminBi.get('/anomalies', async (c) => {
  try {
    const db = c.env.DB
    const [
      thisWeekRow, lastWeekRow,
      recentRequestsRow,
      recentSignupsRow,
      thisWeekVisitorsRow, lastWeekVisitorsRow
    ] = await db.batch([
      db.prepare(`SELECT COALESCE(SUM(amount),0) as rev FROM square_payments WHERE status='completed' AND created_at >= datetime('now','-7 days')`),
      db.prepare(`SELECT COALESCE(SUM(amount),0) as rev FROM square_payments WHERE status='completed' AND created_at >= datetime('now','-14 days') AND created_at < datetime('now','-7 days')`),
      db.prepare(`SELECT COUNT(*) as total, COUNT(CASE WHEN status_code >= 500 THEN 1 END) as errors FROM api_request_log WHERE created_at >= (unixepoch() - 3600)`),
      db.prepare(`SELECT COUNT(*) as c FROM customers WHERE created_at >= datetime('now','-3 days')`),
      db.prepare(`SELECT COUNT(DISTINCT visitor_id) as visitors FROM site_analytics WHERE event_type='pageview' AND created_at >= datetime('now','-7 days') AND page_url NOT LIKE '/admin%'`),
      db.prepare(`SELECT COUNT(DISTINCT visitor_id) as visitors FROM site_analytics WHERE event_type='pageview' AND created_at >= datetime('now','-14 days') AND created_at < datetime('now','-7 days') AND page_url NOT LIKE '/admin%'`)
    ]) as any[]

    const anomalies: Array<{ type: string; severity: string; message: string }> = []

    // Revenue drop alert
    const thisRev = (thisWeekRow.results?.[0]?.rev as number) || 0
    const lastRev = (lastWeekRow.results?.[0]?.rev as number) || 0
    if (lastRev > 50 && thisRev < lastRev * 0.7) {
      anomalies.push({
        type: 'revenue_drop',
        severity: 'high',
        message: `Revenue down ${Math.round(((lastRev - thisRev) / lastRev) * 100)}% vs last week ($${thisRev.toFixed(0)} vs $${lastRev.toFixed(0)})`
      })
    }

    // API error spike
    const totalReqs = (recentRequestsRow.results?.[0]?.total as number) || 0
    const errorReqs = (recentRequestsRow.results?.[0]?.errors as number) || 0
    if (totalReqs > 20 && errorReqs / totalReqs > 0.05) {
      anomalies.push({
        type: 'error_spike',
        severity: 'critical',
        message: `API error rate ${((errorReqs / totalReqs) * 100).toFixed(1)}% in last hour (${errorReqs}/${totalReqs} requests failing)`
      })
    }

    // No new signups
    const recentSignups = (recentSignupsRow.results?.[0]?.c as number) || 0
    if (recentSignups === 0) {
      anomalies.push({
        type: 'no_signups',
        severity: 'medium',
        message: 'No new customer signups in the last 3 days'
      })
    }

    // Traffic drop
    const thisVisitors = (thisWeekVisitorsRow.results?.[0]?.visitors as number) || 0
    const lastVisitors = (lastWeekVisitorsRow.results?.[0]?.visitors as number) || 0
    if (lastVisitors > 20 && thisVisitors < lastVisitors * 0.6) {
      anomalies.push({
        type: 'traffic_drop',
        severity: 'medium',
        message: `Site traffic down ${Math.round(((lastVisitors - thisVisitors) / lastVisitors) * 100)}% vs last week (${thisVisitors} vs ${lastVisitors} unique visitors)`
      })
    }

    return c.json({ anomalies })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── API PERFORMANCE ───────────────────────────────────────────
superAdminBi.get('/api-performance', async (c) => {
  const days = parseInt(c.req.query('days') || '7')
  const clampedDays = Math.min(Math.max(days, 1), 90)

  try {
    const db = c.env.DB
    const statsRow = await db.prepare(`
      SELECT
        path,
        COUNT(*) as total_requests,
        ROUND(AVG(duration_ms),0) as avg_ms,
        MIN(duration_ms) as min_ms,
        MAX(duration_ms) as max_ms,
        COUNT(CASE WHEN status_code >= 500 THEN 1 END) as error_5xx,
        COUNT(CASE WHEN status_code >= 400 AND status_code < 500 THEN 1 END) as error_4xx
      FROM api_request_log
      WHERE created_at >= (unixepoch() - ? * 86400)
        AND duration_ms IS NOT NULL
      GROUP BY path
      HAVING total_requests >= 3
      ORDER BY avg_ms DESC
      LIMIT 50
    `).bind(clampedDays).all()

    const routes = ((statsRow.results || []) as any[]).map(r => ({
      ...r,
      error_rate_pct: r.total_requests > 0 ? Math.round(((r.error_5xx + r.error_4xx) / r.total_requests) * 100) : 0
    }))

    return c.json({ days: clampedDays, routes })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

export { superAdminBi }
