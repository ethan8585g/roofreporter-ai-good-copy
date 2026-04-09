// ============================================================
// Push Notification Subscription & Delivery Routes
// ============================================================
// Endpoints for registering/unregistering push subscriptions
// (both FCM device tokens for native iOS and Web Push for browsers)
// and sending test notifications.
// ============================================================

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { validateAdminSession } from './auth'
import { sendPushToUser } from '../services/push-service'

export const pushRoutes = new Hono<{ Bindings: Bindings }>()

// ============================================================
// Helper: Resolve user from either admin or customer auth
// ============================================================
async function resolveUser(db: D1Database, authHeader: string | undefined): Promise<{ userType: 'admin' | 'customer'; userId: number } | null> {
  if (!authHeader) return null
  const token = authHeader.replace('Bearer ', '')
  if (!token) return null

  // Try admin auth first
  const admin = await validateAdminSession(db, authHeader)
  if (admin) return { userType: 'admin', userId: (admin as any).id }

  // Try customer auth
  try {
    const row = await db.prepare(
      "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
    ).bind(token).first<{ customer_id: number }>()
    if (row) return { userType: 'customer', userId: row.customer_id }
  } catch {}

  return null
}

// ============================================================
// GET /vapid-key — Return public VAPID key (no auth required)
// ============================================================
pushRoutes.get('/vapid-key', async (c) => {
  const publicKey = c.env.VAPID_PUBLIC_KEY
  if (!publicKey) return c.json({ error: 'Push notifications not configured' }, 503)
  return c.json({ publicKey })
})

// ============================================================
// POST /subscribe — Register a device for push notifications
// ============================================================
pushRoutes.post('/subscribe', async (c) => {
  try {
    const user = await resolveUser(c.env.DB, c.req.header('Authorization'))
    if (!user) return c.json({ error: 'Authentication required' }, 401)

    const body = await c.req.json() as any
    const platform = body.platform // 'ios', 'web', 'android'

    if (!platform) return c.json({ error: 'platform is required' }, 400)

    const db = c.env.DB

    if (platform === 'web') {
      // Web Push subscription
      const subscription = body.subscription
      if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        return c.json({ error: 'Web push subscription object with endpoint and keys required' }, 400)
      }

      // Upsert: if endpoint exists, update; otherwise insert
      const existing = await db.prepare(
        'SELECT id FROM push_subscriptions WHERE endpoint = ?'
      ).bind(subscription.endpoint).first<{ id: number }>()

      if (existing) {
        await db.prepare(
          'UPDATE push_subscriptions SET user_type = ?, user_id = ?, p256dh_key = ?, auth_key = ?, device_name = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).bind(user.userType, user.userId, subscription.keys.p256dh, subscription.keys.auth, body.device_name || '', existing.id).run()
        return c.json({ success: true, subscription_id: existing.id })
      }

      const result = await db.prepare(
        'INSERT INTO push_subscriptions (user_type, user_id, platform, endpoint, p256dh_key, auth_key, device_name) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(user.userType, user.userId, 'web', subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, body.device_name || '').run()

      return c.json({ success: true, subscription_id: result.meta?.last_row_id })

    } else if (platform === 'ios' || platform === 'android') {
      // FCM token (from Capacitor Push Notifications plugin)
      const fcmToken = body.fcm_token
      if (!fcmToken) return c.json({ error: 'fcm_token is required for native platform' }, 400)

      const existing = await db.prepare(
        'SELECT id FROM push_subscriptions WHERE fcm_token = ?'
      ).bind(fcmToken).first<{ id: number }>()

      if (existing) {
        await db.prepare(
          'UPDATE push_subscriptions SET user_type = ?, user_id = ?, platform = ?, device_name = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).bind(user.userType, user.userId, platform, body.device_name || '', existing.id).run()
        return c.json({ success: true, subscription_id: existing.id })
      }

      const result = await db.prepare(
        'INSERT INTO push_subscriptions (user_type, user_id, platform, fcm_token, device_name) VALUES (?, ?, ?, ?, ?)'
      ).bind(user.userType, user.userId, platform, fcmToken, body.device_name || '').run()

      return c.json({ success: true, subscription_id: result.meta?.last_row_id })

    } else {
      return c.json({ error: 'Invalid platform. Must be ios, android, or web' }, 400)
    }
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ============================================================
// DELETE /subscribe — Unsubscribe a device
// ============================================================
pushRoutes.delete('/subscribe', async (c) => {
  try {
    const user = await resolveUser(c.env.DB, c.req.header('Authorization'))
    if (!user) return c.json({ error: 'Authentication required' }, 401)

    const body = await c.req.json() as any
    const db = c.env.DB

    if (body.fcm_token) {
      await db.prepare(
        'UPDATE push_subscriptions SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE fcm_token = ? AND user_type = ? AND user_id = ?'
      ).bind(body.fcm_token, user.userType, user.userId).run()
    } else if (body.endpoint) {
      await db.prepare(
        'UPDATE push_subscriptions SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE endpoint = ? AND user_type = ? AND user_id = ?'
      ).bind(body.endpoint, user.userType, user.userId).run()
    } else {
      return c.json({ error: 'fcm_token or endpoint required' }, 400)
    }

    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ============================================================
// GET /subscriptions — List user's registered devices
// ============================================================
pushRoutes.get('/subscriptions', async (c) => {
  try {
    const user = await resolveUser(c.env.DB, c.req.header('Authorization'))
    if (!user) return c.json({ error: 'Authentication required' }, 401)

    const subs = await c.env.DB.prepare(
      'SELECT id, platform, device_name, is_active, created_at, updated_at FROM push_subscriptions WHERE user_type = ? AND user_id = ? ORDER BY updated_at DESC'
    ).bind(user.userType, user.userId).all()

    return c.json({ subscriptions: subs.results })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ============================================================
// POST /test — Send a test push notification (admin only)
// ============================================================
pushRoutes.post('/test', async (c) => {
  try {
    const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
    if (!admin) return c.json({ error: 'Admin authentication required' }, 401)

    const result = await sendPushToUser(c.env.DB, c.env, 'admin', (admin as any).id, {
      title: 'Roof Manager',
      body: 'Push notifications are working! You will receive alerts for new leads, proposals, payments, and more.',
      link: '/admin',
      type: 'test',
      tag: 'test'
    })

    return c.json({ success: true, ...result })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})
