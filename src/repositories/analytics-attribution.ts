// ============================================================
// Repository — analytics_attribution + analytics_content_daily
// All SQL for the attribution layer lives here.
// site_analytics is read-only from this module's perspective.
// ============================================================

export type AttributionRow = {
  customer_id: number
  first_touch_path_template: string | null
  first_touch_page_type: string | null
  first_touch_utm_source: string | null
  first_touch_referrer_domain: string | null
  first_touch_at: string | null
  last_touch_path_template: string | null
  last_touch_utm_source: string | null
  last_touch_at: string | null
  touch_count: number
  session_count: number
  journey_path_templates: string | null
  days_to_convert: number | null
  converted_at: string | null
  first_paid_at: string | null
  total_orders: number
  total_paid_orders: number
  revenue_cents: number
}

// Find pageviews for a visitor (ordered).  Used by attribution computer.
export async function getPageviewsForVisitor(db: D1Database, visitorId: string) {
  const r = await db.prepare(`
    SELECT id, session_id, page_url, referrer,
           utm_source, utm_medium, utm_campaign,
           created_at
    FROM site_analytics
    WHERE visitor_id = ? AND event_type = 'pageview'
    ORDER BY created_at ASC
    LIMIT 500
  `).bind(visitorId).all<any>()
  return r.results || []
}

// Find pageviews for a customer by joining via user_id (stamped at identify time).
export async function getPageviewsForCustomer(db: D1Database, customerId: number) {
  const r = await db.prepare(`
    SELECT id, session_id, visitor_id, page_url, referrer,
           utm_source, utm_medium, utm_campaign,
           created_at
    FROM site_analytics
    WHERE user_id = ? AND event_type = 'pageview'
    ORDER BY created_at ASC
    LIMIT 1000
  `).bind(customerId).all<any>()
  return r.results || []
}

// Pull the customers + revenue snapshot we need to compute attribution for.
export async function getCustomersForAttribution(db: D1Database, sinceIso: string | null) {
  const sql = sinceIso
    ? `SELECT id, created_at FROM customers
       WHERE created_at >= ?
          OR id IN (SELECT customer_id FROM analytics_attribution WHERE computed_at >= ?)
       ORDER BY id ASC LIMIT 5000`
    : `SELECT id, created_at FROM customers ORDER BY id ASC LIMIT 5000`
  const stmt = sinceIso ? db.prepare(sql).bind(sinceIso, sinceIso) : db.prepare(sql)
  const r = await stmt.all<any>()
  return r.results || []
}

// Per-customer order + payment totals (used for revenue attribution).
export async function getCustomerRevenueSnapshot(db: D1Database, customerId: number) {
  // orders table joins to payments via order_id.
  // We treat any row in payments with status='succeeded' as paid revenue.
  const orders = await db.prepare(`
    SELECT id, payment_status, price, created_at
    FROM orders
    WHERE customer_id = ?
  `).bind(customerId).all<any>().catch(() => ({ results: [] as any[] }))
  const orderIds = (orders.results || []).map((o: any) => o.id)
  let revenueCents = 0
  let paidCount = 0
  let firstPaidAt: string | null = null
  if (orderIds.length > 0) {
    // batched IN — chunk to be safe
    for (let i = 0; i < orderIds.length; i += 50) {
      const chunk = orderIds.slice(i, i + 50)
      const placeholders = chunk.map(() => '?').join(',')
      const pays = await db.prepare(`
        SELECT amount, currency, created_at
        FROM payments
        WHERE order_id IN (${placeholders}) AND status = 'succeeded'
      `).bind(...chunk).all<any>().catch(() => ({ results: [] as any[] }))
      for (const p of (pays.results || [])) {
        // payments.amount in this codebase is dollars (numeric), convert to cents
        const cents = Math.round(Number(p.amount || 0) * 100)
        if (cents > 0) {
          revenueCents += cents
          paidCount += 1
          if (!firstPaidAt || (p.created_at && p.created_at < firstPaidAt)) firstPaidAt = p.created_at
        }
      }
    }
  }
  // fallback: orders with payment_status='paid' but no payments row
  if (paidCount === 0) {
    for (const o of (orders.results || [])) {
      if (o.payment_status === 'paid') {
        const cents = Math.round(Number(o.price || 0) * 100)
        if (cents > 0) {
          revenueCents += cents
          paidCount += 1
          if (!firstPaidAt || (o.created_at && o.created_at < firstPaidAt)) firstPaidAt = o.created_at
        }
      }
    }
  }
  return {
    total_orders: (orders.results || []).length,
    total_paid_orders: paidCount,
    revenue_cents: revenueCents,
    first_paid_at: firstPaidAt
  }
}

export async function upsertAttribution(db: D1Database, row: AttributionRow) {
  await db.prepare(`
    INSERT INTO analytics_attribution (
      customer_id,
      first_touch_session_id, first_touch_visitor_id,
      first_touch_path, first_touch_path_template, first_touch_page_type,
      first_touch_referrer, first_touch_referrer_domain,
      first_touch_utm_source, first_touch_utm_medium, first_touch_utm_campaign,
      first_touch_at,
      last_touch_session_id, last_touch_path, last_touch_path_template, last_touch_page_type,
      last_touch_referrer_domain, last_touch_utm_source, last_touch_at,
      touch_count, session_count, journey_path_templates, days_to_convert,
      converted_at, first_paid_at, total_orders, total_paid_orders, revenue_cents,
      computed_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      datetime('now')
    )
    ON CONFLICT(customer_id) DO UPDATE SET
      first_touch_session_id = excluded.first_touch_session_id,
      first_touch_visitor_id = excluded.first_touch_visitor_id,
      first_touch_path = excluded.first_touch_path,
      first_touch_path_template = excluded.first_touch_path_template,
      first_touch_page_type = excluded.first_touch_page_type,
      first_touch_referrer = excluded.first_touch_referrer,
      first_touch_referrer_domain = excluded.first_touch_referrer_domain,
      first_touch_utm_source = excluded.first_touch_utm_source,
      first_touch_utm_medium = excluded.first_touch_utm_medium,
      first_touch_utm_campaign = excluded.first_touch_utm_campaign,
      first_touch_at = excluded.first_touch_at,
      last_touch_session_id = excluded.last_touch_session_id,
      last_touch_path = excluded.last_touch_path,
      last_touch_path_template = excluded.last_touch_path_template,
      last_touch_page_type = excluded.last_touch_page_type,
      last_touch_referrer_domain = excluded.last_touch_referrer_domain,
      last_touch_utm_source = excluded.last_touch_utm_source,
      last_touch_at = excluded.last_touch_at,
      touch_count = excluded.touch_count,
      session_count = excluded.session_count,
      journey_path_templates = excluded.journey_path_templates,
      days_to_convert = excluded.days_to_convert,
      converted_at = excluded.converted_at,
      first_paid_at = excluded.first_paid_at,
      total_orders = excluded.total_orders,
      total_paid_orders = excluded.total_paid_orders,
      revenue_cents = excluded.revenue_cents,
      computed_at = datetime('now')
  `).bind(
    row.customer_id,
    null /* session_id captured below */, null, null,
    row.first_touch_path_template, row.first_touch_page_type,
    null, row.first_touch_referrer_domain,
    row.first_touch_utm_source, null, null,
    row.first_touch_at,
    null, null, row.last_touch_path_template, null,
    null, row.last_touch_utm_source, row.last_touch_at,
    row.touch_count, row.session_count, row.journey_path_templates, row.days_to_convert,
    row.converted_at, row.first_paid_at, row.total_orders, row.total_paid_orders, row.revenue_cents
  ).run()
}

// Stamp recent unidentified site_analytics rows with this customer_id by IP match.
// Used at signup/login time to retroactively attribute the pre-login traffic.
export async function linkRecentTrafficByIp(
  db: D1Database,
  customerId: number,
  ip: string,
  windowHours: number = 24
) {
  if (!ip || ip === 'unknown') return { linked: 0 }
  const r = await db.prepare(`
    UPDATE site_analytics
    SET user_id = ?
    WHERE user_id IS NULL
      AND ip_address = ?
      AND created_at >= datetime('now', ?)
  `).bind(customerId, ip, `-${windowHours} hours`).run().catch(() => null)
  return { linked: (r as any)?.meta?.changes ?? 0 }
}

// ── Daily rollup ─────────────────────────────────────────────
export async function deleteContentDailyForDate(db: D1Database, date: string) {
  await db.prepare(`DELETE FROM analytics_content_daily WHERE date = ?`).bind(date).run()
}

export async function insertContentDailyRow(db: D1Database, row: {
  date: string
  path_template: string
  page_type: string | null
  content_slug: string | null
  pageviews: number
  unique_visitors: number
  sessions_started: number
  bounces: number
  signups_first_touch: number
  signups_any_touch: number
  orders_first_touch: number
  orders_any_touch: number
  revenue_first_touch_cents: number
  revenue_any_touch_cents: number
  avg_time_on_page: number
  avg_scroll_depth: number
}) {
  await db.prepare(`
    INSERT INTO analytics_content_daily (
      date, path_template, page_type, content_slug,
      pageviews, unique_visitors, sessions_started, bounces,
      signups_first_touch, signups_any_touch,
      orders_first_touch, orders_any_touch,
      revenue_first_touch_cents, revenue_any_touch_cents,
      avg_time_on_page, avg_scroll_depth
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    row.date, row.path_template, row.page_type, row.content_slug,
    row.pageviews, row.unique_visitors, row.sessions_started, row.bounces,
    row.signups_first_touch, row.signups_any_touch,
    row.orders_first_touch, row.orders_any_touch,
    row.revenue_first_touch_cents, row.revenue_any_touch_cents,
    row.avg_time_on_page, row.avg_scroll_depth
  ).run()
}

// ── Read APIs for the dashboard ──────────────────────────────
export async function getContentPerformance(
  db: D1Database,
  opts: { sinceDate: string; pageType?: string | null; limit?: number }
) {
  const where: string[] = ['date >= ?']
  const args: any[] = [opts.sinceDate]
  if (opts.pageType) { where.push('page_type = ?'); args.push(opts.pageType) }
  const limit = Math.min(opts.limit || 200, 500)
  const sql = `
    SELECT
      path_template,
      MAX(page_type)   as page_type,
      MAX(content_slug) as content_slug,
      SUM(pageviews)        as pageviews,
      SUM(unique_visitors)  as unique_visitors,
      SUM(sessions_started) as sessions_started,
      SUM(bounces)          as bounces,
      SUM(signups_first_touch) as signups_first_touch,
      SUM(signups_any_touch)   as signups_any_touch,
      SUM(orders_first_touch)  as orders_first_touch,
      SUM(orders_any_touch)    as orders_any_touch,
      SUM(revenue_first_touch_cents) as revenue_first_touch_cents,
      SUM(revenue_any_touch_cents)   as revenue_any_touch_cents,
      AVG(avg_time_on_page)  as avg_time_on_page,
      AVG(avg_scroll_depth)  as avg_scroll_depth
    FROM analytics_content_daily
    WHERE ${where.join(' AND ')}
    GROUP BY path_template
    ORDER BY revenue_any_touch_cents DESC, signups_any_touch DESC, pageviews DESC
    LIMIT ${limit}
  `
  const r = await db.prepare(sql).bind(...args).all<any>()
  return r.results || []
}

export async function getAttributionTotals(db: D1Database, sinceIso: string) {
  const r = await db.prepare(`
    SELECT
      COUNT(*) as converted_customers,
      SUM(CASE WHEN total_paid_orders > 0 THEN 1 ELSE 0 END) as paying_customers,
      SUM(revenue_cents) as revenue_cents,
      AVG(days_to_convert) as avg_days_to_convert,
      AVG(touch_count) as avg_touches
    FROM analytics_attribution
    WHERE converted_at >= ?
  `).bind(sinceIso).first<any>()
  return r
}

export async function getTopAcquisitionSources(db: D1Database, sinceIso: string, mode: 'first' | 'last') {
  const col = mode === 'first' ? 'first_touch_utm_source' : 'last_touch_utm_source'
  const tcol = mode === 'first' ? 'first_touch_path_template' : 'last_touch_path_template'
  const r = await db.prepare(`
    SELECT
      COALESCE(${col}, '(direct)') as source,
      COUNT(*) as customers,
      SUM(CASE WHEN total_paid_orders > 0 THEN 1 ELSE 0 END) as paying,
      SUM(revenue_cents) as revenue_cents,
      MIN(${tcol}) as example_template
    FROM analytics_attribution
    WHERE converted_at >= ?
    GROUP BY source
    ORDER BY revenue_cents DESC, customers DESC
    LIMIT 25
  `).bind(sinceIso).all<any>()
  return r.results || []
}

export async function getJourneys(db: D1Database, sinceIso: string, limit = 50) {
  const r = await db.prepare(`
    SELECT customer_id, first_touch_path_template, last_touch_path_template,
           first_touch_utm_source, last_touch_utm_source,
           touch_count, session_count, days_to_convert,
           journey_path_templates, converted_at, revenue_cents
    FROM analytics_attribution
    WHERE converted_at >= ?
    ORDER BY converted_at DESC
    LIMIT ?
  `).bind(sinceIso, limit).all<any>()
  return r.results || []
}

export async function getFunnelCounts(db: D1Database, sinceIso: string) {
  // We approximate the funnel from existing site_analytics columns + customers/orders/payments.
  const sessions = await db.prepare(`
    SELECT COUNT(DISTINCT session_id) as n
    FROM site_analytics
    WHERE event_type = 'pageview' AND created_at >= ?
      AND page_url NOT LIKE '/super-admin%' AND page_url NOT LIKE '/admin%'
      AND page_url NOT LIKE '/login%' AND page_url NOT LIKE '/api/%'
  `).bind(sinceIso).first<any>()
  const reachedOrder = await db.prepare(`
    SELECT COUNT(DISTINCT session_id) as n
    FROM site_analytics
    WHERE event_type = 'pageview' AND created_at >= ?
      AND (page_url LIKE '/customer/order%' OR page_url LIKE '/order/%' OR page_url LIKE '/lander%' OR page_url LIKE '/preview%')
  `).bind(sinceIso).first<any>()
  const reachedPricing = await db.prepare(`
    SELECT COUNT(DISTINCT session_id) as n
    FROM site_analytics
    WHERE event_type = 'pageview' AND created_at >= ? AND page_url LIKE '/pricing%'
  `).bind(sinceIso).first<any>()
  const signups = await db.prepare(`SELECT COUNT(*) as n FROM customers WHERE created_at >= ?`).bind(sinceIso).first<any>()
  const orders = await db.prepare(`SELECT COUNT(*) as n FROM orders WHERE created_at >= ?`).bind(sinceIso).first<any>()
  const paidOrders = await db.prepare(`
    SELECT COUNT(*) as n FROM orders WHERE created_at >= ? AND payment_status = 'paid'
  `).bind(sinceIso).first<any>().catch(() => ({ n: 0 }))
  return {
    sessions: sessions?.n || 0,
    reached_pricing: reachedPricing?.n || 0,
    reached_order: reachedOrder?.n || 0,
    signups: signups?.n || 0,
    orders: orders?.n || 0,
    paid_orders: (paidOrders as any)?.n || 0
  }
}
