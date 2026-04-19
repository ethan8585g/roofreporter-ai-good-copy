// ============================================================
// Roof Manager — Sales & Commissions Tracking
// ============================================================
//
// Track sales and commissions per team member / crew / admin.
// Commission rules define rates; entries are the earned ledger.
//
// ENDPOINTS:
//   GET    /api/commissions/rules           → List commission rules
//   POST   /api/commissions/rules           → Create a commission rule
//   PUT    /api/commissions/rules/:id       → Update a commission rule
//   DELETE /api/commissions/rules/:id       → Delete a commission rule
//   GET    /api/commissions/entries         → List commission entries (filterable)
//   POST   /api/commissions/entries         → Manually create a commission entry
//   PATCH  /api/commissions/entries/:id     → Update entry status (approve/pay/void)
//   GET    /api/commissions/dashboard       → Aggregated stats
//   GET    /api/commissions/leaderboard     → Ranked team members by sales & earnings
//   GET    /api/commissions/team-members    → List team members for dropdowns
// ============================================================

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { resolveTeamOwner } from './team'

export const commissionRoutes = new Hono<{ Bindings: Bindings }>()

// ── AUTH ──
async function getOwnerId(c: any): Promise<number | null> {
  const auth = c.req.header('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const session = await c.env.DB.prepare(
    "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
  ).bind(token).first<any>()
  if (!session) return null
  const { ownerId } = await resolveTeamOwner(c.env.DB, session.customer_id)
  return ownerId
}

// ============================================================
// GET /team-members — List team members for dropdowns
// ============================================================
commissionRoutes.get('/team-members', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)

  // Include the owner themselves + all active team members
  const owner = await c.env.DB.prepare(
    'SELECT id, name, email FROM customers WHERE id = ?'
  ).bind(ownerId).first<any>()

  const members = await c.env.DB.prepare(
    `SELECT tm.id as team_member_id, tm.member_customer_id, tm.role, c.name, c.email
     FROM team_members tm JOIN customers c ON c.id = tm.member_customer_id
     WHERE tm.owner_id = ? AND tm.status = 'active'`
  ).bind(ownerId).all<any>()

  const list = [
    { id: ownerId, name: owner?.name || 'Owner', email: owner?.email || '', role: 'owner' },
    ...(members.results || []).map((m: any) => ({
      id: m.member_customer_id,
      name: m.name || m.email,
      email: m.email,
      role: m.role
    }))
  ]
  return c.json({ members: list })
})

// ============================================================
// COMMISSION RULES CRUD
// ============================================================

// GET /rules
commissionRoutes.get('/rules', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)

  const rules = await c.env.DB.prepare(
    `SELECT cr.*, c.name as current_name, c.email as member_email
     FROM commission_rules cr LEFT JOIN customers c ON c.id = cr.team_member_id
     WHERE cr.owner_id = ? ORDER BY cr.member_name ASC`
  ).bind(ownerId).all<any>()
  return c.json({ rules: rules.results })
})

// POST /rules
commissionRoutes.post('/rules', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)

  const body = await c.req.json()
  const { team_member_id, member_name, role, commission_type, commission_rate } = body

  if (!team_member_id || !member_name) {
    return c.json({ error: 'team_member_id and member_name are required' }, 400)
  }

  const validRoles = ['sales_rep', 'closer', 'setter', 'installer', 'manager']
  const safeRole = validRoles.includes(role) ? role : 'sales_rep'
  const safeType = commission_type === 'flat' ? 'flat' : 'percentage'
  const safeRate = Math.max(0, Number(commission_rate) || 0)

  const result = await c.env.DB.prepare(
    `INSERT INTO commission_rules (owner_id, team_member_id, member_name, role, commission_type, commission_rate)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(ownerId, team_member_id, member_name, safeRole, safeType, safeRate).run()

  return c.json({ success: true, id: result.meta?.last_row_id })
})

// PUT /rules/:id
commissionRoutes.put('/rules/:id', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)

  const id = c.req.param('id')
  const body = await c.req.json()

  const fields: string[] = []
  const params: any[] = []

  if (body.role) {
    const validRoles = ['sales_rep', 'closer', 'setter', 'installer', 'manager']
    if (validRoles.includes(body.role)) { fields.push('role = ?'); params.push(body.role) }
  }
  if (body.commission_type) {
    const safeType = body.commission_type === 'flat' ? 'flat' : 'percentage'
    fields.push('commission_type = ?'); params.push(safeType)
  }
  if (body.commission_rate !== undefined) {
    fields.push('commission_rate = ?'); params.push(Math.max(0, Number(body.commission_rate) || 0))
  }
  if (body.is_active !== undefined) {
    fields.push('is_active = ?'); params.push(body.is_active ? 1 : 0)
  }
  if (body.member_name) {
    fields.push('member_name = ?'); params.push(body.member_name)
  }

  if (fields.length === 0) return c.json({ error: 'No fields to update' }, 400)

  fields.push("updated_at = datetime('now')")
  params.push(id, ownerId)

  await c.env.DB.prepare(
    `UPDATE commission_rules SET ${fields.join(', ')} WHERE id = ? AND owner_id = ?`
  ).bind(...params).run()

  return c.json({ success: true })
})

// DELETE /rules/:id
commissionRoutes.delete('/rules/:id', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)

  await c.env.DB.prepare(
    'DELETE FROM commission_rules WHERE id = ? AND owner_id = ?'
  ).bind(c.req.param('id'), ownerId).run()

  return c.json({ success: true })
})

// ============================================================
// COMMISSION ENTRIES
// ============================================================

// GET /entries — filterable by member, status, date range
commissionRoutes.get('/entries', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)

  let q = 'SELECT * FROM commission_entries WHERE owner_id = ?'
  const params: any[] = [ownerId]

  const memberId = c.req.query('member_id')
  if (memberId) { q += ' AND team_member_id = ?'; params.push(memberId) }

  const status = c.req.query('status')
  if (status) { q += ' AND status = ?'; params.push(status) }

  const from = c.req.query('from')
  if (from) { q += ' AND created_at >= ?'; params.push(from) }

  const to = c.req.query('to')
  if (to) { q += ' AND created_at <= ?'; params.push(to) }

  q += ' ORDER BY created_at DESC LIMIT 200'

  const entries = await c.env.DB.prepare(q).bind(...params).all<any>()
  return c.json({ entries: entries.results })
})

// POST /entries — manual commission entry
commissionRoutes.post('/entries', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)

  const body = await c.req.json()
  const { team_member_id, member_name, source_type, source_id, source_label, customer_name, deal_value, commission_amount, notes } = body

  if (!team_member_id || !source_type) {
    return c.json({ error: 'team_member_id and source_type are required' }, 400)
  }

  const validTypes = ['proposal', 'invoice', 'job']
  if (!validTypes.includes(source_type)) {
    return c.json({ error: 'source_type must be proposal, invoice, or job' }, 400)
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO commission_entries (owner_id, team_member_id, member_name, source_type, source_id, source_label, customer_name, deal_value, commission_amount, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(ownerId, team_member_id, member_name || '', source_type, source_id || 0, source_label || '', customer_name || '', Number(deal_value) || 0, Number(commission_amount) || 0, notes || null).run()

  return c.json({ success: true, id: result.meta?.last_row_id })
})

// PATCH /entries/:id — update status
commissionRoutes.patch('/entries/:id', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)

  const id = c.req.param('id')
  const body = await c.req.json()

  const validStatuses = ['pending', 'approved', 'paid', 'voided']
  if (!body.status || !validStatuses.includes(body.status)) {
    return c.json({ error: 'Valid status required: pending, approved, paid, voided' }, 400)
  }

  const extra = body.status === 'paid' ? ", paid_at = datetime('now')" : ''
  await c.env.DB.prepare(
    `UPDATE commission_entries SET status = ?${extra} WHERE id = ? AND owner_id = ?`
  ).bind(body.status, id, ownerId).run()

  return c.json({ success: true })
})

// ============================================================
// DASHBOARD — Aggregated stats
// ============================================================
commissionRoutes.get('/dashboard', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)

  const totals = await c.env.DB.prepare(`
    SELECT
      COUNT(*) as total_entries,
      COALESCE(SUM(deal_value), 0) as total_sales,
      COALESCE(SUM(commission_amount), 0) as total_commission,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN commission_amount ELSE 0 END), 0) as pending_commission,
      COALESCE(SUM(CASE WHEN status = 'approved' THEN commission_amount ELSE 0 END), 0) as approved_commission,
      COALESCE(SUM(CASE WHEN status = 'paid' THEN commission_amount ELSE 0 END), 0) as paid_commission,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as pending_count,
      COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) as approved_count,
      COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0) as paid_count
    FROM commission_entries WHERE owner_id = ?
  `).bind(ownerId).first<any>()

  // Per-member breakdown
  const byMember = await c.env.DB.prepare(`
    SELECT team_member_id, member_name,
      COUNT(*) as deals,
      COALESCE(SUM(deal_value), 0) as total_sales,
      COALESCE(SUM(commission_amount), 0) as total_commission,
      COALESCE(SUM(CASE WHEN status = 'paid' THEN commission_amount ELSE 0 END), 0) as paid_commission,
      COALESCE(SUM(CASE WHEN status IN ('pending','approved') THEN commission_amount ELSE 0 END), 0) as outstanding
    FROM commission_entries WHERE owner_id = ? AND status != 'voided'
    GROUP BY team_member_id ORDER BY total_sales DESC
  `).bind(ownerId).all<any>()

  // Monthly trend (last 6 months)
  const monthly = await c.env.DB.prepare(`
    SELECT strftime('%Y-%m', created_at) as month,
      COALESCE(SUM(deal_value), 0) as sales,
      COALESCE(SUM(commission_amount), 0) as commission,
      COUNT(*) as deals
    FROM commission_entries WHERE owner_id = ? AND status != 'voided'
      AND created_at >= date('now', '-6 months')
    GROUP BY month ORDER BY month ASC
  `).bind(ownerId).all<any>()

  return c.json({
    totals,
    by_member: byMember.results,
    monthly: monthly.results
  })
})

// ============================================================
// LEADERBOARD — Ranked team members
// ============================================================
commissionRoutes.get('/leaderboard', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)

  const period = c.req.query('period') || 'all' // all, month, quarter, year
  let dateFilter = ''
  if (period === 'month') dateFilter = "AND ce.created_at >= date('now', '-1 month')"
  else if (period === 'quarter') dateFilter = "AND ce.created_at >= date('now', '-3 months')"
  else if (period === 'year') dateFilter = "AND ce.created_at >= date('now', '-1 year')"

  const leaderboard = await c.env.DB.prepare(`
    SELECT ce.team_member_id, ce.member_name,
      COUNT(*) as total_deals,
      COALESCE(SUM(ce.deal_value), 0) as total_sales,
      COALESCE(SUM(ce.commission_amount), 0) as total_earned,
      COALESCE(SUM(CASE WHEN ce.status = 'paid' THEN ce.commission_amount ELSE 0 END), 0) as paid_out,
      COALESCE(AVG(ce.deal_value), 0) as avg_deal_size
    FROM commission_entries ce
    WHERE ce.owner_id = ? AND ce.status != 'voided' ${dateFilter}
    GROUP BY ce.team_member_id
    ORDER BY total_sales DESC
  `).bind(ownerId).all<any>()

  return c.json({ leaderboard: leaderboard.results, period })
})

// ============================================================
// AUTO-COMMISSION HELPER — Called from CRM routes
// ============================================================
export async function autoCreateCommission(
  db: D1Database,
  ownerId: number,
  salesRepId: number,
  sourceType: 'proposal' | 'invoice' | 'job',
  sourceId: number,
  sourceLabel: string,
  customerName: string,
  dealValue: number
) {
  // Check if a commission entry already exists for this source
  const existing = await db.prepare(
    'SELECT id FROM commission_entries WHERE owner_id = ? AND source_type = ? AND source_id = ?'
  ).bind(ownerId, sourceType, sourceId).first<any>()
  if (existing) return // already created

  // Find active commission rules for this sales rep
  const rules = await db.prepare(
    'SELECT * FROM commission_rules WHERE owner_id = ? AND team_member_id = ? AND is_active = 1'
  ).bind(ownerId, salesRepId).all<any>()

  if (!rules.results || rules.results.length === 0) return

  // Create a commission entry for each matching rule
  for (const rule of rules.results) {
    const amount = rule.commission_type === 'percentage'
      ? (dealValue * rule.commission_rate / 100)
      : rule.commission_rate

    await db.prepare(
      `INSERT INTO commission_entries (owner_id, team_member_id, member_name, rule_id, source_type, source_id, source_label, customer_name, deal_value, commission_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(ownerId, salesRepId, rule.member_name, rule.id, sourceType, sourceId, sourceLabel, customerName, dealValue, amount).run()
  }
}
