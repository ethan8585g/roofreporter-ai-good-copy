import { Hono } from 'hono'
import type { Bindings } from '../types'
import { getActiveAlerts } from '../services/storm-data'

export const stormScoutRoutes = new Hono<{ Bindings: Bindings }>()

async function requireCustomer(c: any): Promise<number | null> {
  const auth = c.req.header('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const session = await c.env.DB.prepare(
    "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
  ).bind(token).first<any>()
  return session?.customer_id ?? null
}

stormScoutRoutes.get('/alerts', async (c) => {
  const customerId = await requireCustomer(c)
  if (!customerId) return c.json({ error: 'Not authenticated' }, 401)

  try {
    const { events, cached, fetchedAt } = await getActiveAlerts()
    c.header('Cache-Control', 'public, max-age=300')
    return c.json({ alerts: events, cached, fetchedAt, count: events.length })
  } catch (err: any) {
    return c.json({ error: 'Failed to fetch alerts', detail: err?.message || String(err) }, 502)
  }
})

stormScoutRoutes.get('/health', (c) => c.json({ ok: true, service: 'storm-scout' }))
