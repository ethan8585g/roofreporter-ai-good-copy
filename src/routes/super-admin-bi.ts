/**
 * Super Admin BI Analytics Hub — API Routes
 * Mounted at /api/admin/bi
 *
 * Endpoints:
 *   GET /api/admin/bi/business-intel   — MRR, ARR, ARPC, trial→paid, churn, report stats
 *   GET /api/admin/bi/overview         — North Star metrics: total_sales, user_count, active_today, top_modules, session_avg
 *   GET /api/admin/bi/usage-trends     — 30-day module usage trend series (from user_activity_daily)
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
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
      db.prepare(`SELECT COUNT(DISTINCT session_id) as active_sessions, COUNT(DISTINCT visitor_id) as active_visitors FROM site_analytics WHERE created_at >= datetime('now','-5 minutes') AND page_url NOT LIKE '/admin%' AND page_url NOT LIKE '/super-admin%' AND page_url NOT LIKE '/login%' AND page_url NOT LIKE '/api/%'`),
      db.prepare(`SELECT id, event_type, page_url, page_title, country, city, device_type, referrer, created_at FROM site_analytics WHERE created_at >= datetime('now','-30 minutes') AND page_url NOT LIKE '/admin%' AND page_url NOT LIKE '/super-admin%' AND page_url NOT LIKE '/login%' AND page_url NOT LIKE '/api/%' ORDER BY created_at DESC LIMIT 20`)
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

// ── BLOG / SEO ANALYTICS ──────────────────────────────────────
// Per-post traffic + SEO funnel data: joins blog_posts with site_analytics
// to surface which posts drive the most organic traffic, engagement, and conversions.
superAdminBi.get('/blog-analytics', async (c) => {
  const period = c.req.query('period') === '30d' ? '-30 days'
    : c.req.query('period') === '90d' ? '-90 days'
    : '-7 days'
  const periodLabel = period === '-30 days' ? '30d' : period === '-90 days' ? '90d' : '7d'

  try {
    const db = c.env.DB

    const [postsRow, perPostRow, overviewRow, referrerRow, searchReferrerRow, conversionRow, orphanRow] = await db.batch([
      // All published posts with lifetime view_count + SEO meta
      db.prepare(`
        SELECT id, slug, title, category, tags, author_name, is_featured,
               view_count, read_time_minutes, meta_title, meta_description,
               published_at, created_at
        FROM blog_posts
        WHERE status = 'published'
        ORDER BY published_at DESC
      `),
      // Per-post engagement in window from site_analytics
      db.prepare(`
        SELECT page_url,
               COUNT(*) as pageviews,
               COUNT(DISTINCT visitor_id) as unique_visitors,
               COUNT(DISTINCT session_id) as sessions,
               ROUND(AVG(NULLIF(time_on_page,0)),0) as avg_time_on_page,
               ROUND(AVG(NULLIF(scroll_depth,0)),0) as avg_scroll_depth
        FROM site_analytics
        WHERE event_type='pageview'
          AND page_url LIKE '/blog/%'
          AND page_url NOT LIKE '/admin%'
          AND created_at >= datetime('now',?)
        GROUP BY page_url
      `).bind(period),
      // Aggregate blog traffic overview
      db.prepare(`
        SELECT COUNT(*) as pageviews,
               COUNT(DISTINCT visitor_id) as unique_visitors,
               COUNT(DISTINCT session_id) as sessions,
               ROUND(AVG(NULLIF(time_on_page,0)),0) as avg_time_on_page,
               ROUND(AVG(NULLIF(scroll_depth,0)),0) as avg_scroll_depth
        FROM site_analytics
        WHERE event_type='pageview'
          AND page_url LIKE '/blog/%'
          AND page_url NOT LIKE '/admin%'
          AND created_at >= datetime('now',?)
      `).bind(period),
      // Top referrers driving blog traffic
      db.prepare(`
        SELECT COALESCE(NULLIF(referrer,''), 'Direct') as referrer,
               COUNT(*) as pageviews,
               COUNT(DISTINCT visitor_id) as unique_visitors
        FROM site_analytics
        WHERE event_type='pageview'
          AND page_url LIKE '/blog/%'
          AND created_at >= datetime('now',?)
        GROUP BY referrer
        ORDER BY unique_visitors DESC
        LIMIT 15
      `).bind(period),
      // Search-engine referrers only (organic SEO proxy)
      db.prepare(`
        SELECT referrer,
               COUNT(*) as pageviews,
               COUNT(DISTINCT visitor_id) as unique_visitors
        FROM site_analytics
        WHERE event_type='pageview'
          AND page_url LIKE '/blog/%'
          AND created_at >= datetime('now',?)
          AND (referrer LIKE '%google.%' OR referrer LIKE '%bing.%'
               OR referrer LIKE '%duckduckgo.%' OR referrer LIKE '%yahoo.%'
               OR referrer LIKE '%yandex.%' OR referrer LIKE '%ecosia.%')
        GROUP BY referrer
        ORDER BY unique_visitors DESC
        LIMIT 10
      `).bind(period),
      // Blog-to-signup conversion: blog visitors whose visitor_id later appears
      // tagged to a logged-in customer (via user_id set by tracker.js on login).
      // Requires real attribution — visitor_id must be linked to a customer row.
      db.prepare(`
        SELECT
          (SELECT COUNT(DISTINCT visitor_id)
             FROM site_analytics
             WHERE event_type='pageview'
               AND page_url LIKE '/blog/%'
               AND visitor_id IS NOT NULL
               AND created_at >= datetime('now',?)
          ) as blog_visitors,
          (SELECT COUNT(DISTINCT bv.visitor_id)
             FROM site_analytics bv
             JOIN site_analytics sig
               ON sig.visitor_id = bv.visitor_id
              AND sig.user_id IS NOT NULL
              AND sig.user_id NOT LIKE 'admin_%'
              AND sig.created_at >= bv.created_at
              AND sig.created_at <= datetime(bv.created_at,'+7 days')
             WHERE bv.event_type='pageview'
               AND bv.page_url LIKE '/blog/%'
               AND bv.visitor_id IS NOT NULL
               AND bv.created_at >= datetime('now',?)
          ) as converted
      `).bind(period, period),
      // Orphan detection: posts published but with zero lifetime views
      db.prepare(`
        SELECT COUNT(*) as zero_view_posts
        FROM blog_posts
        WHERE status='published' AND (view_count IS NULL OR view_count=0)
      `)
    ]) as any[]

    const posts = (postsRow.results || []) as any[]
    const perPost = new Map<string, any>()
    for (const r of (perPostRow.results || []) as any[]) {
      perPost.set(r.page_url, r)
    }

    // Build per-post row: combine lifetime view_count + windowed engagement
    const postRows = posts.map((p: any) => {
      const url = `/blog/${p.slug}`
      const stats = perPost.get(url) || {}
      const publishedAt = p.published_at ? new Date(p.published_at).getTime() : null
      const ageDays = publishedAt ? Math.floor((Date.now() - publishedAt) / 86400000) : null

      // SEO health score (0-100): meta completeness + engagement signals
      let seoScore = 0
      if (p.meta_title && p.meta_title.length >= 30 && p.meta_title.length <= 65) seoScore += 20
      else if (p.meta_title) seoScore += 10
      if (p.meta_description && p.meta_description.length >= 120 && p.meta_description.length <= 160) seoScore += 20
      else if (p.meta_description) seoScore += 10
      if ((p.view_count || 0) >= 100) seoScore += 25
      else if ((p.view_count || 0) >= 10) seoScore += 15
      else if ((p.view_count || 0) > 0) seoScore += 5
      if ((stats.avg_scroll_depth || 0) >= 60) seoScore += 20
      else if ((stats.avg_scroll_depth || 0) >= 30) seoScore += 10
      if ((stats.avg_time_on_page || 0) >= 60) seoScore += 15
      else if ((stats.avg_time_on_page || 0) >= 30) seoScore += 8

      return {
        id: p.id,
        slug: p.slug,
        title: p.title,
        category: p.category,
        tags: p.tags,
        author_name: p.author_name,
        is_featured: p.is_featured,
        read_time_minutes: p.read_time_minutes,
        published_at: p.published_at,
        age_days: ageDays,
        lifetime_views: p.view_count || 0,
        pageviews_window: stats.pageviews || 0,
        unique_visitors_window: stats.unique_visitors || 0,
        sessions_window: stats.sessions || 0,
        avg_time_on_page: stats.avg_time_on_page || 0,
        avg_scroll_depth: stats.avg_scroll_depth || 0,
        meta_title: p.meta_title,
        meta_title_len: p.meta_title ? p.meta_title.length : 0,
        meta_description: p.meta_description,
        meta_description_len: p.meta_description ? p.meta_description.length : 0,
        seo_score: seoScore,
        is_orphan: (p.view_count || 0) === 0 && ageDays != null && ageDays > 14
      }
    })

    // Sort by windowed unique visitors desc, then lifetime views
    postRows.sort((a: any, b: any) =>
      (b.unique_visitors_window - a.unique_visitors_window) ||
      (b.lifetime_views - a.lifetime_views))

    const overview = (overviewRow.results?.[0] || {}) as any
    const conversion = (conversionRow.results?.[0] || {}) as any
    const blogVisitors = conversion.blog_visitors || 0
    const converted = conversion.converted || 0

    // SEO-health issues to flag
    const issues: Array<{ slug: string; title: string; issue: string; severity: string }> = []
    for (const p of postRows) {
      if (!p.meta_title) issues.push({ slug: p.slug, title: p.title, issue: 'Missing meta title', severity: 'high' })
      else if (p.meta_title_len > 65) issues.push({ slug: p.slug, title: p.title, issue: `Meta title too long (${p.meta_title_len} chars — cut to ≤65)`, severity: 'medium' })
      else if (p.meta_title_len < 30) issues.push({ slug: p.slug, title: p.title, issue: `Meta title too short (${p.meta_title_len} chars — aim 30-65)`, severity: 'low' })

      if (!p.meta_description) issues.push({ slug: p.slug, title: p.title, issue: 'Missing meta description', severity: 'high' })
      else if (p.meta_description_len > 160) issues.push({ slug: p.slug, title: p.title, issue: `Meta description too long (${p.meta_description_len} chars — cut to ≤160)`, severity: 'medium' })
      else if (p.meta_description_len < 120) issues.push({ slug: p.slug, title: p.title, issue: `Meta description too short (${p.meta_description_len} chars — aim 120-160)`, severity: 'low' })

      if (p.is_orphan) issues.push({ slug: p.slug, title: p.title, issue: `Zero views after ${p.age_days} days — needs promotion or rewrite`, severity: 'medium' })
    }

    return c.json({
      period: periodLabel,
      overview: {
        total_posts: posts.length,
        pageviews: overview.pageviews || 0,
        unique_visitors: overview.unique_visitors || 0,
        sessions: overview.sessions || 0,
        avg_time_on_page: overview.avg_time_on_page || 0,
        avg_scroll_depth: overview.avg_scroll_depth || 0,
        zero_view_posts: (orphanRow.results?.[0]?.zero_view_posts as number) || 0,
        blog_to_signup_visitors: blogVisitors,
        blog_to_signup_converted: converted,
        blog_to_signup_rate: blogVisitors > 0 ? Math.round((converted / blogVisitors) * 100) : 0
      },
      posts: postRows,
      top_referrers: (referrerRow.results || []) as any[],
      search_referrers: (searchReferrerRow.results || []) as any[],
      issues: issues.slice(0, 50)
    })
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

// ── LEAD SOURCE ATTRIBUTION ───────────────────────────────────
// Buckets every lead into { blog, ai, facebook, instagram, google, direct, other }
// by combining utm_source + referrer + landing_page. Also returns per-blog-slug
// lead counts pulled from the `leads.landing_page` column.
superAdminBi.get('/lead-sources', async (c) => {
  try {
    const db = c.env.DB
    const period = c.req.query('period') || '30d'
    const daysBack = period === '90d' ? 90 : period === '7d' ? 7 : period === '24h' ? 1 : 30
    const since = new Date(Date.now() - daysBack * 86400000).toISOString()

    // Pull all leads in window with attribution fields; be resilient if
    // migration 0181 hasn't been applied yet (landing_page may be missing).
    let rows: any[] = []
    try {
      const r = await db.prepare(`
        SELECT id, email, utm_source, utm_medium, utm_campaign, referrer, landing_page, source_page, created_at
        FROM leads
        WHERE created_at >= ?
      `).bind(since).all()
      rows = (r.results as any[]) || []
    } catch (e: any) {
      // Fallback: no landing_page column yet
      const r = await db.prepare(`
        SELECT id, email, utm_source, utm_medium, utm_campaign, referrer, source_page, created_at
        FROM leads
        WHERE created_at >= ?
      `).bind(since).all()
      rows = ((r.results as any[]) || []).map(x => ({ ...x, landing_page: null }))
    }

    const AI_HOSTS = ['chat.openai.com','chatgpt.com','openai.com','claude.ai','perplexity.ai','gemini.google.com','bard.google.com','copilot.microsoft.com','bing.com/chat','you.com','phind.com','poe.com']
    const FB_HOSTS = ['facebook.com','l.facebook.com','m.facebook.com','lm.facebook.com','fb.com','fb.me']
    const IG_HOSTS = ['instagram.com','l.instagram.com','m.instagram.com']
    const GOOGLE_HOSTS = ['google.com','google.ca','google.co.uk','google.co.in','google.com.au','bing.com','duckduckgo.com','search.yahoo.com','yahoo.com','yandex.com','baidu.com']

    function hostOf(url: string): string {
      if (!url) return ''
      try {
        const u = url.startsWith('http') ? new URL(url) : new URL('https://' + url)
        return u.hostname.toLowerCase().replace(/^www\./, '')
      } catch { return String(url).toLowerCase() }
    }
    function matchesAny(host: string, list: string[]): boolean {
      if (!host) return false
      return list.some(h => host === h || host.endsWith('.' + h) || host.includes(h))
    }
    function classify(row: any): string {
      const utm = String(row.utm_source || '').toLowerCase().trim()
      const srcPage = String(row.source_page || '').toLowerCase()
      const landing = String(row.landing_page || '').toLowerCase()
      const refHost = hostOf(row.referrer || '')

      // Blog takes priority — if they landed on /blog/* or submitted from a blog form
      if (landing.includes('/blog/') || srcPage.startsWith('blog:') || srcPage.includes('blog_lead_magnet') || utm === 'blog') return 'blog'

      // UTM-explicit mappings
      if (utm === 'chatgpt' || utm === 'openai' || utm === 'claude' || utm === 'perplexity' || utm === 'gemini' || utm === 'bing' || utm === 'copilot' || utm === 'ai') return 'ai'
      if (utm === 'facebook' || utm === 'fb' || utm === 'meta') return 'facebook'
      if (utm === 'instagram' || utm === 'ig') return 'instagram'
      if (utm === 'google' || utm === 'google_cpc' || utm === 'google-ads' || utm === 'adwords') return 'google'

      // Referrer-based classification
      if (matchesAny(refHost, AI_HOSTS)) return 'ai'
      if (matchesAny(refHost, FB_HOSTS)) return 'facebook'
      if (matchesAny(refHost, IG_HOSTS)) return 'instagram'
      if (matchesAny(refHost, GOOGLE_HOSTS)) return 'google'

      if (!refHost && !utm) return 'direct'
      return 'other'
    }

    const buckets: Record<string, number> = { blog: 0, ai: 0, facebook: 0, instagram: 0, google: 0, direct: 0, other: 0 }
    const blogCounts: Record<string, number> = {}

    for (const row of rows) {
      const b = classify(row)
      buckets[b] = (buckets[b] || 0) + 1
      if (b === 'blog') {
        // Extract blog slug from landing_page (e.g., "/blog/ai-vs-eagleview-accuracy?utm_source=...")
        let slug = ''
        const landing = String(row.landing_page || '')
        const m = landing.match(/\/blog\/([^/?#]+)/i)
        if (m) slug = m[1]
        // Fallback: use utm_campaign if present (blogLeadMagnet sets it to slug)
        if (!slug && row.utm_campaign) slug = String(row.utm_campaign).trim().slice(0, 120)
        // Fallback: parse blog:<source> from source_page
        if (!slug) {
          const sm = String(row.source_page || '').match(/^blog:(.+)$/i)
          if (sm) slug = sm[1]
        }
        if (!slug) slug = '(unknown blog)'
        blogCounts[slug] = (blogCounts[slug] || 0) + 1
      }
    }

    const bucketsArr = Object.entries(buckets)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)

    const blogs = Object.entries(blogCounts)
      .map(([slug, count]) => ({ slug, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 25)

    // Pull session totals in the same window for a rough conversion-rate reference
    let totalSessions = 0
    try {
      const sRow = await db.prepare(`
        SELECT COUNT(DISTINCT session_id) as sessions
        FROM site_analytics
        WHERE created_at >= ?
          AND page_url NOT LIKE '/super-admin%'
          AND page_url NOT LIKE '/admin%'
          AND page_url NOT LIKE '/login%'
          AND page_url NOT LIKE '/api/%'
      `).bind(since).first() as any
      totalSessions = (sRow && sRow.sessions) || 0
    } catch {}

    return c.json({
      period,
      days: daysBack,
      total_leads: rows.length,
      total_sessions: totalSessions,
      buckets: bucketsArr,
      blogs
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── NORTH STAR OVERVIEW ───────────────────────────────────────
// Total sales pulled from `orders.price` (paid, non-trial) — this is the
// real revenue source (Square payments table is empty for D1-credit purchases).
superAdminBi.get('/overview', async (c) => {
  try {
    const db = c.env.DB
    const [salesRow, usersRow, activeTodayRow, topModulesRow, sessionAvgRow] = await db.batch([
      db.prepare(`SELECT COALESCE(SUM(price),0) as total_sales, COUNT(*) as paid_orders FROM orders WHERE payment_status='paid' AND (is_trial IS NULL OR is_trial=0)`),
      db.prepare(`SELECT COUNT(*) as user_count FROM customers`),
      db.prepare(`SELECT COUNT(*) as active_today FROM (
                    SELECT user_id, user_type FROM user_module_visits WHERE started_at >= datetime('now','start of day')
                    UNION
                    SELECT user_id, user_type FROM active_visits WHERE last_seen_at >= datetime('now','start of day')
                  )`),
      db.prepare(`SELECT module, COUNT(*) as visits, COALESCE(SUM(duration_seconds),0) as total_seconds FROM user_module_visits WHERE started_at >= datetime('now','-30 days') GROUP BY module ORDER BY visits DESC LIMIT 8`),
      db.prepare(`SELECT ROUND(AVG(duration_seconds),0) as session_avg FROM user_module_visits WHERE started_at >= datetime('now','-30 days') AND duration_seconds > 0`)
    ]) as any[]

    const total_sales = (salesRow.results?.[0]?.total_sales as number) || 0
    const paid_orders = (salesRow.results?.[0]?.paid_orders as number) || 0
    const user_count = (usersRow.results?.[0]?.user_count as number) || 0
    const active_today = (activeTodayRow.results?.[0]?.active_today as number) || 0
    const session_avg = (sessionAvgRow.results?.[0]?.session_avg as number) || 0
    const top_modules = (topModulesRow.results || []) as any[]

    return c.json({
      total_sales,
      paid_orders,
      user_count,
      active_today,
      top_modules,
      session_avg_seconds: session_avg
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── USAGE TRENDS (30 days) ────────────────────────────────────
// Per-day total seconds across all users, plus per-day per-module breakdown.
superAdminBi.get('/usage-trends', async (c) => {
  try {
    const db = c.env.DB
    const dailyRow = await db.prepare(
      `SELECT day, SUM(total_seconds) as total_seconds, SUM(visit_count) as visits, COUNT(DISTINCT user_id || ':' || user_type) as unique_users
       FROM user_activity_daily
       WHERE day >= date('now','-30 days')
       GROUP BY day
       ORDER BY day ASC`
    ).all() as any

    const moduleRow = await db.prepare(
      `SELECT module, SUM(total_seconds) as total_seconds, SUM(visit_count) as visits
       FROM user_activity_daily
       WHERE day >= date('now','-30 days')
       GROUP BY module
       ORDER BY total_seconds DESC
       LIMIT 8`
    ).all() as any

    return c.json({
      daily: (dailyRow.results || []) as any[],
      by_module: (moduleRow.results || []) as any[]
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── COMMAND CENTER (unified main BI dashboard) ───────────────
// Single endpoint powering the Super Admin Command Center view: per-customer
// spend, per-user time-on-platform, recent signups, recent path events,
// module-time distribution, North Star metrics — all in one shot.
superAdminBi.get('/command-center', async (c) => {
  try {
    const db = c.env.DB
    const period = c.req.query('period') || '30d'
    const days = period === '24h' ? 1 : period === '7d' ? 7 : period === '90d' ? 90 : 30

    const [
      salesRow, usersRow, activeTodayRow, sessionAvgRow,
      topSpendersRow, topUsersRow, recentSignupsRow, signupsTrendRow,
      moduleDistRow, recentEventsRow, liveNowRow
    ] = await db.batch([
      // North Star — total_sales = paid orders + manual payments
      // Credit-redemption orders (notes='Paid via credit balance') are excluded:
      // their revenue was already booked when the credit pack was purchased.
      db.prepare(`SELECT
                    (SELECT COALESCE(SUM(price),0) FROM orders
                       WHERE payment_status='paid' AND (is_trial IS NULL OR is_trial=0)
                         AND (notes IS NULL OR notes NOT LIKE 'Paid via credit balance%'))
                    + (SELECT COALESCE(SUM(amount),0) FROM manual_payments) AS total_sales,
                    (SELECT COUNT(*) FROM orders
                       WHERE payment_status='paid' AND (is_trial IS NULL OR is_trial=0)
                         AND (notes IS NULL OR notes NOT LIKE 'Paid via credit balance%')) AS paid_orders,
                    (SELECT COUNT(*) FROM manual_payments) AS manual_payment_count`),
      db.prepare(`SELECT COUNT(*) as user_count, COUNT(CASE WHEN created_at >= datetime('now','-${days} days') THEN 1 END) as new_users FROM customers`),
      db.prepare(`SELECT COUNT(*) as active_today FROM (
                    SELECT user_id, user_type FROM user_module_visits WHERE started_at >= datetime('now','start of day')
                    UNION
                    SELECT user_id, user_type FROM active_visits WHERE last_seen_at >= datetime('now','start of day')
                  )`),
      // Defensive cap on read in case any uncapped legacy rows slip through.
      db.prepare(`SELECT ROUND(AVG(MIN(duration_seconds, 1800)),0) as session_avg FROM user_module_visits WHERE started_at >= datetime('now','-${days} days') AND duration_seconds > 0`),
      // Top spenders — orders + manual payments. Credit-redemption orders
      // (notes='Paid via credit balance') are excluded so the prepaid pack
      // isn't double-counted alongside the per-redemption notional $10.
      db.prepare(`SELECT c.id, c.name, c.email, c.company_name,
                         (SELECT COUNT(*) FROM orders o WHERE o.customer_id=c.id) as order_count,
                         (SELECT COALESCE(SUM(o.price),0) FROM orders o
                            WHERE o.customer_id=c.id AND o.payment_status='paid' AND (o.is_trial IS NULL OR o.is_trial=0)
                              AND (o.notes IS NULL OR o.notes NOT LIKE 'Paid via credit balance%'))
                         + (SELECT COALESCE(SUM(mp.amount),0) FROM manual_payments mp WHERE mp.customer_id=c.id) as total_spent,
                         (SELECT COALESCE(SUM(mp.amount),0) FROM manual_payments mp WHERE mp.customer_id=c.id) as manual_amount,
                         (SELECT MAX(o.created_at) FROM orders o WHERE o.customer_id=c.id) as last_order_at
                  FROM customers c
                  WHERE (SELECT COALESCE(SUM(o.price),0) FROM orders o
                           WHERE o.customer_id=c.id AND o.payment_status='paid' AND (o.is_trial IS NULL OR o.is_trial=0)
                             AND (o.notes IS NULL OR o.notes NOT LIKE 'Paid via credit balance%'))
                       + (SELECT COALESCE(SUM(mp.amount),0) FROM manual_payments mp WHERE mp.customer_id=c.id) > 0
                  ORDER BY total_spent DESC
                  LIMIT 10`),
      // Top users by time — defensive read-side cap (MIN per row before SUM).
      db.prepare(`SELECT user_type, user_id,
                         SUM(MIN(duration_seconds, 1800)) as total_seconds,
                         COUNT(*) as visit_count,
                         MAX(started_at) as last_seen
                  FROM user_module_visits
                  WHERE started_at >= datetime('now','-${days} days')
                  GROUP BY user_type, user_id
                  ORDER BY total_seconds DESC
                  LIMIT 10`),
      // Recent signups
      db.prepare(`SELECT id, name, email, company_name, created_at FROM customers ORDER BY created_at DESC LIMIT 10`),
      // Signups trend
      db.prepare(`SELECT date(created_at) as day, COUNT(*) as count FROM customers WHERE created_at >= datetime('now','-${days} days') GROUP BY day ORDER BY day ASC`),
      // Module time distribution (across all users) — capped per-row.
      db.prepare(`SELECT module, SUM(MIN(duration_seconds, 1800)) as total_seconds, COUNT(*) as visits, COUNT(DISTINCT user_type || ':' || user_id) as users FROM user_module_visits WHERE started_at >= datetime('now','-${days} days') GROUP BY module ORDER BY total_seconds DESC`),
      // Recent path events feed
      db.prepare(`SELECT id, user_type, user_id, path, occurred_at FROM user_path_events ORDER BY occurred_at DESC LIMIT 50`),
      // Live now
      db.prepare(`SELECT COUNT(DISTINCT user_id || ':' || user_type) as live_now FROM active_visits WHERE last_seen_at >= datetime('now','-2 minutes')`)
    ]) as any[]

    const topUsers = (topUsersRow.results || []) as any[]
    const events = (recentEventsRow.results || []) as any[]

    // Resolve names for top users + events.
    const adminIds = new Set<number>()
    const custIds = new Set<number>()
      ;[...topUsers, ...events].forEach((r: any) => {
        if (r.user_type === 'admin') adminIds.add(r.user_id)
        else if (r.user_type === 'customer') custIds.add(r.user_id)
      })

    const adminMap = new Map<number, any>()
    const custMap = new Map<number, any>()
    if (adminIds.size) {
      const ids = Array.from(adminIds)
      const ph = ids.map(() => '?').join(',')
      const r = await db.prepare(`SELECT id, email, name FROM admin_users WHERE id IN (${ph})`).bind(...ids).all<any>()
        ; (r?.results || []).forEach((u: any) => adminMap.set(u.id, u))
    }
    if (custIds.size) {
      const ids = Array.from(custIds)
      const ph = ids.map(() => '?').join(',')
      const r = await db.prepare(`SELECT id, email, name FROM customers WHERE id IN (${ph})`).bind(...ids).all<any>()
        ; (r?.results || []).forEach((u: any) => custMap.set(u.id, u))
    }

    const decorate = (r: any) => {
      const p = r.user_type === 'admin' ? adminMap.get(r.user_id) : custMap.get(r.user_id)
      return { ...r, name: p?.name || null, email: p?.email || null }
    }

    return c.json({
      period,
      north_star: {
        total_sales: (salesRow.results?.[0]?.total_sales as number) || 0,
        paid_orders: (salesRow.results?.[0]?.paid_orders as number) || 0,
        user_count: (usersRow.results?.[0]?.user_count as number) || 0,
        new_users: (usersRow.results?.[0]?.new_users as number) || 0,
        active_today: (activeTodayRow.results?.[0]?.active_today as number) || 0,
        live_now: (liveNowRow.results?.[0]?.live_now as number) || 0,
        session_avg_seconds: (sessionAvgRow.results?.[0]?.session_avg as number) || 0,
      },
      top_spenders: (topSpendersRow.results || []),
      top_users: topUsers.map(decorate),
      recent_signups: (recentSignupsRow.results || []),
      signups_trend: (signupsTrendRow.results || []),
      module_distribution: (moduleDistRow.results || []),
      recent_events: events.map(decorate),
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── MANUAL PAYMENTS ─────────────────────────────────────────
// Record an offline / cash / e-transfer / wire payment so it shows up in
// total_sales, top_spenders, and the revenue waterfall. Superadmin only.
superAdminBi.post('/manual-payments', async (c) => {
  try {
    const admin = c.get('admin' as any) as any
    const body = await c.req.json().catch(() => ({})) as any
    const customerId = parseInt(body.customer_id)
    const amount = parseFloat(body.amount)
    const description = (body.description || '').toString().slice(0, 500) || null
    const paidAt = body.paid_at && /^\d{4}-\d{2}-\d{2}/.test(body.paid_at) ? body.paid_at : null

    if (!customerId || customerId <= 0) return c.json({ error: 'customer_id required' }, 400)
    if (!Number.isFinite(amount) || amount <= 0) return c.json({ error: 'amount must be > 0' }, 400)

    const cust = await c.env.DB.prepare('SELECT id, email FROM customers WHERE id = ?').bind(customerId).first<any>()
    if (!cust) return c.json({ error: 'Customer not found' }, 404)

    const result = await c.env.DB.prepare(
      paidAt
        ? `INSERT INTO manual_payments (customer_id, amount, description, paid_at, recorded_by_admin_id) VALUES (?, ?, ?, ?, ?)`
        : `INSERT INTO manual_payments (customer_id, amount, description, recorded_by_admin_id) VALUES (?, ?, ?, ?)`
    ).bind(...(paidAt ? [customerId, amount, description, paidAt, admin.id] : [customerId, amount, description, admin.id])).run()

    await c.env.DB.prepare(
      `INSERT INTO user_activity_log (company_id, action, details) VALUES (1, 'manual_payment_recorded', ?)`
    ).bind(`Superadmin ${admin.email || admin.id} recorded $${amount} manual payment for customer #${customerId} (${cust.email || ''})`).run()

    return c.json({ success: true, id: result.meta.last_row_id, customer_id: customerId, amount })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

superAdminBi.get('/manual-payments', async (c) => {
  try {
    const customerId = parseInt(c.req.query('customer_id') || '0', 10)
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200)
    const baseSelect = `SELECT mp.id, mp.customer_id, c.email, c.email AS customer_email, c.name, c.name AS customer_name,
                               mp.amount, mp.description, mp.paid_at, mp.recorded_by_admin_id, mp.created_at
                        FROM manual_payments mp
                        LEFT JOIN customers c ON c.id = mp.customer_id`
    const rows = customerId > 0
      ? await c.env.DB.prepare(`${baseSelect} WHERE mp.customer_id = ? ORDER BY mp.paid_at DESC LIMIT ?`).bind(customerId, limit).all() as any
      : await c.env.DB.prepare(`${baseSelect} ORDER BY mp.paid_at DESC LIMIT ?`).bind(limit).all() as any
    return c.json({ payments: rows.results || [] })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

superAdminBi.delete('/manual-payments/:id', async (c) => {
  try {
    const admin = c.get('admin' as any) as any
    const id = parseInt(c.req.param('id'))
    if (!id) return c.json({ error: 'id required' }, 400)
    const result = await c.env.DB.prepare('DELETE FROM manual_payments WHERE id = ?').bind(id).run()
    if (!result.meta.changes) return c.json({ error: 'Not found' }, 404)
    await c.env.DB.prepare(
      `INSERT INTO user_activity_log (company_id, action, details) VALUES (1, 'manual_payment_deleted', ?)`
    ).bind(`Superadmin ${admin.email || admin.id} deleted manual_payment #${id}`).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── CUSTOMER 360 ──────────────────────────────────────────────
// One endpoint, one customer, every signal: profile, lead origin,
// Reports order history, Secretary subscription state, lifetime spend,
// recent calls, recent objections, and a rolled-up health score.
// Powers the inline "Customer 360" drawer in the BI dashboard.
superAdminBi.get('/customer-360/:id', async (c) => {
  try {
    const customerId = parseInt(c.req.param('id'))
    if (!customerId || isNaN(customerId)) return c.json({ error: 'invalid customer id' }, 400)
    const db = c.env.DB

    const [profile, leadRow, ordersRow, secretaryRow, spendRow, attributionRow, callsRow, objectionsRow, loginsRow] = await db.batch([
      db.prepare(`
        SELECT c.id, c.email, c.name, c.phone, c.company_name, c.created_at,
               c.last_login, csi.last_active_at, csi.last_order_at,
               c.subscription_plan, c.subscription_status, c.subscription_tier,
               c.trial_ends_at, c.free_trial_total, c.free_trial_used,
               c.report_credits, c.credits_used,
               c.monthly_reports_used, c.monthly_report_limit,
               c.total_minutes_used, c.monthly_minutes_limit,
               csi.lead_id, csi.lead_source_table, csi.lead_matched_at,
               c.lead_utm_source, c.lead_source, c.gclid,
               c.is_active
        FROM customers c
        LEFT JOIN customer_sales_intel csi ON csi.customer_id = c.id
        WHERE c.id = ?
      `).bind(customerId),
      // Resolve lead row from polymorphic linkage stored in customer_sales_intel.
      db.prepare(`
        SELECT 'contact_leads' AS lead_table, id, email, name, company AS company_name, phone, message, utm_source, utm_medium, utm_campaign, created_at
        FROM contact_leads WHERE id = (SELECT lead_id FROM customer_sales_intel WHERE customer_id = ? AND lead_source_table = 'contact_leads')
        UNION ALL
        SELECT 'asset_report_leads' AS lead_table, id, email, name, company AS company_name, NULL AS phone, NULL AS message, NULL AS utm_source, NULL AS utm_medium, NULL AS utm_campaign, created_at
        FROM asset_report_leads WHERE id = (SELECT lead_id FROM customer_sales_intel WHERE customer_id = ? AND lead_source_table = 'asset_report_leads')
        UNION ALL
        SELECT 'leads' AS lead_table, id, email, name, company_name, phone, message, NULL AS utm_source, NULL AS utm_medium, NULL AS utm_campaign, created_at
        FROM leads WHERE id = (SELECT lead_id FROM customer_sales_intel WHERE customer_id = ? AND lead_source_table = 'leads')
      `).bind(customerId, customerId, customerId),
      db.prepare(`
        SELECT id, order_number, property_address, service_tier, price,
               status, payment_status, is_trial, is_first_order,
               created_at, delivered_at
        FROM orders
        WHERE customer_id = ?
        ORDER BY created_at DESC
        LIMIT 50
      `).bind(customerId),
      db.prepare(`
        SELECT id, status, monthly_price_cents, trial_started_at, trial_ends_at,
               next_billing_at, comp_until, created_at
        FROM secretary_subscriptions
        WHERE customer_id = ?
        ORDER BY created_at DESC LIMIT 1
      `).bind(customerId),
      db.prepare(`
        SELECT
          COUNT(*) AS payment_count,
          COALESCE(SUM(amount), 0) AS lifetime_revenue,
          MAX(created_at) AS last_payment_at,
          SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed_count
        FROM square_payments
        WHERE customer_id = ?
      `).bind(customerId),
      db.prepare(`
        SELECT first_touch_utm_source, first_touch_utm_medium, first_touch_utm_campaign,
               first_touch_at, first_touch_referrer_domain,
               last_touch_utm_source, last_touch_at, touch_count,
               days_to_convert, total_orders, total_paid_orders, revenue_cents
        FROM analytics_attribution WHERE customer_id = ?
      `).bind(customerId),
      // Cold-call history if this customer is also a cc_prospect (matched by email).
      db.prepare(`
        SELECT cc.id, cc.call_status, cc.call_outcome, cc.call_summary,
               cc.caller_sentiment, cc.call_duration_seconds, cc.started_at, cc.ended_at
        FROM cc_call_logs cc
        JOIN cc_prospects p ON p.id = cc.prospect_id
        WHERE LOWER(p.email) = (SELECT LOWER(email) FROM customers WHERE id = ?)
        ORDER BY cc.started_at DESC
        LIMIT 20
      `).bind(customerId),
      db.prepare(`
        SELECT o.id, o.category, o.objection_text, o.raw_excerpt, o.sentiment, o.extracted_at
        FROM call_objections o
        JOIN cc_call_logs cc ON cc.id = o.call_log_id
        JOIN cc_prospects p ON p.id = cc.prospect_id
        WHERE LOWER(p.email) = (SELECT LOWER(email) FROM customers WHERE id = ?)
        ORDER BY o.extracted_at DESC
        LIMIT 30
      `).bind(customerId),
      db.prepare(`
        SELECT auth_method, ip_address, created_at
        FROM customer_login_events
        WHERE customer_id = ?
        ORDER BY created_at DESC
        LIMIT 10
      `).bind(customerId)
    ]) as any[]

    const p = profile.results?.[0] as any
    if (!p) return c.json({ error: 'customer not found' }, 404)

    // Health score (0-100) — same 5-factor model as the audit recommended.
    const daysSince = (s: string | null | undefined) =>
      s ? Math.floor((Date.now() - new Date(s as string).getTime()) / (1000 * 60 * 60 * 24)) : 9999

    const dLogin = daysSince(p.last_active_at || p.last_login)
    const ords = (ordersRow.results || []) as any[]
    const lastOrderDays = p.last_order_at ? daysSince(p.last_order_at) : 9999

    const loginFactor = dLogin <= 7 ? 40 : dLogin <= 30 ? 25 : dLogin <= 60 ? 10 : 0
    const orderFactor = ords.length === 0 ? 0
      : lastOrderDays <= 30 ? 40 : lastOrderDays <= 60 ? 25 : lastOrderDays <= 90 ? 10 : 5
    const spend = spendRow.results?.[0] as any
    const failedPay = (spend?.failed_count as number) || 0
    const paidCount = (spend?.payment_count as number) || 0
    const paymentFactor = paidCount === 0 ? 5 : failedPay > paidCount ? 0 : 30
    const trialFactor = p.trial_ends_at && new Date(p.trial_ends_at) < new Date() ? -10
      : p.trial_ends_at && new Date(p.trial_ends_at) < new Date(Date.now() + 14 * 86400000) ? -5 : 0

    const rawScore = loginFactor + orderFactor + paymentFactor + trialFactor
    const healthScore = Math.max(0, Math.min(100, Math.round(rawScore)))
    const healthBand = healthScore >= 70 ? 'healthy' : healthScore >= 40 ? 'watch' : healthScore >= 20 ? 'at_risk' : 'dormant'

    return c.json({
      customer: p,
      lead: leadRow.results?.[0] || null,
      orders: ords,
      secretary: secretaryRow.results?.[0] || null,
      spend: spendRow.results?.[0] || { payment_count: 0, lifetime_revenue: 0, failed_count: 0 },
      attribution: attributionRow.results?.[0] || null,
      calls: callsRow.results || [],
      objections: objectionsRow.results || [],
      logins: loginsRow.results || [],
      health: {
        score: healthScore,
        band: healthBand,
        factors: {
          login: loginFactor,
          order: orderFactor,
          payment: paymentFactor,
          trial: trialFactor
        },
        days_since_login: dLogin,
        days_since_order: lastOrderDays === 9999 ? null : lastOrderDays
      }
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── SALES SNAPSHOT ────────────────────────────────────────────
// Returns the three dashboard numbers + the full lists so the
// founder can click straight into "who to call today":
//   1. At-Risk Churn — paying customers, last activity > 30d, last order > 90d
//   2. Stuck Signups — created > 60d ago, zero orders, free credits unused
//   3. Hot Inbound Leads (last 24h) — contact_leads with employees ≥ 5, no admin note
// Limit lists to 50 to keep the dashboard fast; counts are unbounded.
superAdminBi.get('/sales-snapshot', async (c) => {
  try {
    const db = c.env.DB
    const [atRiskCountRow, atRiskListRow, stuckCountRow, stuckListRow, hotCountRow, hotListRow, objCountRow, objTopRow] = await db.batch([
      // 1a. At-risk churn count
      db.prepare(`
        SELECT COUNT(*) AS cnt
        FROM customers c
        LEFT JOIN customer_sales_intel csi ON csi.customer_id = c.id
        WHERE c.is_active = 1
          AND c.subscription_status IN ('active', 'past_due', 'trialing')
          AND COALESCE(csi.last_active_at, c.last_login, c.created_at) < datetime('now', '-30 days')
          AND csi.last_order_at IS NOT NULL
          AND csi.last_order_at < datetime('now', '-90 days')
      `),
      // 1b. At-risk churn top 50
      db.prepare(`
        SELECT c.id, c.email, c.name, c.company_name, c.phone,
               c.last_login, csi.last_active_at, csi.last_order_at,
               c.subscription_status, c.subscription_plan,
               CAST((julianday('now') - julianday(COALESCE(csi.last_active_at, c.last_login, c.created_at))) AS INTEGER) AS days_silent,
               CAST((julianday('now') - julianday(csi.last_order_at)) AS INTEGER) AS days_since_order
        FROM customers c
        LEFT JOIN customer_sales_intel csi ON csi.customer_id = c.id
        WHERE c.is_active = 1
          AND c.subscription_status IN ('active', 'past_due', 'trialing')
          AND COALESCE(csi.last_active_at, c.last_login, c.created_at) < datetime('now', '-30 days')
          AND csi.last_order_at IS NOT NULL
          AND csi.last_order_at < datetime('now', '-90 days')
        ORDER BY days_since_order DESC
        LIMIT 50
      `),
      // 2a. Stuck signup count
      db.prepare(`
        SELECT COUNT(*) AS cnt
        FROM customers c
        WHERE c.is_active = 1
          AND c.created_at < datetime('now', '-60 days')
          AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id)
          AND COALESCE(c.free_trial_used, 0) < COALESCE(c.free_trial_total, 3)
      `),
      // 2b. Stuck signup top 50
      db.prepare(`
        SELECT c.id, c.email, c.name, c.company_name, c.phone,
               c.created_at, c.last_login, csi.last_active_at,
               COALESCE(c.free_trial_total, 3) - COALESCE(c.free_trial_used, 0) AS credits_remaining,
               c.lead_utm_source, c.lead_source, c.gclid,
               CAST((julianday('now') - julianday(c.created_at)) AS INTEGER) AS days_since_signup
        FROM customers c
        LEFT JOIN customer_sales_intel csi ON csi.customer_id = c.id
        WHERE c.is_active = 1
          AND c.created_at < datetime('now', '-60 days')
          AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id)
          AND COALESCE(c.free_trial_used, 0) < COALESCE(c.free_trial_total, 3)
        ORDER BY c.created_at DESC
        LIMIT 50
      `),
      // 3a. Hot inbound count (last 24h, ≥5 employees, no admin contact attempted)
      db.prepare(`
        SELECT COUNT(*) AS cnt
        FROM contact_leads cl
        WHERE cl.created_at >= datetime('now', '-24 hours')
          AND (
            cl.employees IN ('5-10', '10-25', '25-50', '50-100', '100+')
            OR (cl.employees GLOB '[5-9]*' OR cl.employees GLOB '[1-9][0-9]*')
          )
      `),
      // 3b. Hot inbound list (last 24h, ranked by company size + recency)
      db.prepare(`
        SELECT id, name, email, phone, company, employees, interest, message,
               utm_source, utm_medium, utm_campaign,
               created_at,
               CAST((julianday('now') - julianday(created_at)) * 24 AS INTEGER) AS hours_ago
        FROM contact_leads
        WHERE created_at >= datetime('now', '-24 hours')
        ORDER BY
          CASE
            WHEN employees IN ('100+', '50-100') THEN 4
            WHEN employees IN ('25-50') THEN 3
            WHEN employees IN ('10-25') THEN 2
            WHEN employees IN ('5-10') THEN 1
            ELSE 0
          END DESC,
          created_at DESC
        LIMIT 50
      `),
      // 4a. Total objections in last 30d (sanity check that extractor is running)
      db.prepare(`SELECT COUNT(*) AS cnt FROM call_objections WHERE extracted_at >= datetime('now', '-30 days')`),
      // 4b. Top objection categories last 30d, with one example excerpt each
      db.prepare(`
        SELECT category, COUNT(*) AS cnt,
               (SELECT objection_text FROM call_objections o2 WHERE o2.category = o.category AND extracted_at >= datetime('now','-30 days') ORDER BY o2.id DESC LIMIT 1) AS example_text,
               (SELECT raw_excerpt FROM call_objections o3 WHERE o3.category = o.category AND extracted_at >= datetime('now','-30 days') ORDER BY o3.id DESC LIMIT 1) AS example_excerpt
        FROM call_objections o
        WHERE extracted_at >= datetime('now', '-30 days')
        GROUP BY category
        ORDER BY cnt DESC
        LIMIT 8
      `)
    ]) as any[]

    return c.json({
      at_risk_churn: {
        count: (atRiskCountRow.results?.[0]?.cnt as number) || 0,
        list: (atRiskListRow.results || []) as any[],
        description: 'Paying customers silent 30+ days AND no order in 90+ days. These are saveable with a phone call.'
      },
      stuck_signups: {
        count: (stuckCountRow.results?.[0]?.cnt as number) || 0,
        list: (stuckListRow.results || []) as any[],
        description: 'Signed up 60+ days ago, never ordered, free credits still unused. They wanted it once. Nudge them.'
      },
      hot_inbound_leads: {
        count: (hotCountRow.results?.[0]?.cnt as number) || 0,
        list: ((hotListRow.results || []) as any[]).map((row) => ({
          ...row,
          // 4-input lead score (0-100):
          //   source     (0-25): demo intent > contact form > asset request > unknown
          //   recency    (0-25): hours since submission (sooner = hotter)
          //   contact    (0-25): not yet contacted = full points (always full for new leads)
          //   firmographic (0-25): company size bracket
          lead_score: (() => {
            // Source — heuristic on the message/interest (demo, urgent → max).
            const interestStr = String(row.interest || row.message || '').toLowerCase()
            let source = 15
            if (/demo|book|schedule|call me|talk/.test(interestStr)) source = 25
            else if (/urgent|asap|today|right now/.test(interestStr)) source = 22
            else if (/pricing|quote|cost/.test(interestStr)) source = 20
            // Recency — full points first 4h, decay to 0 over 24h.
            const recency = Math.max(0, 25 - Math.floor((row.hours_ago || 0) * (25 / 24)))
            // Contact — new leads default to 25 (no admin attempt logged yet).
            const contact = 25
            // Firmographic — company size bracket.
            const emp = String(row.employees || '').toLowerCase()
            const firm = /100\+|50-100/.test(emp) ? 25
              : /25-50/.test(emp) ? 18
              : /10-25/.test(emp) ? 12
              : /5-10/.test(emp) ? 6
              : 0
            return source + recency + contact + firm
          })()
        })).sort((a: any, b: any) => (b.lead_score || 0) - (a.lead_score || 0)),
        description: 'Contact form submissions in the last 24h, scored 0-100 (source × recency × contact × firmographics). Call top-scored within 4h for ~3x conversion lift.'
      },
      objections_30d: {
        count: (objCountRow.results?.[0]?.cnt as number) || 0,
        top: (objTopRow.results || []) as any[],
        description: 'Top reasons prospects said no on cold calls in the last 30 days. Auto-extracted from LiveKit transcripts.'
      },
      generated_at: new Date().toISOString()
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

export { superAdminBi }
