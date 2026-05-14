// Solar Proposal Documents — contracts, agreements, install paperwork.
// Two modes:
//   - Company templates (is_template=1, no deal_id)       → reusable library
//   - Deal attachments (is_template=0, deal_id set)       → on a specific proposal
import type { Context } from 'hono'
import { Hono } from 'hono'
import { getCustomerSessionToken } from '../lib/session-tokens'
import type { Bindings, AppEnv } from '../types'
import { resolveTeamOwner } from './team'

export const solarDocumentsRoutes = new Hono<AppEnv>()

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

const DOC_TYPES = ['contract','agreement','install_paperwork','disclosure','financing','other']

// List. Query: ?deal_id=N | ?is_template=1
solarDocumentsRoutes.get('/', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const dealId = c.req.query('deal_id')
  const tpl = c.req.query('is_template')
  let q = 'SELECT * FROM solar_proposal_documents WHERE customer_id = ?'
  const p: any[] = [auth.ownerId]
  if (dealId) { q += ' AND deal_id = ?'; p.push(dealId) }
  if (tpl === '1') { q += ' AND is_template = 1' }
  if (tpl === '0') { q += ' AND is_template = 0' }
  q += ' ORDER BY created_at DESC LIMIT 500'
  const rows = await c.env.DB.prepare(q).bind(...p).all()
  return c.json({ documents: rows.results || [] })
})

solarDocumentsRoutes.post('/', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const b = await c.req.json().catch(() => ({}))
  const docType = DOC_TYPES.includes(b.doc_type) ? b.doc_type : 'contract'
  if (!b.title) return c.json({ error: 'title required' }, 400)
  const r = await c.env.DB.prepare(`
    INSERT INTO solar_proposal_documents
      (customer_id, deal_id, order_id, doc_type, title, file_url, notes, is_template, signed)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).bind(
    auth.ownerId,
    b.deal_id ? Number(b.deal_id) : null,
    b.order_id ? Number(b.order_id) : null,
    docType, b.title, b.file_url || null, b.notes || null,
    b.is_template ? 1 : 0,
    b.signed ? 1 : 0,
  ).run()
  return c.json({ success: true, id: r.meta.last_row_id })
})

// Attach a template to a deal (creates a copy scoped to that deal)
solarDocumentsRoutes.post('/attach', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const b = await c.req.json().catch(() => ({}))
  const tplId = Number(b.template_id), dealId = Number(b.deal_id)
  if (!tplId || !dealId) return c.json({ error: 'template_id and deal_id required' }, 400)
  const tpl = await c.env.DB.prepare(
    `SELECT * FROM solar_proposal_documents WHERE customer_id = ? AND id = ? AND is_template = 1`
  ).bind(auth.ownerId, tplId).first<any>()
  if (!tpl) return c.json({ error: 'template not found' }, 404)
  const r = await c.env.DB.prepare(`
    INSERT INTO solar_proposal_documents
      (customer_id, deal_id, doc_type, title, file_url, notes, is_template, signed)
    VALUES (?,?,?,?,?,?,0,0)
  `).bind(auth.ownerId, dealId, tpl.doc_type, tpl.title, tpl.file_url, tpl.notes).run()
  return c.json({ success: true, id: r.meta.last_row_id })
})

solarDocumentsRoutes.patch('/:id', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')
  const b = await c.req.json().catch(() => ({}))
  const allowed = ['deal_id','order_id','doc_type','title','file_url','notes','is_template','signed']
  const sets: string[] = []; const vals: any[] = []
  for (const k of allowed) if (k in b) {
    sets.push(`${k} = ?`)
    if (k === 'is_template' || k === 'signed') vals.push(b[k] ? 1 : 0)
    else vals.push(b[k] === '' ? null : b[k])
  }
  if ('signed' in b && b.signed) { sets.push("signed_at = datetime('now')") }
  if (sets.length === 0) return c.json({ success: true })
  sets.push("updated_at = datetime('now')")
  vals.push(auth.ownerId, id)
  await c.env.DB.prepare(
    `UPDATE solar_proposal_documents SET ${sets.join(', ')} WHERE customer_id = ? AND id = ?`
  ).bind(...vals).run()
  return c.json({ success: true })
})

solarDocumentsRoutes.delete('/:id', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')
  await c.env.DB.prepare(
    `DELETE FROM solar_proposal_documents WHERE customer_id = ? AND id = ?`
  ).bind(auth.ownerId, id).run()
  return c.json({ success: true })
})
