// ============================================================
// Customer API Connections — outbound CRM webhook config
// Lets a B2B customer register endpoints (AccuLynx, JobNimbus,
// Roofr, custom) that receive a JSON payload on every finalized
// report. Connections are scoped to the account owner so team
// members share the same set.
// ============================================================

import type { Context } from 'hono'
import { Hono } from 'hono'
import type { Bindings, AppEnv } from '../types'
import { resolveTeamOwner } from './team'
import {
  encryptApiKey,
  isSafeOutboundUrl,
  testCRMConnection,
} from '../services/external-crm-dispatch'

export const customerApiConnectionsRoutes = new Hono<AppEnv>()

// ── Auth: resolve session → account owner (shared across team) ─────────

async function getOwnerId(c: Context<AppEnv>): Promise<{ ownerId: number; userId: number } | null> {
  const auth = c.req.header('Authorization')
  let token = ''
  if (auth?.startsWith('Bearer ')) token = auth.slice(7)
  if (!token) {
    // Cookie fallback for fetch from same-origin pages
    const ck = c.req.header('Cookie') || ''
    const m = ck.match(/rm_customer_session=([^;]+)/)
    if (m) token = decodeURIComponent(m[1])
  }
  if (!token) return null
  const session = await c.env.DB.prepare(
    "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
  ).bind(token).first<any>()
  if (!session) return null
  const { ownerId } = await resolveTeamOwner(c.env.DB, session.customer_id)
  return { ownerId, userId: session.customer_id }
}

// ── Helpers ────────────────────────────────────────────────────────────

const ALLOWED_PROVIDERS = new Set(['acculynx', 'jobnimbus', 'roofr', 'custom'])

function sanitizeName(s: any): string {
  return String(s ?? '').trim().slice(0, 80)
}

function sanitizeProvider(s: any): string {
  const v = String(s ?? 'custom').toLowerCase().trim()
  return ALLOWED_PROVIDERS.has(v) ? v : 'custom'
}

function sanitizeAuthHeader(s: any): string {
  const v = String(s ?? 'Authorization').trim().slice(0, 64)
  return /^[A-Za-z0-9_-]+$/.test(v) ? v : 'Authorization'
}

function sanitizeAuthPrefix(s: any): string {
  return String(s ?? 'Bearer ').slice(0, 32)
}

// ── GET / — list connections for owner ─────────────────────────────────

customerApiConnectionsRoutes.get('/', async (c) => {
  const auth = await getOwnerId(c)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)
  const rows = await c.env.DB.prepare(
    `SELECT id, name, provider, endpoint_url, api_key_hint, auth_header, auth_prefix, enabled, created_at, updated_at
     FROM customer_api_connections WHERE customer_id = ? ORDER BY created_at DESC`
  ).bind(auth.ownerId).all<any>()
  return c.json({ connections: rows.results || [] })
})

// ── POST / — create connection ─────────────────────────────────────────

customerApiConnectionsRoutes.post('/', async (c) => {
  const auth = await getOwnerId(c)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)

  const body = await c.req.json().catch(() => ({})) as any
  const name = sanitizeName(body.name)
  const provider = sanitizeProvider(body.provider)
  const endpoint_url = String(body.endpoint_url ?? '').trim()
  const api_key = String(body.api_key ?? '').trim()
  const auth_header = sanitizeAuthHeader(body.auth_header)
  const auth_prefix = sanitizeAuthPrefix(body.auth_prefix ?? 'Bearer ')

  if (!name) return c.json({ error: 'name required' }, 400)
  if (!api_key) return c.json({ error: 'api_key required' }, 400)
  const urlCheck = isSafeOutboundUrl(endpoint_url)
  if (!urlCheck.ok) return c.json({ error: `endpoint_url invalid: ${urlCheck.reason}` }, 400)
  if (api_key.length > 4096) return c.json({ error: 'api_key too long' }, 400)

  const { cipher, iv, hint } = await encryptApiKey(c.env.JWT_SECRET, api_key)

  const ins = await c.env.DB.prepare(
    `INSERT INTO customer_api_connections
       (customer_id, name, provider, endpoint_url, api_key_cipher, api_key_iv, api_key_hint, auth_header, auth_prefix, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).bind(auth.ownerId, name, provider, endpoint_url, cipher, iv, hint, auth_header, auth_prefix).run()

  return c.json({ success: true, id: Number(ins.meta?.last_row_id) || null })
})

// ── PUT /:id — update connection ──────────────────────────────────────

customerApiConnectionsRoutes.put('/:id', async (c) => {
  const auth = await getOwnerId(c)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)
  const id = Number(c.req.param('id'))
  if (!id) return c.json({ error: 'invalid id' }, 400)

  const existing = await c.env.DB.prepare(
    `SELECT id FROM customer_api_connections WHERE id = ? AND customer_id = ?`
  ).bind(id, auth.ownerId).first<any>()
  if (!existing) return c.json({ error: 'not found' }, 404)

  const body = await c.req.json().catch(() => ({})) as any
  const sets: string[] = []
  const vals: any[] = []

  if (typeof body.name === 'string') {
    const v = sanitizeName(body.name)
    if (!v) return c.json({ error: 'name cannot be empty' }, 400)
    sets.push('name = ?'); vals.push(v)
  }
  if (typeof body.provider === 'string') {
    sets.push('provider = ?'); vals.push(sanitizeProvider(body.provider))
  }
  if (typeof body.endpoint_url === 'string') {
    const v = body.endpoint_url.trim()
    const chk = isSafeOutboundUrl(v)
    if (!chk.ok) return c.json({ error: `endpoint_url invalid: ${chk.reason}` }, 400)
    sets.push('endpoint_url = ?'); vals.push(v)
  }
  if (typeof body.auth_header === 'string') {
    sets.push('auth_header = ?'); vals.push(sanitizeAuthHeader(body.auth_header))
  }
  if (typeof body.auth_prefix === 'string') {
    sets.push('auth_prefix = ?'); vals.push(sanitizeAuthPrefix(body.auth_prefix))
  }
  if (typeof body.enabled === 'boolean' || body.enabled === 0 || body.enabled === 1) {
    sets.push('enabled = ?'); vals.push(body.enabled ? 1 : 0)
  }
  if (typeof body.api_key === 'string' && body.api_key.trim().length > 0) {
    const k = body.api_key.trim()
    if (k.length > 4096) return c.json({ error: 'api_key too long' }, 400)
    const { cipher, iv, hint } = await encryptApiKey(c.env.JWT_SECRET, k)
    sets.push('api_key_cipher = ?'); vals.push(cipher)
    sets.push('api_key_iv = ?'); vals.push(iv)
    sets.push('api_key_hint = ?'); vals.push(hint)
  }

  if (sets.length === 0) return c.json({ success: true, noop: true })

  sets.push("updated_at = datetime('now')")
  vals.push(id, auth.ownerId)

  await c.env.DB.prepare(
    `UPDATE customer_api_connections SET ${sets.join(', ')} WHERE id = ? AND customer_id = ?`
  ).bind(...vals).run()

  return c.json({ success: true })
})

// ── DELETE /:id — soft-delete (sets enabled=0) ────────────────────────

customerApiConnectionsRoutes.delete('/:id', async (c) => {
  const auth = await getOwnerId(c)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)
  const id = Number(c.req.param('id'))
  if (!id) return c.json({ error: 'invalid id' }, 400)
  const res = await c.env.DB.prepare(
    `DELETE FROM customer_api_connections WHERE id = ? AND customer_id = ?`
  ).bind(id, auth.ownerId).run()
  return c.json({ success: true, removed: res.meta?.changes || 0 })
})

// ── POST /:id/test — fire a test ping ─────────────────────────────────

customerApiConnectionsRoutes.post('/:id/test', async (c) => {
  const auth = await getOwnerId(c)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)
  const id = Number(c.req.param('id'))
  if (!id) return c.json({ error: 'invalid id' }, 400)
  try {
    const r = await testCRMConnection(c.env, id, auth.ownerId)
    return c.json(r)
  } catch (err: any) {
    return c.json({ ok: false, error: err?.message || 'Test failed', durationMs: 0 }, 500)
  }
})

// ── GET /:id/deliveries — recent delivery audit log ───────────────────

customerApiConnectionsRoutes.get('/:id/deliveries', async (c) => {
  const auth = await getOwnerId(c)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)
  const id = Number(c.req.param('id'))
  if (!id) return c.json({ error: 'invalid id' }, 400)

  const own = await c.env.DB.prepare(
    `SELECT id FROM customer_api_connections WHERE id = ? AND customer_id = ?`
  ).bind(id, auth.ownerId).first<any>()
  if (!own) return c.json({ error: 'not found' }, 404)

  const rows = await c.env.DB.prepare(
    `SELECT id, order_id, status, http_status, attempts, last_attempt_at, delivered_at, error_message, created_at
     FROM customer_api_deliveries WHERE connection_id = ? ORDER BY created_at DESC LIMIT 50`
  ).bind(id).all<any>()
  return c.json({ deliveries: rows.results || [] })
})
