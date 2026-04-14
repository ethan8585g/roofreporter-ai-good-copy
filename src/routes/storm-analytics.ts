// ============================================================
// Storm Scout analytics — event intake + ROI summary
// ============================================================
import { Hono } from 'hono'
import type { Bindings } from '../types'

export const stormAnalyticsRoutes = new Hono<{ Bindings: Bindings }>()

const ALLOWED_EVENTS = new Set([
  'map_open', 'alert_view', 'match_click', 'before_after_open',
  'territory_create', 'match_sent', 'lead_created_from_storm',
  'layer_toggle', 'history_load'
])

async function requireCustomer(c: any): Promise<number | null> {
  const auth = c.req.header('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const session = await c.env.DB.prepare(
    "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
  ).bind(token).first<any>()
  return session?.customer_id ?? null
}

stormAnalyticsRoutes.post('/event', async (c) => {
  const customerId = await requireCustomer(c)
  if (!customerId) return c.json({ error: 'Not authenticated' }, 401)
  const body = await c.req.json<any>().catch(() => null)
  if (!body) return c.json({ error: 'Invalid JSON' }, 400)
  const evt = String(body.event_type || '')
  if (!ALLOWED_EVENTS.has(evt)) return c.json({ error: 'Unknown event_type' }, 400)
  const meta = body.meta != null ? JSON.stringify(body.meta).slice(0, 2000) : null
  await c.env.DB.prepare(
    'INSERT INTO storm_scout_events (customer_id, event_type, meta_json) VALUES (?, ?, ?)'
  ).bind(customerId, evt, meta).run()
  return c.json({ ok: true })
})

stormAnalyticsRoutes.get('/summary', async (c) => {
  const customerId = await requireCustomer(c)
  if (!customerId) return c.json({ error: 'Not authenticated' }, 401)
  const days = Math.max(1, Math.min(365, parseInt(c.req.query('days') || '30', 10)))
  const since = `datetime('now', '-${days} days')`

  const countsRs = await c.env.DB.prepare(
    `SELECT event_type, COUNT(*) AS n
       FROM storm_scout_events
      WHERE customer_id = ? AND created_at >= ${since}
      GROUP BY event_type`
  ).bind(customerId).all<any>()
  const counts: Record<string, number> = {}
  for (const row of (countsRs.results || [])) counts[row.event_type] = Number(row.n) || 0

  // DAU across the window
  const dauRs = await c.env.DB.prepare(
    `SELECT COUNT(DISTINCT date(created_at)) AS days_active
       FROM storm_scout_events
      WHERE customer_id = ? AND created_at >= ${since} AND event_type = 'map_open'`
  ).bind(customerId).first<any>()

  // Territory + notification totals for context
  const terr = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM storm_service_areas WHERE customer_id = ? AND is_active = 1'
  ).bind(customerId).first<any>()
  const notifRs = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM storm_notifications
      WHERE customer_id = ? AND matched_at >= ${since}`
  ).bind(customerId).first<any>()

  // Optional avg_job_value lookup from customers — tolerate missing column
  let avgJobValue = 0
  try {
    const c1 = await c.env.DB.prepare('SELECT avg_job_value FROM customers WHERE id = ?').bind(customerId).first<any>()
    if (c1?.avg_job_value && Number.isFinite(Number(c1.avg_job_value))) avgJobValue = Number(c1.avg_job_value)
  } catch { /* column may not exist yet */ }
  if (!avgJobValue) avgJobValue = 8500 // conservative default

  const leadsFromStorm = counts['lead_created_from_storm'] || 0
  const estimatedRevenue = leadsFromStorm * avgJobValue

  return c.json({
    days,
    kpis: {
      map_opens: counts['map_open'] || 0,
      alert_views: counts['alert_view'] || 0,
      match_clicks: counts['match_click'] || 0,
      before_after_opens: counts['before_after_open'] || 0,
      territory_creates: counts['territory_create'] || 0,
      matches_sent: counts['match_sent'] || 0,
      leads_from_storm: leadsFromStorm,
      days_active: Number(dauRs?.days_active) || 0,
      territories_active: Number(terr?.n) || 0,
      notifications_total: Number(notifRs?.n) || 0
    },
    revenue: {
      avg_job_value: avgJobValue,
      estimated_from_storm_scout: estimatedRevenue,
      note: 'Based on matched alerts that converted into leads tagged from Storm Scout.'
    }
  })
})
