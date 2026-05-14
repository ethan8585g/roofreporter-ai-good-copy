// ============================================================
// Storm Scout — Phase 3 CRUD for service areas + notifications feed
// ============================================================

import { Hono } from 'hono'
import type { Bindings, AppEnv } from '../types'
import type { ServiceArea, Ring } from '../services/storm-matcher'
import { requireCustomerId as requireCustomer } from '../lib/session-tokens'

export const stormAlertsRoutes = new Hono<AppEnv>()

function parsePolygon(raw: any): Ring | null {
  if (!Array.isArray(raw) || raw.length < 3) return null
  const ring: Ring = []
  for (const p of raw) {
    const lat = Number(p?.lat), lng = Number(p?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
    ring.push({ lat, lng })
  }
  return ring
}

function parseTypes(raw: any): string[] {
  const allowed = ['hail', 'wind', 'tornado', 'thunderstorm']
  if (!Array.isArray(raw)) return allowed
  const clean = raw.filter((t: any) => typeof t === 'string' && allowed.indexOf(t) >= 0)
  return clean.length ? clean : allowed
}

function rowToArea(row: any): ServiceArea {
  let poly: Ring = []
  try { poly = JSON.parse(row.polygon_geojson) } catch {}
  let types: string[] = ['hail', 'wind', 'tornado', 'thunderstorm']
  try { types = JSON.parse(row.types_json) } catch {}
  return {
    id: row.id,
    customer_id: row.customer_id,
    name: row.name,
    polygon: poly,
    min_hail_inches: Number(row.min_hail_inches) || 0,
    min_wind_kmh: Number(row.min_wind_kmh) || 0,
    types,
    notify_email: !!row.notify_email,
    notify_push: !!row.notify_push
  }
}

// ------------------------------------------------------------
// GET /areas — list customer's areas
// ------------------------------------------------------------
stormAlertsRoutes.get('/areas', async (c) => {
  const customerId = await requireCustomer(c)
  if (!customerId) return c.json({ error: 'Not authenticated' }, 401)

  const rows = await c.env.DB.prepare(
    'SELECT * FROM storm_service_areas WHERE customer_id = ? ORDER BY created_at DESC'
  ).bind(customerId).all<any>()
  const areas = (rows.results || []).map(rowToArea)
  return c.json({ areas })
})

// ------------------------------------------------------------
// POST /areas — create
// ------------------------------------------------------------
stormAlertsRoutes.post('/areas', async (c) => {
  const customerId = await requireCustomer(c)
  if (!customerId) return c.json({ error: 'Not authenticated' }, 401)

  const body = await c.req.json<any>().catch(() => null)
  if (!body) return c.json({ error: 'Invalid JSON' }, 400)
  const name = String(body.name || '').trim().slice(0, 80)
  if (!name) return c.json({ error: 'name required' }, 400)
  const polygon = parsePolygon(body.polygon)
  if (!polygon) return c.json({ error: 'polygon required (array of {lat,lng} ≥3 points)' }, 400)

  const minHail = Math.max(0, Math.min(5, Number(body.min_hail_inches) || 1))
  const minWind = Math.max(0, Math.min(300, Math.round(Number(body.min_wind_kmh) || 0)))
  const types = parseTypes(body.types)
  const email = body.notify_email !== false ? 1 : 0
  const push = body.notify_push === true ? 1 : 0

  const res = await c.env.DB.prepare(
    `INSERT INTO storm_service_areas
     (customer_id, name, polygon_geojson, min_hail_inches, min_wind_kmh, types_json, notify_email, notify_push, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).bind(customerId, name, JSON.stringify(polygon), minHail, minWind, JSON.stringify(types), email, push).run()

  const id = (res as any).meta?.last_row_id || (res as any).lastRowId
  return c.json({ ok: true, id })
})

// ------------------------------------------------------------
// PUT /areas/:id — update (thresholds, name, active flag)
// ------------------------------------------------------------
stormAlertsRoutes.put('/areas/:id', async (c) => {
  const customerId = await requireCustomer(c)
  if (!customerId) return c.json({ error: 'Not authenticated' }, 401)
  const id = parseInt(c.req.param('id'), 10)
  if (!Number.isFinite(id)) return c.json({ error: 'Bad id' }, 400)

  const body = await c.req.json<any>().catch(() => null)
  if (!body) return c.json({ error: 'Invalid JSON' }, 400)

  const existing = await c.env.DB.prepare('SELECT id FROM storm_service_areas WHERE id = ? AND customer_id = ?').bind(id, customerId).first()
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const fields: string[] = []
  const binds: any[] = []
  if (typeof body.name === 'string') { fields.push('name = ?'); binds.push(body.name.trim().slice(0, 80)) }
  if (body.polygon) {
    const poly = parsePolygon(body.polygon)
    if (!poly) return c.json({ error: 'Bad polygon' }, 400)
    fields.push('polygon_geojson = ?'); binds.push(JSON.stringify(poly))
  }
  if (body.min_hail_inches != null) { fields.push('min_hail_inches = ?'); binds.push(Math.max(0, Math.min(5, Number(body.min_hail_inches)))) }
  if (body.min_wind_kmh != null) { fields.push('min_wind_kmh = ?'); binds.push(Math.max(0, Math.min(300, Math.round(Number(body.min_wind_kmh))))) }
  if (body.types) { fields.push('types_json = ?'); binds.push(JSON.stringify(parseTypes(body.types))) }
  if (body.notify_email != null) { fields.push('notify_email = ?'); binds.push(body.notify_email ? 1 : 0) }
  if (body.notify_push != null) { fields.push('notify_push = ?'); binds.push(body.notify_push ? 1 : 0) }
  if (body.is_active != null) { fields.push('is_active = ?'); binds.push(body.is_active ? 1 : 0) }
  if (!fields.length) return c.json({ error: 'Nothing to update' }, 400)

  fields.push("updated_at = datetime('now')")
  binds.push(id, customerId)
  await c.env.DB.prepare(`UPDATE storm_service_areas SET ${fields.join(', ')} WHERE id = ? AND customer_id = ?`).bind(...binds).run()
  return c.json({ ok: true })
})

// ------------------------------------------------------------
// DELETE /areas/:id
// ------------------------------------------------------------
stormAlertsRoutes.delete('/areas/:id', async (c) => {
  const customerId = await requireCustomer(c)
  if (!customerId) return c.json({ error: 'Not authenticated' }, 401)
  const id = parseInt(c.req.param('id'), 10)
  if (!Number.isFinite(id)) return c.json({ error: 'Bad id' }, 400)
  await c.env.DB.prepare('DELETE FROM storm_service_areas WHERE id = ? AND customer_id = ?').bind(id, customerId).run()
  return c.json({ ok: true })
})

// ------------------------------------------------------------
// GET /notifications — recent matches for this customer
// ------------------------------------------------------------
stormAlertsRoutes.get('/notifications', async (c) => {
  const customerId = await requireCustomer(c)
  if (!customerId) return c.json({ error: 'Not authenticated' }, 401)
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '50', 10)))
  const rows = await c.env.DB.prepare(
    `SELECT id, area_id, area_name, event_source, event_type, severity, event_timestamp,
            matched_at, hail_inches, wind_kmh, lat, lng, description, email_sent
       FROM storm_notifications
      WHERE customer_id = ?
      ORDER BY matched_at DESC
      LIMIT ?`
  ).bind(customerId, limit).all<any>()
  return c.json({ notifications: rows.results || [] })
})
