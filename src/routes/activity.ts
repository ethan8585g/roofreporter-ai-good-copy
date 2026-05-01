// User activity routes:
//   - POST /api/activity/heartbeat       (any logged-in user; client pings every 60s)
//   - GET  /api/admin/bi/user-activity/* (superadmin; powers the dashboard)
//
// Mounted at /api/activity in index.tsx. The /api/admin/bi/* paths are
// also exposed here under the same router via the prefix mount.

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { validateAdminSession, requireSuperadmin } from './auth'
import { getCustomerSessionToken, getAdminSessionToken } from '../lib/session-tokens'
import { trackActivity, closeStaleVisits, ACTIVITY_MODULES } from '../services/activity-tracker'

export const activityRoutes = new Hono<{ Bindings: Bindings }>()

// ─────────────────────────────────────────────────────────────────────
// HEARTBEAT — called by activity-heartbeat.js every 60s while tab visible
// ─────────────────────────────────────────────────────────────────────

activityRoutes.post('/heartbeat', async (c) => {
  let path: string = '/'
  try {
    const body = await c.req.json<{ path?: string }>().catch(() => ({}))
    path = (body?.path || '/').toString().slice(0, 512)
  } catch {}

  // Try admin first (cookie or bearer), fall back to customer.
  let userType: 'admin' | 'customer' | null = null
  let userId: number | null = null

  const adminToken = getAdminSessionToken(c)
  if (adminToken) {
    const admin = await validateAdminSession(
      c.env.DB,
      c.req.header('Authorization'),
      c.req.header('Cookie'),
    )
    if (admin) {
      userType = 'admin'
      userId = admin.id
    }
  }

  if (!userType) {
    const custToken = getCustomerSessionToken(c)
    if (custToken) {
      const row = await c.env.DB.prepare(
        `SELECT customer_id FROM customer_sessions
         WHERE session_token = ? AND expires_at > datetime('now')`,
      ).bind(custToken).first<{ customer_id: number }>()
      if (row?.customer_id) {
        userType = 'customer'
        userId = row.customer_id
      }
    }
  }

  if (!userType || !userId) {
    return c.body(null, 204)
  }

  // Fire-and-forget through executionCtx if available, otherwise inline.
  const ip = c.req.header('CF-Connecting-IP') || null
  const ua = c.req.header('User-Agent') || null
  const job = trackActivity(c.env, { userType, userId, path, ip, ua })
  // @ts-ignore — executionCtx exists on Cloudflare Workers runtime
  if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(job)
  else await job

  // Raw path-event log — only insert on path change (not every 60s heartbeat),
  // so the Activity Log shows true navigation, not duplicate ticks.
  try {
    const last = await c.env.DB.prepare(
      `SELECT path FROM user_path_events
       WHERE user_type = ? AND user_id = ?
       ORDER BY id DESC LIMIT 1`,
    ).bind(userType, userId).first<{ path: string }>()
    if (!last || last.path !== path) {
      const insertJob = c.env.DB.prepare(
        `INSERT INTO user_path_events (user_type, user_id, path, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(userType, userId, path, ip, ua).run()
      // @ts-ignore — executionCtx exists on Cloudflare Workers runtime
      if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(insertJob)
      else await insertJob
    }
  } catch {}

  return c.body(null, 204)
})

// ─────────────────────────────────────────────────────────────────────
// SUPER-ADMIN AUTH GUARD — applies to every /admin-bi/* below
// ─────────────────────────────────────────────────────────────────────

async function requireSuperadminGuard(c: any) {
  const admin = await validateAdminSession(
    c.env.DB,
    c.req.header('Authorization'),
    c.req.header('Cookie'),
  )
  if (!admin || !requireSuperadmin(admin)) {
    return c.json({ error: 'Superadmin required' }, 403)
  }
  c.set('admin', admin)
  return null
}

function periodToCutoff(period: string): string {
  const days = period === '24h' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 7
  return `datetime('now', '-${days} days')`
}

// ─────────────────────────────────────────────────────────────────────
// SUMMARY — top users by total time + module breakdown
// ─────────────────────────────────────────────────────────────────────

activityRoutes.get('/summary', async (c) => {
  const blocked = await requireSuperadminGuard(c)
  if (blocked) return blocked

  const period = c.req.query('period') || '7d'
  const userTypeFilter = c.req.query('userType') || 'all'
  const cutoff = periodToCutoff(period)

  try {
    // Flush any stale active_visits first so totals reflect ongoing activity.
    await closeStaleVisits(c.env)

    const userTypeClause = userTypeFilter === 'admin'
      ? `AND user_type = 'admin'`
      : userTypeFilter === 'customer'
        ? `AND user_type = 'customer'`
        : ''

    // Per-user totals + visit count.
    const totalsRes = await c.env.DB.prepare(
      `SELECT user_type, user_id,
              SUM(duration_seconds) AS total_seconds,
              COUNT(*) AS visit_count,
              SUM(request_count) AS request_count,
              MAX(ended_at) AS last_seen
       FROM user_module_visits
       WHERE started_at >= ${cutoff} ${userTypeClause}
       GROUP BY user_type, user_id
       ORDER BY total_seconds DESC
       LIMIT 50`,
    ).all<any>()

    const totals = totalsRes?.results || []
    if (!totals.length) {
      return c.json({ users: [], modules: [], kpis: { active_users: 0, total_hours: 0, total_visits: 0, live_now: 0 } })
    }

    // Per-user-per-module breakdown for the same set of users (so we can
    // tag each user with their top module + small chart).
    const userKeys = totals.map((t: any) => `('${t.user_type}',${t.user_id})`).join(',')
    const breakdownRes = await c.env.DB.prepare(
      `SELECT user_type, user_id, module, SUM(duration_seconds) AS seconds
       FROM user_module_visits
       WHERE started_at >= ${cutoff}
         AND (user_type, user_id) IN (VALUES ${userKeys})
       GROUP BY user_type, user_id, module`,
    ).all<any>()

    const byUser = new Map<string, Record<string, number>>()
    for (const r of (breakdownRes?.results || []) as any[]) {
      const k = `${r.user_type}:${r.user_id}`
      if (!byUser.has(k)) byUser.set(k, {})
      byUser.get(k)![r.module] = r.seconds
    }

    // Hydrate names + emails.
    const adminIds = totals.filter((t: any) => t.user_type === 'admin').map((t: any) => t.user_id)
    const custIds = totals.filter((t: any) => t.user_type === 'customer').map((t: any) => t.user_id)

    const adminMap = new Map<number, any>()
    if (adminIds.length) {
      const rs = await c.env.DB.prepare(
        `SELECT id, email, name, role FROM admin_users WHERE id IN (${adminIds.map(() => '?').join(',')})`,
      ).bind(...adminIds).all<any>()
      for (const r of (rs?.results || []) as any[]) adminMap.set(r.id, r)
    }
    const custMap = new Map<number, any>()
    if (custIds.length) {
      const rs = await c.env.DB.prepare(
        `SELECT id, email, name, company_name FROM customers WHERE id IN (${custIds.map(() => '?').join(',')})`,
      ).bind(...custIds).all<any>()
      for (const r of (rs?.results || []) as any[]) custMap.set(r.id, r)
    }

    const users = totals.map((t: any) => {
      const k = `${t.user_type}:${t.user_id}`
      const breakdown = byUser.get(k) || {}
      let topMod = 'other', topSec = 0
      for (const [m, s] of Object.entries(breakdown)) {
        if ((s as number) > topSec) { topMod = m; topSec = s as number }
      }
      const profile = t.user_type === 'admin' ? adminMap.get(t.user_id) : custMap.get(t.user_id)
      return {
        user_type: t.user_type,
        user_id: t.user_id,
        name: profile?.name || '(unknown)',
        email: profile?.email || '',
        company: profile?.company_name || profile?.role || '',
        total_seconds: t.total_seconds || 0,
        visit_count: t.visit_count || 0,
        request_count: t.request_count || 0,
        last_seen: t.last_seen,
        top_module: topMod,
        modules: breakdown,
      }
    })

    // Module-wide totals across the whole filtered window.
    const modulesRes = await c.env.DB.prepare(
      `SELECT module, SUM(duration_seconds) AS seconds, COUNT(*) AS visits
       FROM user_module_visits
       WHERE started_at >= ${cutoff} ${userTypeClause}
       GROUP BY module
       ORDER BY seconds DESC`,
    ).all<any>()
    const modules = modulesRes?.results || []

    // Live-now count: rows currently fresh in active_visits.
    const liveRes = await c.env.DB.prepare(
      `SELECT COUNT(DISTINCT user_type || ':' || user_id) AS n
       FROM active_visits
       WHERE last_seen_at >= datetime('now', '-2 minutes')
         ${userTypeFilter === 'admin' ? "AND user_type = 'admin'" : userTypeFilter === 'customer' ? "AND user_type = 'customer'" : ''}`,
    ).first<{ n: number }>()

    const totalSeconds = users.reduce((a, u) => a + (u.total_seconds || 0), 0)
    const totalVisits = users.reduce((a, u) => a + (u.visit_count || 0), 0)

    return c.json({
      period,
      user_type: userTypeFilter,
      kpis: {
        active_users: users.length,
        total_hours: +(totalSeconds / 3600).toFixed(1),
        total_visits: totalVisits,
        live_now: liveRes?.n || 0,
      },
      users,
      modules,
    })
  } catch (err: any) {
    return c.json({ error: 'Failed to load activity summary', details: err.message }, 500)
  }
})

// ─────────────────────────────────────────────────────────────────────
// USER DRILL-IN — daily timeline + module pie + recent visits for one user
// ─────────────────────────────────────────────────────────────────────

activityRoutes.get('/user/:userType/:userId', async (c) => {
  const blocked = await requireSuperadminGuard(c)
  if (blocked) return blocked

  const userType = c.req.param('userType')
  const userId = parseInt(c.req.param('userId'), 10)
  if ((userType !== 'admin' && userType !== 'customer') || !userId) {
    return c.json({ error: 'Invalid user reference' }, 400)
  }
  const period = c.req.query('period') || '30d'
  const cutoff = periodToCutoff(period)

  try {
    // Identity.
    let profile: any = null
    if (userType === 'admin') {
      profile = await c.env.DB.prepare(
        `SELECT id, email, name, role, company_name, last_login, created_at FROM admin_users WHERE id = ?`,
      ).bind(userId).first<any>()
    } else {
      profile = await c.env.DB.prepare(
        `SELECT id, email, name, company_name, last_login, created_at FROM customers WHERE id = ?`,
      ).bind(userId).first<any>()
    }

    // Daily timeline (totals per day).
    const dailyRes = await c.env.DB.prepare(
      `SELECT date(started_at) AS day,
              SUM(duration_seconds) AS seconds,
              COUNT(*) AS visits
       FROM user_module_visits
       WHERE user_type = ? AND user_id = ? AND started_at >= ${cutoff}
       GROUP BY day
       ORDER BY day ASC`,
    ).bind(userType, userId).all<any>()

    // Per-module breakdown.
    const modRes = await c.env.DB.prepare(
      `SELECT module,
              SUM(duration_seconds) AS seconds,
              COUNT(*) AS visits
       FROM user_module_visits
       WHERE user_type = ? AND user_id = ? AND started_at >= ${cutoff}
       GROUP BY module
       ORDER BY seconds DESC`,
    ).bind(userType, userId).all<any>()

    // Recent visits feed.
    const recentRes = await c.env.DB.prepare(
      `SELECT module, started_at, ended_at, duration_seconds, request_count
       FROM user_module_visits
       WHERE user_type = ? AND user_id = ?
       ORDER BY started_at DESC
       LIMIT 25`,
    ).bind(userType, userId).all<any>()

    const total = (modRes?.results || []).reduce((a: number, m: any) => a + (m.seconds || 0), 0)

    return c.json({
      profile,
      user_type: userType,
      user_id: userId,
      period,
      total_seconds: total,
      daily: dailyRes?.results || [],
      modules: modRes?.results || [],
      recent: recentRes?.results || [],
    })
  } catch (err: any) {
    return c.json({ error: 'Failed to load user activity', details: err.message }, 500)
  }
})

// ─────────────────────────────────────────────────────────────────────
// EVENTS — raw per-path event feed (every page a user opens)
// ─────────────────────────────────────────────────────────────────────

activityRoutes.get('/events', async (c) => {
  const blocked = await requireSuperadminGuard(c)
  if (blocked) return blocked

  const period = c.req.query('period') || '7d'
  const cutoff = periodToCutoff(period)
  const userType = c.req.query('userType') || ''
  const userId = parseInt(c.req.query('userId') || '0', 10)
  const search = (c.req.query('search') || '').trim()
  const limit = Math.min(parseInt(c.req.query('limit') || '200', 10), 1000)
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10), 0)

  const where: string[] = [`occurred_at >= ${cutoff}`]
  const args: any[] = []
  if (userType === 'admin' || userType === 'customer') {
    where.push('user_type = ?')
    args.push(userType)
  }
  if (userId > 0) {
    where.push('user_id = ?')
    args.push(userId)
  }
  if (search) {
    where.push('path LIKE ?')
    args.push('%' + search + '%')
  }

  try {
    const rs = await c.env.DB.prepare(
      `SELECT id, user_type, user_id, path, occurred_at, ip_address
       FROM user_path_events
       WHERE ${where.join(' AND ')}
       ORDER BY occurred_at DESC
       LIMIT ? OFFSET ?`,
    ).bind(...args, limit, offset).all<any>()

    const rows = (rs?.results || []) as any[]

    // Resolve names for each (type,id) pair in one shot.
    const adminIds = Array.from(new Set(rows.filter(r => r.user_type === 'admin').map(r => r.user_id)))
    const custIds = Array.from(new Set(rows.filter(r => r.user_type === 'customer').map(r => r.user_id)))
    const adminMap = new Map<number, any>()
    const custMap = new Map<number, any>()
    if (adminIds.length) {
      const ph = adminIds.map(() => '?').join(',')
      const ar = await c.env.DB.prepare(`SELECT id, email, name FROM admin_users WHERE id IN (${ph})`).bind(...adminIds).all<any>()
        ; (ar?.results || []).forEach((u: any) => adminMap.set(u.id, u))
    }
    if (custIds.length) {
      const ph = custIds.map(() => '?').join(',')
      const cr = await c.env.DB.prepare(`SELECT id, email, name FROM customers WHERE id IN (${ph})`).bind(...custIds).all<any>()
        ; (cr?.results || []).forEach((u: any) => custMap.set(u.id, u))
    }

    const events = rows.map(r => {
      const profile = r.user_type === 'admin' ? adminMap.get(r.user_id) : custMap.get(r.user_id)
      return {
        ...r,
        name: profile?.name || null,
        email: profile?.email || null,
      }
    })

    const totalRow = await c.env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM user_path_events WHERE ${where.join(' AND ')}`,
    ).bind(...args).first<{ cnt: number }>()

    return c.json({
      events,
      total: totalRow?.cnt || 0,
      limit,
      offset,
    })
  } catch (err: any) {
    return c.json({ error: 'Failed to load events', details: err.message }, 500)
  }
})

// ─────────────────────────────────────────────────────────────────────
// MODULES — aggregate across all users
// ─────────────────────────────────────────────────────────────────────

activityRoutes.get('/modules', async (c) => {
  const blocked = await requireSuperadminGuard(c)
  if (blocked) return blocked

  const period = c.req.query('period') || '30d'
  const cutoff = periodToCutoff(period)

  try {
    const rs = await c.env.DB.prepare(
      `SELECT module,
              SUM(duration_seconds) AS seconds,
              COUNT(DISTINCT user_type || ':' || user_id) AS users,
              COUNT(*) AS visits
       FROM user_module_visits
       WHERE started_at >= ${cutoff}
       GROUP BY module
       ORDER BY seconds DESC`,
    ).all<any>()

    return c.json({ period, modules: rs?.results || [], known_modules: ACTIVITY_MODULES })
  } catch (err: any) {
    return c.json({ error: 'Failed to load modules', details: err.message }, 500)
  }
})

// ─────────────────────────────────────────────────────────────────────
// LIVE — currently active users (rows in active_visits within 2 min)
// ─────────────────────────────────────────────────────────────────────

activityRoutes.get('/live', async (c) => {
  const blocked = await requireSuperadminGuard(c)
  if (blocked) return blocked

  try {
    const rs = await c.env.DB.prepare(
      `SELECT av.user_type, av.user_id, av.module,
              av.started_at, av.last_seen_at, av.request_count
       FROM active_visits av
       WHERE last_seen_at >= datetime('now', '-2 minutes')
       ORDER BY last_seen_at DESC
       LIMIT 100`,
    ).all<any>()

    const rows = rs?.results || []
    const adminIds = rows.filter((r: any) => r.user_type === 'admin').map((r: any) => r.user_id)
    const custIds = rows.filter((r: any) => r.user_type === 'customer').map((r: any) => r.user_id)

    const adminMap = new Map<number, any>()
    if (adminIds.length) {
      const a = await c.env.DB.prepare(
        `SELECT id, email, name FROM admin_users WHERE id IN (${adminIds.map(() => '?').join(',')})`,
      ).bind(...adminIds).all<any>()
      for (const r of (a?.results || []) as any[]) adminMap.set(r.id, r)
    }
    const custMap = new Map<number, any>()
    if (custIds.length) {
      const a = await c.env.DB.prepare(
        `SELECT id, email, name, company_name FROM customers WHERE id IN (${custIds.map(() => '?').join(',')})`,
      ).bind(...custIds).all<any>()
      for (const r of (a?.results || []) as any[]) custMap.set(r.id, r)
    }

    const live = rows.map((r: any) => {
      const profile = r.user_type === 'admin' ? adminMap.get(r.user_id) : custMap.get(r.user_id)
      return {
        ...r,
        name: profile?.name || '(unknown)',
        email: profile?.email || '',
        company: profile?.company_name || '',
      }
    })

    return c.json({ live })
  } catch (err: any) {
    return c.json({ error: 'Failed to load live activity', details: err.message }, 500)
  }
})
