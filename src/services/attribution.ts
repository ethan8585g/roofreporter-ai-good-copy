// ============================================================
// Attribution service
// Pure-ish logic for:
//   • path_template + page_type + content_slug derivation
//   • computing first/last touch + journey for a customer
//   • daily content-performance rollup
// All SQL goes through the analytics-attribution repository.
// ============================================================

import {
  getPageviewsForCustomer,
  getCustomerRevenueSnapshot,
  getCustomersForAttribution,
  upsertAttribution,
  linkRecentTrafficByIp,
  deleteContentDailyForDate,
  insertContentDailyRow,
} from '../repositories/analytics-attribution'
import type { AttributionRow } from '../repositories/analytics-attribution'

// ── Path classification ──────────────────────────────────────
// We parse page_url (which may be a full URL or a path) into
// { path, path_template, page_type, content_slug }.
// path_template collapses dynamic segments (slugs, ids) so we
// can group blog/:slug into one row instead of 200 rows.
export function classifyPath(rawUrl: string): {
  path: string
  path_template: string
  page_type: string
  content_slug: string | null
} {
  let path = rawUrl || '/'
  try {
    if (/^https?:\/\//.test(path)) path = new URL(path).pathname
  } catch { /* no-op */ }
  // strip query + hash + trailing slash (except root)
  path = path.split('?')[0].split('#')[0]
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  if (!path) path = '/'

  // Page-type rules — order matters
  let page_type = 'other'
  let content_slug: string | null = null
  let path_template = path

  if (path === '/' || path === '/home') {
    page_type = 'marketing'; path_template = '/'
  } else if (path.startsWith('/blog/')) {
    page_type = 'blog'
    content_slug = path.replace(/^\/blog\//, '').split('/')[0] || null
    path_template = '/blog/:slug'
  } else if (path === '/blog') {
    page_type = 'blog'; path_template = '/blog'
  } else if (path.startsWith('/proposal/')) {
    page_type = 'app'; path_template = '/proposal/:id'
  } else if (path.startsWith('/preview/')) {
    page_type = 'app'; path_template = '/preview/:id'
  } else if (path.startsWith('/lander')) {
    page_type = 'marketing'
    content_slug = path.replace(/^\/lander\/?/, '') || null
    path_template = content_slug ? '/lander/:slug' : '/lander'
  } else if (path.startsWith('/pricing')) {
    page_type = 'marketing'; path_template = '/pricing'
  } else if (path.startsWith('/us/') || path.startsWith('/ca/') || path.startsWith('/uk/') || path.startsWith('/au/')) {
    // SEO geo pages — collapse /us/state/city → /us/:state/:city, /ca/:province → /ca/:province
    page_type = 'marketing'
    const parts = path.split('/').filter(Boolean) // ['us','texas','austin']
    const region = parts[0]
    if (parts.length === 1) path_template = `/${region}`
    else if (parts.length === 2) path_template = `/${region}/:region`
    else path_template = `/${region}/:region/:city`
    content_slug = parts.slice(1).join('/') || null
  } else if (path.startsWith('/howto') || path.startsWith('/guides') || path.startsWith('/help')) {
    page_type = 'howto'
    const parts = path.split('/').filter(Boolean)
    content_slug = parts[1] || null
    path_template = parts.length > 1 ? `/${parts[0]}/:slug` : `/${parts[0]}`
  } else if (path.startsWith('/customer')) {
    page_type = 'app'
    // collapse /customer/order/<id>, /customer/dashboard etc into stable templates
    const parts = path.split('/').filter(Boolean) // ['customer','order','123']
    if (parts.length <= 2) path_template = '/' + parts.join('/')
    else path_template = '/' + parts.slice(0, 2).join('/') + '/:id'
  } else if (path.startsWith('/admin') || path.startsWith('/super-admin')) {
    page_type = 'admin'; path_template = path.startsWith('/super-admin') ? '/super-admin' : '/admin'
  } else if (path.startsWith('/api/')) {
    page_type = 'api'; path_template = '/api/*'
  } else if (path.startsWith('/login') || path.startsWith('/register')) {
    page_type = 'marketing'; path_template = path
  } else {
    // Fallback — collapse trailing numeric/UUID-ish segment
    page_type = 'marketing'
    path_template = path.replace(/\/[0-9a-f-]{8,}$/i, '/:id').replace(/\/\d+$/, '/:id')
  }

  return { path, path_template, page_type, content_slug }
}

export function parseReferrerDomain(ref: string | null): string | null {
  if (!ref) return null
  try {
    const u = new URL(ref)
    return u.hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

// ── identifySession — called from /register, /login, /google-login ──
// Stamps recent same-IP analytics rows with the customer_id and triggers
// an attribution recompute (waitUntil-friendly).
export async function identifySession(
  db: D1Database,
  customerId: number,
  ip: string | null
): Promise<void> {
  if (!customerId) return
  if (ip) {
    await linkRecentTrafficByIp(db, customerId, ip).catch(() => {})
  }
  await recomputeAttributionForCustomer(db, customerId).catch((e) => {
    console.warn('[attribution] recompute failed for', customerId, e?.message)
  })
}

// ── Compute & upsert attribution for one customer ────────────
export async function recomputeAttributionForCustomer(db: D1Database, customerId: number) {
  const customer = await db.prepare(`SELECT id, created_at FROM customers WHERE id = ?`).bind(customerId).first<any>()
  if (!customer) return null
  const pageviews = await getPageviewsForCustomer(db, customerId)
  if (!pageviews || pageviews.length === 0) {
    // still write a row so we know we tried — minimal info
    const rev = await getCustomerRevenueSnapshot(db, customerId)
    const row: AttributionRow = {
      customer_id: customerId,
      first_touch_path: null,
      last_touch_path: null,
      first_touch_path_template: null,
      first_touch_page_type: null,
      first_touch_utm_source: null,
      first_touch_referrer_domain: null,
      first_touch_at: null,
      last_touch_path_template: null,
      last_touch_utm_source: null,
      last_touch_at: null,
      touch_count: 0,
      session_count: 0,
      journey_path_templates: '[]',
      days_to_convert: null,
      converted_at: customer.created_at,
      first_paid_at: rev.first_paid_at,
      total_orders: rev.total_orders,
      total_paid_orders: rev.total_paid_orders,
      revenue_cents: rev.revenue_cents
    }
    await upsertAttribution(db, row)
    return row
  }

  const first = pageviews[0]
  const lastBeforeConv = pageviews.filter((p: any) => !customer.created_at || p.created_at <= customer.created_at).pop() || pageviews[pageviews.length - 1]
  const firstClass = classifyPath(first.page_url)
  const lastClass  = classifyPath(lastBeforeConv.page_url)

  // distinct path_templates in order
  const seen = new Set<string>()
  const journey: string[] = []
  for (const pv of pageviews) {
    const t = classifyPath(pv.page_url).path_template
    if (!seen.has(t)) { seen.add(t); journey.push(t) }
    if (journey.length >= 50) break
  }
  const sessionIds = new Set<string>()
  for (const pv of pageviews) if (pv.session_id) sessionIds.add(pv.session_id)

  const firstAt = first.created_at
  const conv = customer.created_at
  let daysToConvert: number | null = null
  try {
    if (firstAt && conv) {
      const ms = new Date(conv).getTime() - new Date(firstAt).getTime()
      daysToConvert = Math.max(0, Math.floor(ms / 86400000))
    }
  } catch { /* no-op */ }

  const rev = await getCustomerRevenueSnapshot(db, customerId)

  const row: AttributionRow = {
    customer_id: customerId,
    // Full URLs (with query string, including gclid + utms + ref code) —
    // the difference between actionable trace data and just "/lander".
    first_touch_path: (first.page_url ? String(first.page_url).slice(0, 2000) : null),
    last_touch_path: (lastBeforeConv.page_url ? String(lastBeforeConv.page_url).slice(0, 2000) : null),
    first_touch_path_template: firstClass.path_template,
    first_touch_page_type: firstClass.page_type,
    first_touch_utm_source: first.utm_source || null,
    first_touch_referrer_domain: parseReferrerDomain(first.referrer || null),
    first_touch_at: firstAt,
    last_touch_path_template: lastClass.path_template,
    last_touch_utm_source: lastBeforeConv.utm_source || null,
    last_touch_at: lastBeforeConv.created_at,
    touch_count: pageviews.length,
    session_count: sessionIds.size,
    journey_path_templates: JSON.stringify(journey),
    days_to_convert: daysToConvert,
    converted_at: customer.created_at,
    first_paid_at: rev.first_paid_at,
    total_orders: rev.total_orders,
    total_paid_orders: rev.total_paid_orders,
    revenue_cents: rev.revenue_cents
  }
  await upsertAttribution(db, row)
  return row
}

// ── Daily rollup — runs nightly (or on demand) ───────────────
// For a given UTC date, recompute analytics_content_daily.
export async function rollupContentDaily(db: D1Database, dateYmd: string) {
  // 1) raw stats from site_analytics — pageviews, unique visitors, sessions, bounces, dwell, scroll
  const start = `${dateYmd} 00:00:00`
  const end   = `${dateYmd} 23:59:59`

  const pvs = await db.prepare(`
    SELECT page_url, visitor_id, session_id, time_on_page, scroll_depth
    FROM site_analytics
    WHERE event_type = 'pageview'
      AND created_at >= ? AND created_at <= ?
      AND page_url NOT LIKE '/api/%'
  `).bind(start, end).all<any>()

  type Bucket = {
    page_type: string
    content_slug: string | null
    pageviews: number
    visitors: Set<string>
    sessions: Set<string>
    sessionPagesByTpl: Map<string, Set<string>>  // not needed per-bucket; keep external
    timeSum: number; timeN: number
    scrollSum: number; scrollN: number
  }
  const buckets = new Map<string, Bucket>()
  // session→count(distinct path_template) for bounce calc
  const sessionTplCount = new Map<string, Set<string>>()
  // session→first path_template for sessions_started attribution
  const sessionFirstTpl = new Map<string, string>()

  for (const r of (pvs.results || [])) {
    const cls = classifyPath(r.page_url)
    if (cls.page_type === 'admin' || cls.page_type === 'api') continue
    const tpl = cls.path_template
    let b = buckets.get(tpl)
    if (!b) {
      b = {
        page_type: cls.page_type,
        content_slug: cls.content_slug,
        pageviews: 0,
        visitors: new Set<string>(),
        sessions: new Set<string>(),
        sessionPagesByTpl: new Map(),
        timeSum: 0, timeN: 0, scrollSum: 0, scrollN: 0
      }
      buckets.set(tpl, b)
    }
    b.pageviews += 1
    if (r.visitor_id) b.visitors.add(r.visitor_id)
    if (r.session_id) b.sessions.add(r.session_id)
    if (r.time_on_page && r.time_on_page > 0) { b.timeSum += Number(r.time_on_page); b.timeN += 1 }
    if (r.scroll_depth && r.scroll_depth > 0) { b.scrollSum += Number(r.scroll_depth); b.scrollN += 1 }
    if (r.session_id) {
      let st = sessionTplCount.get(r.session_id)
      if (!st) { st = new Set<string>(); sessionTplCount.set(r.session_id, st) }
      st.add(tpl)
      if (!sessionFirstTpl.has(r.session_id)) sessionFirstTpl.set(r.session_id, tpl)
    }
  }

  // sessions_started per template = sessions whose FIRST pageview was this template
  const sessionsStartedByTpl = new Map<string, number>()
  for (const tpl of sessionFirstTpl.values()) {
    sessionsStartedByTpl.set(tpl, (sessionsStartedByTpl.get(tpl) || 0) + 1)
  }
  // bounces per template = sessions where session only had this 1 distinct template
  const bouncesByTpl = new Map<string, number>()
  for (const [sid, set] of sessionTplCount.entries()) {
    if (set.size === 1) {
      const tpl = Array.from(set)[0]
      bouncesByTpl.set(tpl, (bouncesByTpl.get(tpl) || 0) + 1)
    }
  }

  // 2) attribution counts for THIS date — first-touch and any-touch for signups + paid orders
  // Find customers whose first_touch falls on dateYmd → first-touch attribution credit on that date
  const firstTouchHits = await db.prepare(`
    SELECT first_touch_path_template, COUNT(*) as signups,
           SUM(CASE WHEN total_paid_orders > 0 THEN 1 ELSE 0 END) as orders,
           SUM(revenue_cents) as revenue
    FROM analytics_attribution
    WHERE substr(first_touch_at, 1, 10) = ?
    GROUP BY first_touch_path_template
  `).bind(dateYmd).all<any>()

  const firstByTpl = new Map<string, { s: number; o: number; r: number }>()
  for (const x of (firstTouchHits.results || [])) {
    if (!x.first_touch_path_template) continue
    firstByTpl.set(x.first_touch_path_template, {
      s: Number(x.signups || 0), o: Number(x.orders || 0), r: Number(x.revenue || 0)
    })
  }

  // any-touch — customers where journey includes this template, conversion happened on/around this date
  // Simpler approach: customers whose CONVERSION date is dateYmd, contribute to every template in their journey
  const convToday = await db.prepare(`
    SELECT customer_id, total_paid_orders, revenue_cents, journey_path_templates
    FROM analytics_attribution
    WHERE substr(converted_at, 1, 10) = ?
  `).bind(dateYmd).all<any>()

  const anyByTpl = new Map<string, { s: number; o: number; r: number }>()
  for (const c of (convToday.results || [])) {
    let arr: string[] = []
    try { arr = JSON.parse(c.journey_path_templates || '[]') } catch {}
    const isPaid = (c.total_paid_orders || 0) > 0
    const rev = Number(c.revenue_cents || 0)
    for (const tpl of arr) {
      let cur = anyByTpl.get(tpl)
      if (!cur) { cur = { s: 0, o: 0, r: 0 }; anyByTpl.set(tpl, cur) }
      cur.s += 1
      if (isPaid) cur.o += 1
      cur.r += rev
    }
  }

  // 3) wipe + insert rows for the day
  await deleteContentDailyForDate(db, dateYmd)

  // collect every template that has either traffic OR attribution credit
  const allTpls = new Set<string>([...buckets.keys(), ...firstByTpl.keys(), ...anyByTpl.keys()])

  for (const tpl of allTpls) {
    const b = buckets.get(tpl)
    const f = firstByTpl.get(tpl) || { s: 0, o: 0, r: 0 }
    const a = anyByTpl.get(tpl) || { s: 0, o: 0, r: 0 }
    await insertContentDailyRow(db, {
      date: dateYmd,
      path_template: tpl,
      page_type: b?.page_type || classifyPath(tpl).page_type,
      content_slug: b?.content_slug || null,
      pageviews: b?.pageviews || 0,
      unique_visitors: b ? b.visitors.size : 0,
      sessions_started: sessionsStartedByTpl.get(tpl) || 0,
      bounces: bouncesByTpl.get(tpl) || 0,
      signups_first_touch: f.s,
      signups_any_touch: a.s,
      orders_first_touch: f.o,
      orders_any_touch: a.o,
      revenue_first_touch_cents: f.r,
      revenue_any_touch_cents: a.r,
      avg_time_on_page: b && b.timeN > 0 ? Math.round((b.timeSum / b.timeN) * 10) / 10 : 0,
      avg_scroll_depth: b && b.scrollN > 0 ? Math.round((b.scrollSum / b.scrollN) * 10) / 10 : 0,
    })
  }

  return { date: dateYmd, templates: allTpls.size }
}

// Recompute attribution for all customers with new sessions in the last N hours.
export async function recomputeRecentAttribution(db: D1Database, hours: number = 36) {
  const sinceIso = new Date(Date.now() - hours * 3600000).toISOString().replace('T', ' ').slice(0, 19)
  const customers = await getCustomersForAttribution(db, sinceIso)
  let n = 0
  for (const c of customers) {
    try { await recomputeAttributionForCustomer(db, c.id); n += 1 } catch (e: any) {
      console.warn('[attribution] recompute failed for', c.id, e?.message)
    }
  }
  return { recomputed: n }
}

// Run the full nightly rollup: yesterday's content_daily + recent attribution refresh.
export async function runNightlyAttributionRollup(db: D1Database) {
  const d = new Date(Date.now() - 86400000)
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const dateYmd = `${yyyy}-${mm}-${dd}`
  const recompute = await recomputeRecentAttribution(db, 36)
  const rollup = await rollupContentDaily(db, dateYmd)
  return { ...rollup, ...recompute }
}
