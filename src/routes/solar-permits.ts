// Solar Permitting — jurisdiction, permit #, status, inspections.
import type { Context } from 'hono'
import { Hono } from 'hono'
import { getCustomerSessionToken } from '../lib/session-tokens'
import type { Bindings, AppEnv } from '../types'
import { resolveTeamOwner } from './team'

export const solarPermitsRoutes = new Hono<AppEnv>()

const STATUSES = [
  'not_started','preparing','submitted','under_review','approved','rejected',
  'inspection_scheduled','passed_inspection','closed'
] as const

async function requireCustomer(c: Context<AppEnv>) {
  const token = getCustomerSessionToken(c)
  if (!token) return null
  const s = await c.env.DB.prepare(
    `SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')`
  ).bind(token).first<any>()
  if (!s) return null
  const { ownerId } = await resolveTeamOwner(c.env.DB, s.customer_id)
  return { ownerId }
}

solarPermitsRoutes.get('/', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const status = c.req.query('status')
  const dealId = c.req.query('deal_id')
  let q = 'SELECT * FROM solar_permits WHERE customer_id = ?'
  const p: any[] = [auth.ownerId]
  if (status) { q += ' AND status = ?'; p.push(status) }
  if (dealId) { q += ' AND deal_id = ?'; p.push(dealId) }
  q += ' ORDER BY updated_at DESC LIMIT 500'
  const rows = await c.env.DB.prepare(q).bind(...p).all()
  return c.json({ permits: rows.results || [] })
})

solarPermitsRoutes.get('/stats', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const byStatus = await c.env.DB.prepare(
    `SELECT status, COUNT(*) as cnt FROM solar_permits WHERE customer_id = ? GROUP BY status`
  ).bind(auth.ownerId).all()
  return c.json({ by_status: byStatus.results || [] })
})

solarPermitsRoutes.post('/', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const b = await c.req.json().catch(() => ({}))
  const status = (STATUSES as readonly string[]).includes(b.status) ? b.status : 'not_started'
  const r = await c.env.DB.prepare(`
    INSERT INTO solar_permits (
      customer_id, deal_id, homeowner_name, property_address,
      jurisdiction, permit_type, permit_number, status, fee_cad,
      submitted_at, approved_at, inspection_at,
      inspector_name, inspector_notes, rejection_reason, document_url, notes
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    auth.ownerId,
    b.deal_id ? Number(b.deal_id) : null,
    b.homeowner_name || null, b.property_address || null,
    b.jurisdiction || null, b.permit_type || null, b.permit_number || null,
    status, Number(b.fee_cad) || 0,
    b.submitted_at || null, b.approved_at || null, b.inspection_at || null,
    b.inspector_name || null, b.inspector_notes || null, b.rejection_reason || null,
    b.document_url || null, b.notes || null,
  ).run()
  return c.json({ success: true, id: r.meta.last_row_id })
})

solarPermitsRoutes.patch('/:id', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')
  const b = await c.req.json().catch(() => ({}))
  const allowed = [
    'deal_id','homeowner_name','property_address',
    'jurisdiction','permit_type','permit_number','status','fee_cad',
    'submitted_at','approved_at','inspection_at',
    'inspector_name','inspector_notes','rejection_reason','document_url','notes',
  ]
  const sets: string[] = []; const vals: any[] = []
  for (const k of allowed) if (k in b) { sets.push(`${k} = ?`); vals.push(b[k] === '' ? null : b[k]) }
  if (b.status === 'submitted' && !('submitted_at' in b)) sets.push("submitted_at = datetime('now')")
  if (b.status === 'approved' && !('approved_at' in b)) sets.push("approved_at = datetime('now')")
  if (sets.length === 0) return c.json({ success: true })
  sets.push("updated_at = datetime('now')")
  vals.push(auth.ownerId, id)
  await c.env.DB.prepare(
    `UPDATE solar_permits SET ${sets.join(', ')} WHERE customer_id = ? AND id = ?`
  ).bind(...vals).run()
  return c.json({ success: true })
})

solarPermitsRoutes.delete('/:id', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')
  await c.env.DB.prepare(`DELETE FROM solar_permits WHERE customer_id = ? AND id = ?`).bind(auth.ownerId, id).run()
  return c.json({ success: true })
})
