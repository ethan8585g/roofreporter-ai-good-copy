// ============================================================
// Push subscription management — browser/Capacitor registers here.
// ============================================================
import type { Context } from 'hono'
import { Hono } from 'hono'
import type { Bindings, AppEnv } from '../types'
import { sendWebPush, getVapidFromEnv } from '../services/web-push'

export const pushRoutes = new Hono<AppEnv>()

async function requireCustomer(c: Context<AppEnv>): Promise<number | null> {
  const auth = c.req.header('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const session = await c.env.DB.prepare(
    "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
  ).bind(token).first<any>()
  return session?.customer_id ?? null
}

pushRoutes.get('/vapid-public-key', (c) => {
  const key = (c.env as any).VAPID_PUBLIC_KEY || ''
  if (!key) return c.json({ error: 'Push not configured' }, 503)
  return c.json({ publicKey: key })
})

pushRoutes.post('/subscribe', async (c) => {
  const customerId = await requireCustomer(c)
  if (!customerId) return c.json({ error: 'Not authenticated' }, 401)
  const body = await c.req.json<any>().catch(() => null)
  const endpoint = body?.endpoint, p256dh = body?.keys?.p256dh, auth = body?.keys?.auth
  if (!endpoint || !p256dh || !auth) return c.json({ error: 'Bad subscription' }, 400)
  const ua = c.req.header('User-Agent') || ''

  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (customer_id, endpoint, keys_p256dh, keys_auth, user_agent, disabled)
     VALUES (?, ?, ?, ?, ?, 0)
     ON CONFLICT(endpoint) DO UPDATE SET
       customer_id = excluded.customer_id,
       keys_p256dh = excluded.keys_p256dh,
       keys_auth = excluded.keys_auth,
       user_agent = excluded.user_agent,
       last_seen = datetime('now'),
       disabled = 0`
  ).bind(customerId, endpoint, p256dh, auth, ua).run()

  return c.json({ ok: true })
})

pushRoutes.delete('/subscribe', async (c) => {
  const customerId = await requireCustomer(c)
  if (!customerId) return c.json({ error: 'Not authenticated' }, 401)
  const body = await c.req.json<any>().catch(() => null)
  const endpoint = body?.endpoint
  if (!endpoint) return c.json({ error: 'endpoint required' }, 400)
  await c.env.DB.prepare(
    'DELETE FROM push_subscriptions WHERE endpoint = ? AND customer_id = ?'
  ).bind(endpoint, customerId).run()
  return c.json({ ok: true })
})

pushRoutes.post('/test', async (c) => {
  const customerId = await requireCustomer(c)
  if (!customerId) return c.json({ error: 'Not authenticated' }, 401)
  const vapid = getVapidFromEnv(c.env as any)
  if (!vapid) return c.json({ error: 'Push not configured' }, 503)

  const subs = await c.env.DB.prepare(
    'SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions WHERE customer_id = ? AND disabled = 0'
  ).bind(customerId).all<any>()
  if (!subs.results?.length) return c.json({ error: 'No subscriptions' }, 404)

  const payload = { title: 'Storm Scout test', body: 'Push notifications are live.', url: '/customer/storm-scout' }
  const results = []
  for (const s of subs.results) {
    const r = await sendWebPush(s as any, payload, vapid).catch((e: any) => ({ ok: false, status: 0, body: e?.message }))
    results.push({ endpoint: s.endpoint.slice(0, 60) + '...', ...r })
    if (!r.ok && (r.status === 404 || r.status === 410)) {
      await c.env.DB.prepare('UPDATE push_subscriptions SET disabled = 1 WHERE endpoint = ?').bind(s.endpoint).run()
    }
  }
  return c.json({ ok: true, results })
})
