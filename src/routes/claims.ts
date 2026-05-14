import type { Context } from 'hono'
import { Hono } from 'hono'
import type { Bindings, AppEnv } from '../types'
import { resolveTeamOwner } from './team'
import { validateAdminSession } from './auth'

export const claimsRoutes = new Hono<AppEnv>()

async function getOwnerId(c: Context<AppEnv>): Promise<number | null> {
  const auth = c.req.header('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const session = await c.env.DB.prepare(
    "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
  ).bind(token).first<any>()
  if (session) {
    const { ownerId } = await resolveTeamOwner(c.env.DB, session.customer_id)
    return ownerId
  }
  const admin = await validateAdminSession(c.env.DB, auth)
  if (admin) return 1000000 + admin.id
  return null
}

// LIST claims
claimsRoutes.get('/', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const status = c.req.query('status') || ''
  const customerId = c.req.query('customer_id') || ''
  const search = c.req.query('search') || ''

  let q = `SELECT ic.*, cc.name as customer_name, cc.email as customer_email, cc.phone as customer_phone, cc.address as customer_address
    FROM insurance_claims ic
    LEFT JOIN crm_customers cc ON cc.id = ic.crm_customer_id
    WHERE ic.owner_id = ?`
  const params: any[] = [ownerId]
  if (status) { q += ` AND ic.status = ?`; params.push(status) }
  if (customerId) { q += ` AND ic.crm_customer_id = ?`; params.push(customerId) }
  if (search) {
    q += ` AND (ic.claim_number LIKE ? OR ic.insurance_company LIKE ? OR ic.adjuster_name LIKE ? OR cc.name LIKE ?)`
    const s = `%${search}%`; params.push(s, s, s, s)
  }
  q += ` ORDER BY ic.created_at DESC`
  const claims = await c.env.DB.prepare(q).bind(...params).all()

  const stats = await c.env.DB.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_count,
      SUM(CASE WHEN status = 'supplement_pending' THEN 1 ELSE 0 END) as supplement_pending_count,
      COALESCE(SUM(rcv_amount), 0) as total_rcv,
      COALESCE(SUM(acv_amount), 0) as total_acv,
      COALESCE(SUM(net_claim), 0) as total_net
    FROM insurance_claims WHERE owner_id = ?
  `).bind(ownerId).first()

  return c.json({ claims: claims.results, stats })
})

// GET single claim with line items + supplements
claimsRoutes.get('/:id', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')

  const claim = await c.env.DB.prepare(
    `SELECT ic.*, cc.name as customer_name, cc.email as customer_email, cc.phone as customer_phone,
            cc.address as customer_address, cc.city as customer_city, cc.province as customer_province, cc.postal_code as customer_postal
     FROM insurance_claims ic
     LEFT JOIN crm_customers cc ON cc.id = ic.crm_customer_id
     WHERE ic.id = ? AND ic.owner_id = ?`
  ).bind(id, ownerId).first()
  if (!claim) return c.json({ error: 'Claim not found' }, 404)

  const lineItems = await c.env.DB.prepare(
    'SELECT * FROM claim_line_items WHERE claim_id = ? ORDER BY sort_order, id'
  ).bind(id).all()
  const supplements = await c.env.DB.prepare(
    'SELECT * FROM claim_supplements WHERE claim_id = ? ORDER BY supplement_number, id'
  ).bind(id).all()

  return c.json({ claim, line_items: lineItems.results, supplements: supplements.results })
})

// CREATE claim
claimsRoutes.post('/', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  try {
    const body = await c.req.json()
    if (!body.crm_customer_id) return c.json({ error: 'crm_customer_id is required' }, 400)

    const customer = await c.env.DB.prepare(
      'SELECT id FROM crm_customers WHERE id = ? AND owner_id = ?'
    ).bind(body.crm_customer_id, ownerId).first()
    if (!customer) return c.json({ error: 'Customer not found for this account' }, 404)

    const rcv = Number(body.rcv_amount || 0)
    const deductible = Number(body.deductible || 0)
    const depreciation = Number(body.depreciation || 0)
    const acv = body.acv_amount !== undefined ? Number(body.acv_amount) : Math.max(0, rcv - depreciation - deductible)
    const netClaim = body.net_claim !== undefined ? Number(body.net_claim) : Math.max(0, rcv - deductible)

    const result = await c.env.DB.prepare(`
      INSERT INTO insurance_claims (
        owner_id, crm_customer_id, claim_number, insurance_company, policy_number,
        date_of_loss, loss_type, adjuster_name, adjuster_email, adjuster_phone,
        inspection_date, deductible, acv_amount, rcv_amount, depreciation,
        recoverable_depreciation, net_claim, overhead_profit, status,
        xactimate_file_url, xactimate_filename, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      ownerId, body.crm_customer_id,
      body.claim_number || null, body.insurance_company || null, body.policy_number || null,
      body.date_of_loss || null, body.loss_type || null,
      body.adjuster_name || null, body.adjuster_email || null, body.adjuster_phone || null,
      body.inspection_date || null,
      deductible, acv, rcv, depreciation,
      Number(body.recoverable_depreciation || 0), netClaim, Number(body.overhead_profit || 0),
      body.status || 'open',
      body.xactimate_file_url || null, body.xactimate_filename || null,
      body.notes || null
    ).run()

    return c.json({ success: true, id: result.meta.last_row_id })
  } catch (err: any) {
    return c.json({ error: 'Failed to create claim: ' + err.message }, 500)
  }
})

// UPDATE claim
claimsRoutes.put('/:id', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  try {
    const id = c.req.param('id')
    const b = await c.req.json()
    const result = await c.env.DB.prepare(`
      UPDATE insurance_claims SET
        claim_number=?, insurance_company=?, policy_number=?,
        date_of_loss=?, loss_type=?,
        adjuster_name=?, adjuster_email=?, adjuster_phone=?,
        inspection_date=?, deductible=?, acv_amount=?, rcv_amount=?,
        depreciation=?, recoverable_depreciation=?, net_claim=?, overhead_profit=?,
        status=?, xactimate_file_url=?, xactimate_filename=?, notes=?,
        updated_at=datetime('now')
      WHERE id = ? AND owner_id = ?
    `).bind(
      b.claim_number || null, b.insurance_company || null, b.policy_number || null,
      b.date_of_loss || null, b.loss_type || null,
      b.adjuster_name || null, b.adjuster_email || null, b.adjuster_phone || null,
      b.inspection_date || null,
      Number(b.deductible || 0), Number(b.acv_amount || 0), Number(b.rcv_amount || 0),
      Number(b.depreciation || 0), Number(b.recoverable_depreciation || 0),
      Number(b.net_claim || 0), Number(b.overhead_profit || 0),
      b.status || 'open', b.xactimate_file_url || null, b.xactimate_filename || null,
      b.notes || null,
      id, ownerId
    ).run()
    if (!result.meta.changes) return c.json({ error: 'Claim not found' }, 404)
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: 'Failed to update claim: ' + err.message }, 500)
  }
})

// DELETE claim
claimsRoutes.delete('/:id', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM insurance_claims WHERE id = ? AND owner_id = ?').bind(id, ownerId).run()
  return c.json({ success: true })
})

// ------------ LINE ITEMS ------------

async function verifyClaimOwnership(c: Context<AppEnv>, claimId: string, ownerId: number) {
  const claim = await c.env.DB.prepare(
    'SELECT id FROM insurance_claims WHERE id = ? AND owner_id = ?'
  ).bind(claimId, ownerId).first()
  return !!claim
}

claimsRoutes.post('/:id/line-items', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const claimId = c.req.param('id')
  if (!await verifyClaimOwnership(c, claimId, ownerId)) return c.json({ error: 'Claim not found' }, 404)

  const b = await c.req.json()
  if (!b.description) return c.json({ error: 'Description is required' }, 400)
  const qty = Number(b.quantity || 1)
  const price = Number(b.unit_price || 0)
  const rcv = b.rcv !== undefined ? Number(b.rcv) : qty * price
  const result = await c.env.DB.prepare(`
    INSERT INTO claim_line_items (claim_id, category, description, quantity, unit, unit_price, rcv, acv, depreciation, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    claimId, b.category || null, b.description,
    qty, b.unit || null, price, rcv,
    Number(b.acv || 0), Number(b.depreciation || 0),
    Number(b.sort_order || 0)
  ).run()
  return c.json({ success: true, id: result.meta.last_row_id })
})

claimsRoutes.delete('/:id/line-items/:itemId', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const claimId = c.req.param('id')
  const itemId = c.req.param('itemId')
  if (!await verifyClaimOwnership(c, claimId, ownerId)) return c.json({ error: 'Claim not found' }, 404)
  await c.env.DB.prepare('DELETE FROM claim_line_items WHERE id = ? AND claim_id = ?').bind(itemId, claimId).run()
  return c.json({ success: true })
})

// ------------ SUPPLEMENTS ------------

claimsRoutes.post('/:id/supplements', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const claimId = c.req.param('id')
  if (!await verifyClaimOwnership(c, claimId, ownerId)) return c.json({ error: 'Claim not found' }, 404)

  const b = await c.req.json()
  const nextNum = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(supplement_number), 0) + 1 as n FROM claim_supplements WHERE claim_id = ?'
  ).bind(claimId).first<any>()

  const result = await c.env.DB.prepare(`
    INSERT INTO claim_supplements (
      claim_id, supplement_number, reason, description,
      requested_amount, approved_amount, status,
      submitted_date, response_date, line_items_json, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    claimId, b.supplement_number || nextNum?.n || 1,
    b.reason || null, b.description || null,
    Number(b.requested_amount || 0), Number(b.approved_amount || 0),
    b.status || 'draft',
    b.submitted_date || null, b.response_date || null,
    b.line_items_json ? (typeof b.line_items_json === 'string' ? b.line_items_json : JSON.stringify(b.line_items_json)) : null,
    b.notes || null
  ).run()

  if (b.status === 'submitted') {
    await c.env.DB.prepare(
      "UPDATE insurance_claims SET status = 'supplement_pending', updated_at = datetime('now') WHERE id = ? AND owner_id = ?"
    ).bind(claimId, ownerId).run()
  }

  return c.json({ success: true, id: result.meta.last_row_id })
})

claimsRoutes.put('/:id/supplements/:supId', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const claimId = c.req.param('id')
  const supId = c.req.param('supId')
  if (!await verifyClaimOwnership(c, claimId, ownerId)) return c.json({ error: 'Claim not found' }, 404)

  const b = await c.req.json()
  await c.env.DB.prepare(`
    UPDATE claim_supplements SET
      reason=?, description=?, requested_amount=?, approved_amount=?, status=?,
      submitted_date=?, response_date=?, line_items_json=?, notes=?,
      updated_at=datetime('now')
    WHERE id = ? AND claim_id = ?
  `).bind(
    b.reason || null, b.description || null,
    Number(b.requested_amount || 0), Number(b.approved_amount || 0),
    b.status || 'draft',
    b.submitted_date || null, b.response_date || null,
    b.line_items_json ? (typeof b.line_items_json === 'string' ? b.line_items_json : JSON.stringify(b.line_items_json)) : null,
    b.notes || null,
    supId, claimId
  ).run()
  return c.json({ success: true })
})

claimsRoutes.delete('/:id/supplements/:supId', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const claimId = c.req.param('id')
  const supId = c.req.param('supId')
  if (!await verifyClaimOwnership(c, claimId, ownerId)) return c.json({ error: 'Claim not found' }, 404)
  await c.env.DB.prepare('DELETE FROM claim_supplements WHERE id = ? AND claim_id = ?').bind(supId, claimId).run()
  return c.json({ success: true })
})

// ------------ XACTIMATE UPLOAD (PDF, stored as base64 data URL for MVP) ------------

claimsRoutes.post('/:id/xactimate', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const claimId = c.req.param('id')
  if (!await verifyClaimOwnership(c, claimId, ownerId)) return c.json({ error: 'Claim not found' }, 404)

  const { data_url, filename } = await c.req.json()
  if (!data_url || typeof data_url !== 'string' || !data_url.startsWith('data:')) {
    return c.json({ error: 'Invalid file payload' }, 400)
  }
  // Cap at ~8MB base64 (~6MB binary)
  if (data_url.length > 8 * 1024 * 1024) {
    return c.json({ error: 'File too large (max ~6MB)' }, 413)
  }

  await c.env.DB.prepare(
    "UPDATE insurance_claims SET xactimate_file_url = ?, xactimate_filename = ?, updated_at = datetime('now') WHERE id = ? AND owner_id = ?"
  ).bind(data_url, filename || 'estimate.pdf', claimId, ownerId).run()

  return c.json({ success: true })
})
