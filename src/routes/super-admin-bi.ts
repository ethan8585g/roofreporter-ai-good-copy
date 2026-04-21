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
      // Blog-to-signup conversion: visitors who hit a blog page AND became customers in window
      db.prepare(`
        SELECT COUNT(DISTINCT sa.visitor_id) as blog_visitors,
               COUNT(DISTINCT CASE WHEN cust.id IS NOT NULL THEN sa.visitor_id END) as converted
        FROM site_analytics sa
        LEFT JOIN customers cust ON cust.email IS NOT NULL
          AND cust.created_at >= sa.created_at
          AND cust.created_at <= datetime(sa.created_at,'+7 days')
        WHERE sa.event_type='pageview'
          AND sa.page_url LIKE '/blog/%'
          AND sa.created_at >= datetime('now',?)
      `).bind(period),
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

export { superAdminBi }
