// ============================================================
// Solar Sales Pipeline — customer-scoped CRM for solar companies.
// Isolated from the existing roofing pipeline (revenue_pipeline table).
// Auth: customer bearer token (rc_customer_token). Deal rows are
// scoped to the owning customer_id resolved via the team helper.
// ============================================================
import { Hono } from 'hono'
import type { Bindings } from '../types'
import { resolveTeamOwner } from './team'

export const solarPipelineRoutes = new Hono<{ Bindings: Bindings }>()

// Resolve customer from bearer token. Returns { ownerId } or null.
async function requireCustomer(c: any) {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return null
  const session = await c.env.DB.prepare(
    `SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')`
  ).bind(token).first<any>()
  if (!session) return null
  const { ownerId } = await resolveTeamOwner(c.env.DB, session.customer_id)
  return { ownerId }
}

const STAGES = ['new_lead', 'appointment_set', 'proposal_sent', 'signed', 'install_scheduled', 'installed', 'paid', 'lost'] as const

// ── List deals ─────────────────────────────────────────────
solarPipelineRoutes.get('/', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const stage = c.req.query('stage')
  const source = c.req.query('source')
  let q = 'SELECT * FROM solar_deals WHERE customer_id = ?'
  const params: any[] = [auth.ownerId]
  if (stage) { q += ' AND stage = ?'; params.push(stage) }
  if (source) { q += ' AND lead_source = ?'; params.push(source) }
  q += ' ORDER BY updated_at DESC LIMIT 500'
  const rows = await c.env.DB.prepare(q).bind(...params).all()
  return c.json({ deals: rows.results || [] })
})

// ── Stats (kanban counts + commission totals) ──────────────
solarPipelineRoutes.get('/stats', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)

  const byStage = await c.env.DB.prepare(
    `SELECT stage, COUNT(*) as cnt, COALESCE(SUM(contract_value_cad),0) as value
     FROM solar_deals WHERE customer_id = ? GROUP BY stage`
  ).bind(auth.ownerId).all()

  const bySource = await c.env.DB.prepare(
    `SELECT lead_source, COUNT(*) as cnt, COALESCE(SUM(CASE WHEN stage IN ('signed','install_scheduled','installed','paid') THEN 1 ELSE 0 END),0) as won
     FROM solar_deals WHERE customer_id = ? GROUP BY lead_source`
  ).bind(auth.ownerId).all()

  const commissions = await c.env.DB.prepare(`
    SELECT
      COALESCE(SUM(contract_value_cad * setter_commission_pct / 100),0) as setter_total,
      COALESCE(SUM(contract_value_cad * closer_commission_pct / 100),0) as closer_total,
      COALESCE(SUM(contract_value_cad * installer_commission_pct / 100),0) as installer_total,
      COALESCE(SUM(contract_value_cad * override_commission_pct / 100),0) as override_total
    FROM solar_deals WHERE customer_id = ? AND stage IN ('signed','install_scheduled','installed','paid')
  `).bind(auth.ownerId).first<any>()

  const repLeaderboard = await c.env.DB.prepare(`
    SELECT closer_name as name, 'closer' as role,
           COUNT(*) as deals,
           COALESCE(SUM(contract_value_cad),0) as revenue,
           COALESCE(SUM(contract_value_cad * closer_commission_pct / 100),0) as commission
    FROM solar_deals
    WHERE customer_id = ? AND closer_name IS NOT NULL AND closer_name != ''
      AND stage IN ('signed','install_scheduled','installed','paid')
    GROUP BY closer_name ORDER BY revenue DESC LIMIT 10
  `).bind(auth.ownerId).all()

  return c.json({
    by_stage: byStage.results || [],
    by_source: bySource.results || [],
    commissions: commissions || {},
    top_closers: repLeaderboard.results || [],
  })
})

// ── Create ─────────────────────────────────────────────────
solarPipelineRoutes.post('/', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const b = await c.req.json().catch(() => ({}))
  const stage = (STAGES as readonly string[]).includes(b.stage) ? b.stage : 'new_lead'
  const r = await c.env.DB.prepare(`
    INSERT INTO solar_deals (
      customer_id, order_id, homeowner_name, homeowner_email, homeowner_phone,
      property_address, property_city, property_province,
      lead_source, lead_source_detail, stage,
      setter_name, closer_name, installer_name,
      setter_commission_pct, closer_commission_pct, installer_commission_pct, override_commission_pct,
      system_kw, contract_value_cad, notes
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    auth.ownerId, b.order_id || null,
    b.homeowner_name || null, b.homeowner_email || null, b.homeowner_phone || null,
    b.property_address || null, b.property_city || null, b.property_province || null,
    b.lead_source || 'other', b.lead_source_detail || null, stage,
    b.setter_name || null, b.closer_name || null, b.installer_name || null,
    Number(b.setter_commission_pct) || 0, Number(b.closer_commission_pct) || 0,
    Number(b.installer_commission_pct) || 0, Number(b.override_commission_pct) || 0,
    Number(b.system_kw) || null, Number(b.contract_value_cad) || 0, b.notes || null,
  ).run()
  return c.json({ success: true, id: r.meta.last_row_id })
})

// ── Update ─────────────────────────────────────────────────
solarPipelineRoutes.patch('/:id', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')
  const b = await c.req.json().catch(() => ({}))

  const allowed = [
    'homeowner_name','homeowner_email','homeowner_phone','property_address','property_city','property_province',
    'lead_source','lead_source_detail','stage','lost_reason',
    'setter_name','closer_name','installer_name',
    'setter_commission_pct','closer_commission_pct','installer_commission_pct','override_commission_pct',
    'system_kw','contract_value_cad','notes',
    'appointment_at','proposal_sent_at','signed_at','install_scheduled_at','installed_at','paid_at',
  ]
  const sets: string[] = []
  const vals: any[] = []
  for (const k of allowed) {
    if (k in b) { sets.push(`${k} = ?`); vals.push(b[k] === '' ? null : b[k]) }
  }
  // Auto-stamp milestone timestamps when stage changes
  if (b.stage === 'proposal_sent' && !('proposal_sent_at' in b)) { sets.push('proposal_sent_at = datetime(\'now\')') }
  if (b.stage === 'signed' && !('signed_at' in b)) { sets.push('signed_at = datetime(\'now\')') }
  if (b.stage === 'installed' && !('installed_at' in b)) { sets.push('installed_at = datetime(\'now\')') }
  if (b.stage === 'paid' && !('paid_at' in b)) { sets.push('paid_at = datetime(\'now\')') }
  if (sets.length === 0) return c.json({ success: true })
  sets.push("updated_at = datetime('now')")
  vals.push(auth.ownerId, id)
  await c.env.DB.prepare(
    `UPDATE solar_deals SET ${sets.join(', ')} WHERE customer_id = ? AND id = ?`
  ).bind(...vals).run()
  return c.json({ success: true })
})

// ── Delete ─────────────────────────────────────────────────
solarPipelineRoutes.delete('/:id', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')
  await c.env.DB.prepare(`DELETE FROM solar_deals WHERE customer_id = ? AND id = ?`).bind(auth.ownerId, id).run()
  return c.json({ success: true })
})
