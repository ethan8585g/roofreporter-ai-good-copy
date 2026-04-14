// Solar Presentation — pre-set slide deck shown to homeowners.
// Customer-scoped. Mirrors the auth pattern used by solar-pipeline.
import { Hono } from 'hono'
import type { Bindings } from '../types'
import { resolveTeamOwner } from './team'

export const solarPresentationRoutes = new Hono<{ Bindings: Bindings }>()

async function requireCustomer(c: any) {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return null
  const s = await c.env.DB.prepare(
    `SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')`
  ).bind(token).first<any>()
  if (!s) return null
  const { ownerId } = await resolveTeamOwner(c.env.DB, s.customer_id)
  return { ownerId }
}

solarPresentationRoutes.get('/', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const rows = await c.env.DB.prepare(
    `SELECT * FROM solar_presentation_slides WHERE customer_id = ? ORDER BY slide_order ASC, id ASC`
  ).bind(auth.ownerId).all()
  return c.json({ slides: rows.results || [] })
})

solarPresentationRoutes.post('/', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const b = await c.req.json().catch(() => ({}))
  const nextOrder = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(slide_order),-1)+1 AS n FROM solar_presentation_slides WHERE customer_id = ?`
  ).bind(auth.ownerId).first<any>()
  const order = Number.isFinite(Number(b.slide_order)) ? Number(b.slide_order) : (nextOrder?.n ?? 0)
  const r = await c.env.DB.prepare(`
    INSERT INTO solar_presentation_slides
      (customer_id, slide_order, title, body, image_url, video_url, cta_label, cta_url)
    VALUES (?,?,?,?,?,?,?,?)
  `).bind(
    auth.ownerId, order,
    b.title || null, b.body || null,
    b.image_url || null, b.video_url || null,
    b.cta_label || null, b.cta_url || null
  ).run()
  return c.json({ success: true, id: r.meta.last_row_id })
})

solarPresentationRoutes.patch('/:id', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')
  const b = await c.req.json().catch(() => ({}))
  const allowed = ['slide_order','title','body','image_url','video_url','cta_label','cta_url']
  const sets: string[] = []; const vals: any[] = []
  for (const k of allowed) if (k in b) { sets.push(`${k} = ?`); vals.push(b[k] === '' ? null : b[k]) }
  if (sets.length === 0) return c.json({ success: true })
  sets.push("updated_at = datetime('now')")
  vals.push(auth.ownerId, id)
  await c.env.DB.prepare(
    `UPDATE solar_presentation_slides SET ${sets.join(', ')} WHERE customer_id = ? AND id = ?`
  ).bind(...vals).run()
  return c.json({ success: true })
})

solarPresentationRoutes.delete('/:id', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')
  await c.env.DB.prepare(
    `DELETE FROM solar_presentation_slides WHERE customer_id = ? AND id = ?`
  ).bind(auth.ownerId, id).run()
  return c.json({ success: true })
})

// Bulk reorder: body { order: [id1, id2, ...] }
solarPresentationRoutes.post('/reorder', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const b = await c.req.json().catch(() => ({}))
  const ids: number[] = Array.isArray(b.order) ? b.order.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n)) : []
  for (let i = 0; i < ids.length; i++) {
    await c.env.DB.prepare(
      `UPDATE solar_presentation_slides SET slide_order = ?, updated_at = datetime('now') WHERE customer_id = ? AND id = ?`
    ).bind(i, auth.ownerId, ids[i]).run()
  }
  return c.json({ success: true })
})
