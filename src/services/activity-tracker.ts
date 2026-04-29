// User activity tracker — feeds the super-admin User Activity dashboard.
//
// Single chokepoint:
//  - classifyModule(path): groups any URL into one of MODULES below
//  - trackActivity(env, params): upserts the (user, module) row in active_visits
//  - closeStaleVisits(env): flushes >5 min-idle rows into user_module_visits
//  - rollupYesterday(env): daily aggregate into user_activity_daily + 90-day purge
//
// trackActivity is meant to be called via ctx.waitUntil(...) so it never
// blocks the request. All errors are swallowed with console.warn — tracking
// must not break user requests.

import type { Bindings } from '../types'

export type UserType = 'admin' | 'customer'

export interface TrackParams {
  userType: UserType
  userId: number
  path: string
  ip?: string | null
  ua?: string | null
}

// Path-prefix → module classification. Order matters — first match wins, so
// more specific paths come first.
const MODULES: Array<{ prefix: string; module: string }> = [
  // Heartbeat itself — never log to avoid recursion.
  { prefix: '/api/activity', module: '__skip__' },

  // Solar (specific) — must come before /api/customer/ generic match.
  { prefix: '/api/customer/solar-', module: 'solar' },
  { prefix: '/api/storm-', module: 'solar' },
  { prefix: '/solar-', module: 'solar' },

  // Measurement engine + supporting services.
  { prefix: '/api/measure', module: 'measurement' },
  { prefix: '/api/property-imagery', module: 'measurement' },
  { prefix: '/api/sam3', module: 'measurement' },
  { prefix: '/api/report-images', module: 'measurement' },
  { prefix: '/measure', module: 'measurement' },

  // Reports / orders.
  { prefix: '/api/reports', module: 'reports' },
  { prefix: '/api/orders', module: 'reports' },
  { prefix: '/order/', module: 'reports' },
  { prefix: '/report/', module: 'reports' },

  // CRM / pipeline / D2D.
  { prefix: '/api/crm', module: 'crm' },
  { prefix: '/api/pipeline', module: 'crm' },
  { prefix: '/api/d2d', module: 'crm' },
  { prefix: '/api/customer-leads', module: 'crm' },
  { prefix: '/crm', module: 'crm' },

  // Billing / payments.
  { prefix: '/api/invoices', module: 'invoicing' },
  { prefix: '/api/square', module: 'invoicing' },
  { prefix: '/api/automations', module: 'invoicing' },
  { prefix: '/invoices', module: 'invoicing' },

  // Voice receptionist + agent infrastructure.
  { prefix: '/api/secretary', module: 'secretary' },
  { prefix: '/api/call-center', module: 'secretary' },
  { prefix: '/api/agents', module: 'secretary' },

  // Marketing & outbound.
  { prefix: '/api/google-ads', module: 'marketing' },
  { prefix: '/api/google-business', module: 'marketing' },
  { prefix: '/api/meta', module: 'marketing' },
  { prefix: '/api/email-outreach', module: 'marketing' },
  { prefix: '/api/blog', module: 'marketing' },

  // Team management.
  { prefix: '/api/team', module: 'team' },

  // AI tools.
  { prefix: '/api/home-designer', module: 'home_designer' },
  { prefix: '/api/virtual-tryon', module: 'home_designer' },
  { prefix: '/api/heygen', module: 'home_designer' },
  { prefix: '/api/gemini', module: 'home_designer' },
  { prefix: '/api/ai-admin', module: 'admin_tools' },
  { prefix: '/api/admin-agent', module: 'admin_tools' },
  { prefix: '/api/ai-autopilot', module: 'admin_tools' },
  { prefix: '/api/agent-hub', module: 'admin_tools' },

  // Super-admin surface.
  { prefix: '/api/admin/bi', module: 'analytics_view' },
  { prefix: '/api/analytics', module: 'analytics_view' },
  { prefix: '/api/admin', module: 'admin_tools' },
  { prefix: '/api/super-admin', module: 'admin_tools' },
  { prefix: '/super-admin', module: 'admin_tools' },
  { prefix: '/admin', module: 'admin_tools' },

  // Customer portal.
  { prefix: '/api/customer-auth', module: 'customer_portal' },
  { prefix: '/api/customer', module: 'customer_portal' },
  { prefix: '/customer', module: 'customer_portal' },
]

/**
 * Map a request path to a module name. Returns null when the path should
 * NOT be tracked (static assets, health checks, the tracker endpoint itself).
 */
export function classifyModule(path: string): string | null {
  if (!path) return null
  // Strip query string defensively — callers usually pass pathname only.
  const q = path.indexOf('?')
  const p = q >= 0 ? path.slice(0, q) : path

  // Hard skips — never tracked.
  if (p.startsWith('/static/')) return null
  if (p.startsWith('/_next/')) return null
  if (p === '/health' || p === '/healthz' || p === '/favicon.ico') return null
  if (p === '/robots.txt' || p === '/sitemap.xml') return null

  for (const { prefix, module } of MODULES) {
    if (p === prefix || p.startsWith(prefix + '/') || p.startsWith(prefix)) {
      if (module === '__skip__') return null
      return module
    }
  }

  // Authenticated request that didn't match — bucket as 'other' so we still
  // see who's around. Anonymous public pages (landing, blog reads) won't get
  // here because trackActivity is only called when a user is identified.
  return 'other'
}

/**
 * Upsert the active visit row for this (user, module). Safe to call from
 * waitUntil — never throws, never blocks. ~1 D1 write per call.
 */
export async function trackActivity(env: Bindings, p: TrackParams): Promise<void> {
  try {
    const module = classifyModule(p.path)
    if (!module) return
    if (!p.userId || p.userId <= 0) return

    const ip = (p.ip || '').slice(0, 64) || null
    const ua = (p.ua || '').slice(0, 255) || null

    // ON CONFLICT extends the visit; otherwise opens a new one.
    await env.DB.prepare(
      `INSERT INTO active_visits
         (user_type, user_id, module, started_at, last_seen_at, request_count, ip_address, user_agent)
       VALUES (?, ?, ?, datetime('now'), datetime('now'), 1, ?, ?)
       ON CONFLICT(user_type, user_id, module) DO UPDATE SET
         last_seen_at = datetime('now'),
         request_count = request_count + 1,
         ip_address = COALESCE(?, ip_address),
         user_agent = COALESCE(?, user_agent)`
    ).bind(p.userType, p.userId, module, ip, ua, ip, ua).run()

    // Lazy cleanup: 1-in-50 sample to flush stale rows. Keeps active_visits
    // small even if cron hasn't run yet, without paying the cost on every hit.
    if (Math.random() < 0.02) {
      // Don't await — fire-and-forget inside the already-fire-and-forget tracker.
      closeStaleVisits(env).catch(() => {})
    }
  } catch (e: any) {
    console.warn('[activity-tracker] track failed:', e?.message || e)
  }
}

/**
 * Move any active_visits row idle for >5 minutes into user_module_visits.
 * Run by the daily cron and lazily by trackActivity.
 */
export async function closeStaleVisits(env: Bindings): Promise<{ closed: number }> {
  try {
    const stale = await env.DB.prepare(
      `SELECT id, user_type, user_id, module, started_at, last_seen_at, request_count, ip_address, user_agent
       FROM active_visits
       WHERE last_seen_at < datetime('now', '-5 minutes')
       LIMIT 500`
    ).all<any>()

    const rows = stale?.results || []
    if (!rows.length) return { closed: 0 }

    for (const r of rows) {
      const dur = Math.max(
        1,
        Math.floor((Date.parse(r.last_seen_at + 'Z') - Date.parse(r.started_at + 'Z')) / 1000)
      )
      await env.DB.prepare(
        `INSERT INTO user_module_visits
           (user_type, user_id, module, started_at, ended_at, duration_seconds, request_count, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        r.user_type, r.user_id, r.module,
        r.started_at, r.last_seen_at, dur, r.request_count,
        r.ip_address, r.user_agent
      ).run()
      await env.DB.prepare(`DELETE FROM active_visits WHERE id = ?`).bind(r.id).run()
    }

    return { closed: rows.length }
  } catch (e: any) {
    console.warn('[activity-tracker] closeStaleVisits failed:', e?.message || e)
    return { closed: 0 }
  }
}

/**
 * Daily rollup: aggregate yesterday's user_module_visits into
 * user_activity_daily, then purge user_module_visits older than 90 days.
 */
export async function rollupYesterday(env: Bindings): Promise<{ rolled: number; purged: number }> {
  try {
    // First flush any lingering active_visits so yesterday's totals are correct.
    await closeStaleVisits(env)

    const ins = await env.DB.prepare(
      `INSERT INTO user_activity_daily
         (day, user_type, user_id, module, total_seconds, visit_count, request_count)
       SELECT date(started_at) AS day, user_type, user_id, module,
              SUM(duration_seconds), COUNT(*), SUM(request_count)
       FROM user_module_visits
       WHERE date(started_at) = date('now', '-1 day')
       GROUP BY day, user_type, user_id, module
       ON CONFLICT(day, user_type, user_id, module) DO UPDATE SET
         total_seconds = excluded.total_seconds,
         visit_count   = excluded.visit_count,
         request_count = excluded.request_count`
    ).run()

    const del = await env.DB.prepare(
      `DELETE FROM user_module_visits WHERE started_at < datetime('now', '-90 days')`
    ).run()

    return {
      rolled: (ins as any)?.meta?.changes || 0,
      purged: (del as any)?.meta?.changes || 0,
    }
  } catch (e: any) {
    console.warn('[activity-tracker] rollupYesterday failed:', e?.message || e)
    return { rolled: 0, purged: 0 }
  }
}

export const ACTIVITY_MODULES = [
  'measurement', 'reports', 'crm', 'invoicing', 'solar', 'secretary',
  'marketing', 'team', 'admin_tools', 'customer_portal', 'home_designer',
  'analytics_view', 'other',
] as const
