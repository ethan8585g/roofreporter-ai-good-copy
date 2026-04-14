import { Hono } from 'hono'
import type { Bindings } from '../types'
import { resolveTeamOwner } from './team'
import { validateAdminSession } from './auth'
import { logFromContext } from '../lib/team-activity'
import { geocodeAddress, optimizeRoute, type LatLng } from '../services/geocoding'

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export const crmRoutes = new Hono<{ Bindings: Bindings }>()

// ============================================================
// AUTH MIDDLEWARE — Validate customer session token
// Now supports team members: resolves to owner's account
// so team members see/manage the owner's CRM data.
// ============================================================
async function getOwnerId(c: any): Promise<number | null> {
  const auth = c.req.header('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) return null
  const token = auth.slice(7)

  // Try customer session first
  const session = await c.env.DB.prepare(
    "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
  ).bind(token).first<any>()
  if (session) {
    const { ownerId } = await resolveTeamOwner(c.env.DB, session.customer_id)
    return ownerId
  }

  // Fall back to admin session — admin users use a large offset (1,000,000 + admin_id)
  // to create a distinct owner namespace that never collides with customer IDs
  const admin = await validateAdminSession(c.env.DB, auth)
  if (admin) return 1000000 + admin.id

  return null
}

// ============================================================
// HELPER: Resolve customer ID — auto-create if new_customer provided
// ============================================================
async function resolveCustomerId(c: any, ownerId: number, body: any): Promise<{ id: number | null; error?: string }> {
  // If an existing customer ID is provided, use it
  if (body.crm_customer_id) {
    return { id: body.crm_customer_id }
  }
  // If new_customer payload is provided, auto-create a CRM customer
  if (body.new_customer) {
    const nc = body.new_customer
    if (!nc.name || !nc.name.trim()) {
      return { id: null, error: 'New customer name is required' }
    }
    try {
      const result = await c.env.DB.prepare(`
        INSERT INTO crm_customers (owner_id, name, email, phone, company, address, city, province, postal_code, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
      `).bind(
        ownerId, nc.name.trim(), nc.email || null, nc.phone || null,
        nc.company || null, nc.address || null, nc.city || null,
        nc.province || null, nc.postal_code || null
      ).run()
      if (!result.meta.last_row_id) {
        return { id: null, error: 'Failed to create customer' }
      }
      return { id: result.meta.last_row_id as number }
    } catch (err: any) {
      return { id: null, error: 'Failed to create customer: ' + err.message }
    }
  }
  return { id: null, error: 'Customer is required' }
}

// ============================================================
// CRM CUSTOMERS
// ============================================================

// LIST customers for this owner
crmRoutes.get('/customers', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const search = c.req.query('search') || ''
  const status = c.req.query('status') || ''

  let q = `SELECT cc.*, 
    (SELECT COALESCE(SUM(ci.total),0) FROM crm_invoices ci WHERE ci.crm_customer_id = cc.id AND ci.status = 'paid') as lifetime_value,
    (SELECT COUNT(*) FROM crm_invoices ci WHERE ci.crm_customer_id = cc.id) as invoice_count,
    (SELECT COUNT(*) FROM crm_proposals cp WHERE cp.crm_customer_id = cc.id) as proposal_count,
    (SELECT COUNT(*) FROM crm_jobs cj WHERE cj.crm_customer_id = cc.id) as job_count
    FROM crm_customers cc WHERE cc.owner_id = ?`
  const params: any[] = [ownerId]
  if (search) { q += ` AND (cc.name LIKE ? OR cc.email LIKE ? OR cc.phone LIKE ? OR cc.address LIKE ?)`; const s = `%${search}%`; params.push(s, s, s, s) }
  if (status) { q += ` AND cc.status = ?`; params.push(status) }
  q += ` ORDER BY cc.created_at DESC`
  const customers = await c.env.DB.prepare(q).bind(...params).all()

  // Stats
  const stats = await c.env.DB.prepare(`
    SELECT COUNT(*) as total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active_count
    FROM crm_customers WHERE owner_id = ?
  `).bind(ownerId).first()

  return c.json({ customers: customers.results, stats })
})

// GET single customer + history
crmRoutes.get('/customers/:id', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')
  const customer = await c.env.DB.prepare(
    'SELECT * FROM crm_customers WHERE id = ? AND owner_id = ?'
  ).bind(id, ownerId).first()
  if (!customer) return c.json({ error: 'Customer not found' }, 404)

  const invoices = await c.env.DB.prepare(
    'SELECT * FROM crm_invoices WHERE crm_customer_id = ? AND owner_id = ? ORDER BY created_at DESC'
  ).bind(id, ownerId).all()
  const proposals = await c.env.DB.prepare(
    'SELECT * FROM crm_proposals WHERE crm_customer_id = ? AND owner_id = ? ORDER BY created_at DESC'
  ).bind(id, ownerId).all()
  const jobs = await c.env.DB.prepare(
    'SELECT * FROM crm_jobs WHERE crm_customer_id = ? AND owner_id = ? ORDER BY scheduled_date DESC'
  ).bind(id, ownerId).all()

  return c.json({ customer, invoices: invoices.results, proposals: proposals.results, jobs: jobs.results })
})

// CREATE customer
crmRoutes.post('/customers', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  try {
    const { name, email, phone, company, address, city, province, postal_code, notes, tags } = await c.req.json()
    if (!name) return c.json({ error: 'Customer name is required' }, 400)

    const result = await c.env.DB.prepare(`
      INSERT INTO crm_customers (owner_id, name, email, phone, company, address, city, province, postal_code, notes, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(ownerId, name, email || null, phone || null, company || null, address || null, city || null, province || null, postal_code || null, notes || null, tags || null).run()

    // Verify the insert succeeded by reading back
    if (!result.meta.last_row_id) {
      return c.json({ error: 'Database insert failed — no row created. Please try again.' }, 500)
    }

    const saved = await c.env.DB.prepare(
      'SELECT id, name, email FROM crm_customers WHERE id = ? AND owner_id = ?'
    ).bind(result.meta.last_row_id, ownerId).first()

    if (!saved) {
      return c.json({ error: 'Data was not persisted. Please contact support.' }, 500)
    }

    await logFromContext(c, { entity_type: 'crm_customer', entity_id: Number(result.meta.last_row_id), action: 'created', metadata: { name } })
    return c.json({ success: true, id: result.meta.last_row_id, verified: true })
  } catch (err: any) {
    console.error('[CRM] Customer create failed:', err.message)
    return c.json({ error: 'Failed to save customer: ' + err.message }, 500)
  }
})

// UPDATE customer
crmRoutes.put('/customers/:id', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    const result = await c.env.DB.prepare(`
      UPDATE crm_customers SET name=?, email=?, phone=?, company=?, address=?, city=?, province=?, postal_code=?, notes=?, tags=?, status=?, updated_at=datetime('now')
      WHERE id = ? AND owner_id = ?
    `).bind(body.name, body.email || null, body.phone || null, body.company || null, body.address || null, body.city || null, body.province || null, body.postal_code || null, body.notes || null, body.tags || null, body.status || 'active', id, ownerId).run()

    if (!result.meta.changes || result.meta.changes === 0) {
      return c.json({ error: 'No customer found or no changes made.' }, 404)
    }

    return c.json({ success: true, verified: true })
  } catch (err: any) {
    console.error('[CRM] Customer update failed:', err.message)
    return c.json({ error: 'Failed to update customer: ' + err.message }, 500)
  }
})

// DELETE customer
crmRoutes.delete('/customers/:id', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  await c.env.DB.prepare('DELETE FROM crm_customers WHERE id = ? AND owner_id = ?').bind(c.req.param('id'), ownerId).run()
  return c.json({ success: true })
})

// ============================================================
// CRM INVOICES
// ============================================================

function genInvoiceNum() { const d = new Date().toISOString().slice(0,10).replace(/-/g,''); return `INV-${d}-${Math.floor(Math.random()*9999).toString().padStart(4,'0')}` }

crmRoutes.get('/invoices', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const status = c.req.query('status') || ''

  let q = `SELECT ci.*, cc.name as customer_name, cc.email as customer_email, cc.phone as customer_phone
    FROM crm_invoices ci LEFT JOIN crm_customers cc ON cc.id = ci.crm_customer_id WHERE ci.owner_id = ?`
  const params: any[] = [ownerId]
  if (status === 'owing') { q += ` AND ci.status IN ('draft','sent','viewed','overdue')`; }
  else if (status === 'paid') { q += ` AND ci.status = 'paid'`; }
  else if (status) { q += ` AND ci.status = ?`; params.push(status) }
  q += ` ORDER BY ci.created_at DESC`

  const invoices = await c.env.DB.prepare(q).bind(...params).all()
  const stats = await c.env.DB.prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN status='paid' THEN total ELSE 0 END) as total_paid,
      SUM(CASE WHEN status IN ('draft','sent','viewed','overdue') THEN total ELSE 0 END) as total_owing,
      SUM(CASE WHEN status='overdue' THEN total ELSE 0 END) as total_overdue
    FROM crm_invoices WHERE owner_id = ?
  `).bind(ownerId).first()
  return c.json({ invoices: invoices.results, stats })
})

crmRoutes.get('/invoices/:id', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const inv = await c.env.DB.prepare(
    `SELECT ci.*, cc.name as customer_name, cc.email as customer_email, cc.phone as customer_phone, cc.address as customer_address, cc.city as customer_city, cc.province as customer_province, cc.postal_code as customer_postal
     FROM crm_invoices ci LEFT JOIN crm_customers cc ON cc.id = ci.crm_customer_id WHERE ci.id = ? AND ci.owner_id = ?`
  ).bind(c.req.param('id'), ownerId).first()
  if (!inv) return c.json({ error: 'Invoice not found' }, 404)
  const items = await c.env.DB.prepare('SELECT * FROM crm_invoice_items WHERE invoice_id = ? ORDER BY sort_order').bind(c.req.param('id')).all()
  return c.json({ invoice: inv, items: items.results })
})

crmRoutes.post('/invoices', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  try {
    const body = await c.req.json()
    const { items, due_date, notes, terms, tax_rate, title, property_address } = body

    // Resolve customer — either existing or auto-create new
    const custResult = await resolveCustomerId(c, ownerId, body)
    if (!custResult.id) return c.json({ error: custResult.error || 'Customer is required' }, 400)
    const customerId = custResult.id

    const taxR = tax_rate || 5.0
    let subtotal = 0
    if (items && items.length > 0) { for (const it of items) subtotal += (it.quantity || 1) * (it.unit_price || 0) }
    // taxR is a percentage (e.g. 5.0 = 5% GST) — proper rounding to cents
    const taxAmt = Math.round(subtotal * (taxR / 100) * 100) / 100
    const total = Math.round((subtotal + taxAmt) * 100) / 100
    const invNum = genInvoiceNum()

    const result = await c.env.DB.prepare(`
      INSERT INTO crm_invoices (owner_id, crm_customer_id, invoice_number, title, property_address, subtotal, tax_rate, tax_amount, total, due_date, notes, terms, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    `).bind(ownerId, customerId, invNum, title || null, property_address || null, subtotal, taxR, taxAmt, total, due_date || null, notes || null, terms || 'Payment due within 30 days.').run()

    const invoiceId = result.meta.last_row_id
    if (!invoiceId) {
      return c.json({ error: 'Failed to create invoice — database write failed.' }, 500)
    }

    if (items && items.length > 0) {
      // batch() so line-item inserts commit atomically with each other.
      const stmts = items.map((it: any, i: number) => {
        const amt = (it.quantity || 1) * (it.unit_price || 0)
        return c.env.DB.prepare(
          'INSERT INTO crm_invoice_items (invoice_id, description, quantity, unit, unit_price, amount, sort_order) VALUES (?,?,?,?,?,?,?)'
        ).bind(invoiceId, it.description || '', it.quantity || 1, it.unit || 'each', it.unit_price || 0, amt, i)
      })
      await c.env.DB.batch(stmts)
    }
    return c.json({ success: true, id: invoiceId, invoice_number: invNum })
  } catch (err: any) {
    console.error('[CRM] Invoice create failed:', err.message)
    return c.json({ error: 'Failed to save invoice: ' + err.message }, 500)
  }
})

crmRoutes.put('/invoices/:id', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const body = await c.req.json()
  const id = c.req.param('id')
  
  // If updating status
  if (body.status) {
    let extra = ''
    if (body.status === 'paid') extra = ", paid_date = date('now')"
    if (body.status === 'sent') extra = ", sent_date = date('now')"
    await c.env.DB.prepare(`UPDATE crm_invoices SET status = ?${extra}, updated_at = datetime('now') WHERE id = ? AND owner_id = ?`).bind(body.status, id, ownerId).run()
    return c.json({ success: true })
  }

  // Full update with items
  const taxR = body.tax_rate || 5.0
  let subtotal = 0
  if (body.items) { for (const it of body.items) subtotal += (it.quantity || 1) * (it.unit_price || 0) }
  // taxR is a percentage (e.g. 5.0 = 5% GST) — proper rounding to cents
  const taxAmt = Math.round(subtotal * (taxR / 100) * 100) / 100
  const total = Math.round((subtotal + taxAmt) * 100) / 100

  await c.env.DB.prepare(`
    UPDATE crm_invoices SET crm_customer_id=?, title=?, property_address=?, subtotal=?, tax_rate=?, tax_amount=?, total=?, due_date=?, notes=?, terms=?, updated_at=datetime('now')
    WHERE id=? AND owner_id=?
  `).bind(body.crm_customer_id, body.title || null, body.property_address || null, subtotal, taxR, taxAmt, total, body.due_date || null, body.notes || null, body.terms || null, id, ownerId).run()

  // Replace items atomically: delete + re-insert in a single batch.
  const stmts: any[] = [
    c.env.DB.prepare('DELETE FROM crm_invoice_items WHERE invoice_id = ?').bind(id)
  ]
  if (body.items && body.items.length > 0) {
    body.items.forEach((it: any, i: number) => {
      stmts.push(c.env.DB.prepare(
        'INSERT INTO crm_invoice_items (invoice_id, description, quantity, unit, unit_price, amount, sort_order) VALUES (?,?,?,?,?,?,?)'
      ).bind(id, it.description || '', it.quantity || 1, it.unit || 'each', it.unit_price || 0, (it.quantity || 1) * (it.unit_price || 0), i))
    })
  }
  await c.env.DB.batch(stmts)
  return c.json({ success: true })
})

crmRoutes.delete('/invoices/:id', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  await c.env.DB.prepare('DELETE FROM crm_invoice_items WHERE invoice_id = ?').bind(c.req.param('id')).run()
  await c.env.DB.prepare('DELETE FROM crm_invoices WHERE id = ? AND owner_id = ?').bind(c.req.param('id'), ownerId).run()
  return c.json({ success: true })
})

// ============================================================
// INVOICE: Generate Square payment link
// ============================================================
crmRoutes.post('/invoices/:id/payment-link', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')

  const invoice = await c.env.DB.prepare(
    `SELECT ci.*, cc.name as customer_name FROM crm_invoices ci
     LEFT JOIN crm_customers cc ON cc.id = ci.crm_customer_id
     WHERE ci.id = ? AND ci.owner_id = ?`
  ).bind(id, ownerId).first<any>()
  if (!invoice) return c.json({ error: 'Invoice not found' }, 404)

  // Get owner's Square access token (per-user OAuth first, then master)
  const owner = await c.env.DB.prepare(
    'SELECT square_merchant_access_token, square_merchant_location_id FROM customers WHERE id = ?'
  ).bind(ownerId).first<any>()

  const accessToken = owner?.square_merchant_access_token || (c.env as any).SQUARE_ACCESS_TOKEN
  const locationId = owner?.square_merchant_location_id || (c.env as any).SQUARE_LOCATION_ID

  if (!accessToken || !locationId) {
    return c.json({ error: 'Square is not connected. Go to Settings → Connect Square to enable payment links.' }, 503)
  }

  const amountCents = Math.round((invoice.total || 0) * 100)
  if (amountCents <= 0) return c.json({ error: 'Invoice total must be greater than $0' }, 400)

  const title = invoice.title || `Invoice ${invoice.invoice_number}`
  const desc = invoice.customer_name ? `Invoice for ${invoice.customer_name}` : invoice.invoice_number

  try {
    const resp = await fetch('https://connect.squareup.com/v2/online-checkout/payment-links', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Square-Version': '2024-01-18'
      },
      body: JSON.stringify({
        idempotency_key: `invoice-${id}-${Date.now()}`,
        quick_pay: {
          name: title,
          price_money: { amount: amountCents, currency: 'CAD' },
          location_id: locationId
        },
        description: desc
      })
    })
    const data: any = await resp.json()
    if (!resp.ok) {
      const msg = data.errors?.[0]?.detail || `Square error (${resp.status})`
      return c.json({ error: msg }, 502)
    }
    const link = data.payment_link
    const checkoutUrl = link?.url || link?.long_url
    if (!checkoutUrl) return c.json({ error: 'Square did not return a checkout URL' }, 502)

    await c.env.DB.prepare(
      "UPDATE crm_invoices SET square_payment_link_url = ?, square_payment_link_id = ?, updated_at = datetime('now') WHERE id = ? AND owner_id = ?"
    ).bind(checkoutUrl, link.id, id, ownerId).run()

    return c.json({ success: true, checkout_url: checkoutUrl, payment_link_id: link.id })
  } catch (err: any) {
    return c.json({ error: 'Square request failed: ' + err.message }, 502)
  }
})

// ============================================================
// PROPOSAL: Generate Square payment link
// ============================================================
crmRoutes.post('/proposals/:id/payment-link', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')

  const proposal = await c.env.DB.prepare(
    `SELECT cp.*, cc.name as customer_name FROM crm_proposals cp
     LEFT JOIN crm_customers cc ON cc.id = cp.crm_customer_id
     WHERE cp.id = ? AND cp.owner_id = ?`
  ).bind(id, ownerId).first<any>()
  if (!proposal) return c.json({ error: 'Proposal not found' }, 404)

  const owner = await c.env.DB.prepare(
    'SELECT square_merchant_access_token, square_merchant_location_id FROM customers WHERE id = ?'
  ).bind(ownerId).first<any>()

  const accessToken = owner?.square_merchant_access_token || (c.env as any).SQUARE_ACCESS_TOKEN
  const locationId = owner?.square_merchant_location_id || (c.env as any).SQUARE_LOCATION_ID

  if (!accessToken || !locationId) {
    return c.json({ error: 'Square is not connected. Go to Settings → Connect Square to enable payment links.' }, 503)
  }

  const amountCents = Math.round((proposal.total_amount || 0) * 100)
  if (amountCents <= 0) return c.json({ error: 'Proposal total must be greater than $0' }, 400)

  const title = proposal.title || `Proposal ${proposal.proposal_number}`
  const desc = proposal.customer_name ? `Proposal for ${proposal.customer_name}` : proposal.proposal_number

  try {
    const resp = await fetch('https://connect.squareup.com/v2/online-checkout/payment-links', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Square-Version': '2025-01-23'
      },
      body: JSON.stringify({
        idempotency_key: `proposal-${id}-${Date.now()}`,
        quick_pay: {
          name: title,
          price_money: { amount: amountCents, currency: 'CAD' },
          location_id: locationId
        },
        description: desc
      })
    })
    const data: any = await resp.json()
    if (!resp.ok) {
      const msg = data.errors?.[0]?.detail || `Square error (${resp.status})`
      return c.json({ error: msg }, 502)
    }
    const link = data.payment_link
    const checkoutUrl = link?.url || link?.long_url
    if (!checkoutUrl) return c.json({ error: 'Square did not return a checkout URL' }, 502)

    await c.env.DB.prepare(
      "UPDATE crm_proposals SET payment_link = ?, updated_at = datetime('now') WHERE id = ? AND owner_id = ?"
    ).bind(checkoutUrl, id, ownerId).run()

    return c.json({ success: true, checkout_url: checkoutUrl, payment_link_id: link.id })
  } catch (err: any) {
    return c.json({ error: 'Square request failed: ' + err.message }, 502)
  }
})

// ============================================================
// INVOICE: Send via Gmail (+ optional Square payment link)
// ============================================================
crmRoutes.post('/invoices/:id/send', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')

  const invoice = await c.env.DB.prepare(`
    SELECT ci.*, cc.name as customer_name, cc.email as customer_email,
           cc.phone as customer_phone, cc.address as customer_address,
           cc.city as customer_city, cc.province as customer_province
    FROM crm_invoices ci LEFT JOIN crm_customers cc ON cc.id = ci.crm_customer_id
    WHERE ci.id = ? AND ci.owner_id = ?
  `).bind(id, ownerId).first<any>()
  if (!invoice) return c.json({ error: 'Invoice not found' }, 404)

  const itemsResult = await c.env.DB.prepare(
    'SELECT * FROM crm_invoice_items WHERE invoice_id = ? ORDER BY sort_order'
  ).bind(id).all()
  const lineItems = itemsResult.results || []

  // Generate share token
  let shareToken = invoice.share_token
  if (!shareToken) shareToken = crypto.randomUUID().replace(/-/g, '').substring(0, 16)

  await c.env.DB.prepare(
    "UPDATE crm_invoices SET status = 'sent', share_token = ?, sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND owner_id = ?"
  ).bind(shareToken, id, ownerId).run()

  const baseUrl = new URL(c.req.url).origin
  const publicLink = `${baseUrl}/invoice/view/${shareToken}`

  // Get owner branding + Gmail tokens
  const owner = await c.env.DB.prepare(
    'SELECT gmail_refresh_token, gmail_connected_email, name, email, brand_business_name, brand_logo_url, brand_primary_color FROM customers WHERE id = ?'
  ).bind(ownerId).first<any>()

  let emailSent = false
  let emailError = ''

  if (owner?.gmail_refresh_token && invoice.customer_email) {
    const clientId = (c.env as any).GMAIL_CLIENT_ID
    let clientSecret = (c.env as any).GMAIL_CLIENT_SECRET || ''
    if (!clientSecret) {
      try {
        const csRow = await c.env.DB.prepare(
          "SELECT setting_value FROM settings WHERE setting_key = 'gmail_client_secret' AND master_company_id = 1"
        ).first<any>()
        if (csRow?.setting_value) clientSecret = csRow.setting_value
      } catch {}
    }

    if (clientId && clientSecret) {
      try {
        const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: owner.gmail_refresh_token,
            client_id: clientId,
            client_secret: clientSecret
          }).toString()
        })
        const tokenData: any = await tokenResp.json()

        if (tokenData.access_token) {
          const businessName = owner.brand_business_name || owner.name || 'Your Roofer'
          const fromEmail = owner.gmail_connected_email || owner.email
          const primaryColor = owner.brand_primary_color || '#0369a1'
          const payUrl = invoice.square_payment_link_url || null
          const dueLabel = invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }) : null

          let itemsHtml = ''
          if (lineItems.length > 0) {
            itemsHtml = '<table style="width:100%;border-collapse:collapse;margin:0 0 12px;">'
            itemsHtml += '<tr style="background:#f1f5f9;"><td style="color:#475569;font-size:11px;font-weight:600;padding:6px 8px;">Description</td><td style="color:#475569;font-size:11px;font-weight:600;padding:6px 8px;text-align:center;">Qty</td><td style="color:#475569;font-size:11px;font-weight:600;padding:6px 8px;text-align:right;">Price</td><td style="color:#475569;font-size:11px;font-weight:600;padding:6px 8px;text-align:right;">Amount</td></tr>'
            for (const item of lineItems) {
              itemsHtml += `<tr><td style="color:#374151;font-size:12px;padding:6px 8px;border-bottom:1px solid #f1f5f9;">${(item as any).description}</td><td style="color:#374151;font-size:12px;padding:6px 8px;text-align:center;border-bottom:1px solid #f1f5f9;">${(item as any).quantity}</td><td style="color:#374151;font-size:12px;padding:6px 8px;text-align:right;border-bottom:1px solid #f1f5f9;">$${parseFloat((item as any).unit_price).toFixed(2)}</td><td style="color:#374151;font-size:12px;padding:6px 8px;text-align:right;border-bottom:1px solid #f1f5f9;">$${parseFloat((item as any).amount).toFixed(2)}</td></tr>`
            }
            itemsHtml += '</table>'
          }

          const emailHtml = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
  <div style="background:${primaryColor};padding:32px;border-radius:12px 12px 0 0;">
    ${owner.brand_logo_url ? `<img src="${owner.brand_logo_url}" alt="${businessName}" style="max-height:48px;margin-bottom:8px;">` : ''}
    <h1 style="color:#ffffff;margin:0;font-size:22px;">${businessName}</h1>
    <p style="color:rgba(255,255,255,0.7);margin:8px 0 0;font-size:14px;">Invoice &middot; ${invoice.invoice_number}</p>
  </div>
  <div style="padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
    <p style="color:#374151;font-size:16px;margin:0 0 8px;">Hi ${invoice.customer_name || 'there'},</p>
    <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0 0 24px;">Please find your invoice below. ${dueLabel ? `Payment is due by <strong>${dueLabel}</strong>.` : ''}</p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:0 0 24px;">
      ${invoice.title ? `<p style="font-weight:600;color:#1e293b;margin:0 0 12px;">${invoice.title}</p>` : ''}
      ${invoice.property_address ? `<p style="color:#64748b;font-size:13px;margin:0 0 12px;"><strong>Property:</strong> ${invoice.property_address}</p>` : ''}
      ${itemsHtml}
      <table style="width:100%;border-collapse:collapse;">
        ${invoice.subtotal ? `<tr><td style="color:#6b7280;font-size:13px;padding:4px 0;">Subtotal</td><td style="color:#1e293b;font-size:13px;text-align:right;">$${parseFloat(invoice.subtotal).toFixed(2)}</td></tr>` : ''}
        ${invoice.tax_amount ? `<tr><td style="color:#6b7280;font-size:13px;padding:4px 0;">Tax (${invoice.tax_rate || 5}%)</td><td style="color:#1e293b;font-size:13px;text-align:right;">$${parseFloat(invoice.tax_amount).toFixed(2)}</td></tr>` : ''}
        <tr><td colspan="2" style="border-top:1px solid #e2e8f0;padding-top:8px;"></td></tr>
        <tr><td style="color:${primaryColor};font-size:18px;font-weight:700;padding:4px 0;">Total Due</td><td style="color:${primaryColor};font-size:18px;font-weight:700;text-align:right;">$${parseFloat(invoice.total).toFixed(2)} CAD</td></tr>
      </table>
    </div>
    ${payUrl ? `
    <div style="text-align:center;margin:0 0 16px;">
      <a href="${payUrl}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;padding:14px 40px;border-radius:8px;font-weight:600;font-size:15px;">
        <span style="margin-right:8px;">💳</span>Pay Now Online
      </a>
    </div>` : ''}
    <div style="text-align:center;margin:0 0 24px;">
      <a href="${publicLink}" style="display:inline-block;background:${primaryColor};color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:600;font-size:14px;">
        View Invoice Online
      </a>
    </div>
    ${invoice.notes ? `<p style="color:#374151;font-size:13px;margin:0 0 8px;"><strong>Notes:</strong> ${invoice.notes}</p>` : ''}
    ${invoice.terms ? `<p style="color:#9ca3af;font-size:12px;margin:0;">${invoice.terms}</p>` : ''}
  </div>
  <p style="color:#9ca3af;font-size:11px;text-align:center;margin:16px 0 0;padding:0;">
    Sent via Roof Manager &middot; ${fromEmail} &middot; <a href="mailto:sales@roofmanager.ca" style="color:#9ca3af;">sales@roofmanager.ca</a>
  </p>
</div>`

          const subject = `Invoice ${invoice.invoice_number}${invoice.title ? ` — ${invoice.title}` : ''}`
          const boundary = 'boundary_' + crypto.randomUUID().replace(/-/g, '').substring(0, 16)
          const rawMessage = [
            `From: ${businessName} <${fromEmail}>`,
            `To: ${invoice.customer_email}`,
            `Subject: ${subject}`,
            'MIME-Version: 1.0',
            `Content-Type: multipart/alternative; boundary="${boundary}"`,
            '',
            `--${boundary}`,
            'Content-Type: text/plain; charset=UTF-8',
            '',
            `Hi ${invoice.customer_name || 'there'},\n\nPlease find your invoice ${invoice.invoice_number}.\n\nTotal Due: $${parseFloat(invoice.total).toFixed(2)} CAD${dueLabel ? `\nDue: ${dueLabel}` : ''}\n\nView invoice: ${publicLink}${payUrl ? `\nPay now: ${payUrl}` : ''}\n\nBest regards,\n${businessName}`,
            '',
            `--${boundary}`,
            'Content-Type: text/html; charset=UTF-8',
            '',
            emailHtml,
            '',
            `--${boundary}--`
          ].join('\r\n')

          const encoded = btoa(unescape(encodeURIComponent(rawMessage)))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

          const sendResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ raw: encoded })
          })

          if (sendResp.ok) {
            emailSent = true
          } else {
            const errData: any = await sendResp.json().catch(() => ({}))
            emailError = errData?.error?.message || `Gmail error (${sendResp.status})`
          }
        } else {
          emailError = 'Could not refresh Gmail token. Please reconnect Gmail.'
        }
      } catch (e: any) {
        emailError = e.message || 'Gmail send failed'
      }
    }
  } else if (!owner?.gmail_refresh_token) {
    emailError = 'Gmail not connected. Connect Gmail in Settings to send invoices by email.'
  } else {
    emailError = 'Customer has no email address on file.'
  }

  return c.json({
    success: true,
    share_token: shareToken,
    public_link: publicLink,
    email_sent: emailSent,
    email_error: emailError || null,
    sent_to: emailSent ? invoice.customer_email : null
  })
})

// ============================================================
// CRM PROPOSALS — with line items, tax, warranty, Gmail send
// ============================================================

function genProposalNum() { const d = new Date().toISOString().slice(0,10).replace(/-/g,''); return `PROP-${d}-${Math.floor(Math.random()*9999).toString().padStart(4,'0')}` }

// LIST proposals
crmRoutes.get('/proposals', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const status = c.req.query('status') || ''
  let q = `SELECT cp.*, cc.name as customer_name, cc.email as customer_email, COALESCE(cp.view_count, 0) as view_count FROM crm_proposals cp LEFT JOIN crm_customers cc ON cc.id = cp.crm_customer_id WHERE cp.owner_id = ?`
  const params: any[] = [ownerId]
  if (status === 'open') q += ` AND cp.status IN ('draft','sent','viewed')`
  else if (status === 'sold') q += ` AND cp.status = 'accepted'`
  else if (status) { q += ` AND cp.status = ?`; params.push(status) }
  q += ` ORDER BY cp.created_at DESC`
  const proposals = await c.env.DB.prepare(q).bind(...params).all()

  const stats = await c.env.DB.prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN status IN ('draft','sent','viewed') THEN total_amount ELSE 0 END) as open_value,
      SUM(CASE WHEN status = 'accepted' THEN total_amount ELSE 0 END) as sold_value,
      SUM(CASE WHEN status IN ('draft','sent','viewed') THEN 1 ELSE 0 END) as open_count,
      SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as sold_count
    FROM crm_proposals WHERE owner_id = ?
  `).bind(ownerId).first()
  return c.json({ proposals: proposals.results, stats })
})

// GET single proposal with line items
crmRoutes.get('/proposals/:id', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')
  const proposal = await c.env.DB.prepare(`
    SELECT cp.*, cc.name as customer_name, cc.email as customer_email, cc.phone as customer_phone,
           cc.address as customer_address, cc.city as customer_city, cc.province as customer_province
    FROM crm_proposals cp LEFT JOIN crm_customers cc ON cc.id = cp.crm_customer_id
    WHERE cp.id = ? AND cp.owner_id = ?
  `).bind(id, ownerId).first<any>()
  if (!proposal) return c.json({ error: 'Proposal not found' }, 404)
  const items = await c.env.DB.prepare('SELECT * FROM crm_proposal_items WHERE proposal_id = ? ORDER BY sort_order').bind(id).all()
  return c.json({ proposal, items: items.results })
})

// C-4: Generate tiered pricing from a report (used by confirmation page)
crmRoutes.post('/proposals/from-report', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  try {
    const { report_id } = await c.req.json()
    const report = await c.env.DB.prepare(
      'SELECT * FROM reports WHERE id = ?'
    ).bind(report_id).first<any>()
    const totalArea = report?.total_area || report?.roof_area || 0
    const tiers = [
      { label: 'Basic', scope: '3-tab shingles, standard installation', price_per_sq: 280, total: Math.round(totalArea * 280 / 100) },
      { label: 'Standard', scope: 'Architectural shingles, ice/water shield, ridge cap', price_per_sq: 380, total: Math.round(totalArea * 380 / 100) },
      { label: 'Premium', scope: 'Impact-resistant shingles, full synthetic underlay, lifetime warranty', price_per_sq: 520, total: Math.round(totalArea * 520 / 100) },
    ]
    return c.json({ tiers, measurements: { total_area: totalArea } })
  } catch (err: any) {
    return c.json({ error: 'Failed to generate tiers: ' + err.message }, 500)
  }
})

// C-4: Create one proposal per pricing tier (used by confirmation page)
crmRoutes.post('/proposals/create-tiered', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  try {
    const { customer_id, property_address, scope_of_work, report_id, tiers } = await c.req.json()
    const created: { id: number; label: string; total: number }[] = []
    for (const tier of (tiers || [])) {
      const propNum = genProposalNum()
      const total = tier.total || 0
      const taxAmount = Math.round(total * 0.05 * 100) / 100
      const result = await c.env.DB.prepare(`
        INSERT INTO crm_proposals (owner_id, crm_customer_id, proposal_number, title, property_address,
          scope_of_work, subtotal, tax_rate, tax_amount, total_amount, source_report_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 5, ?, ?, ?, 'draft')
      `).bind(
        ownerId, customer_id || null, propNum,
        tier.label + (property_address ? ' — ' + property_address : ''),
        property_address || null,
        tier.scope || scope_of_work || null,
        total, taxAmount, Math.round((total + taxAmount) * 100) / 100,
        report_id || null
      ).run()
      created.push({ id: result.meta.last_row_id as number, label: tier.label, total })
    }
    return c.json({ success: true, proposals: created })
  } catch (err: any) {
    return c.json({ error: 'Failed to create tiered proposals: ' + err.message }, 500)
  }
})

// CREATE proposal with line items
crmRoutes.post('/proposals', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  try {
    const body = await c.req.json()
    if (!body.title) return c.json({ error: 'Title is required' }, 400)

    // Resolve customer — either existing or auto-create new
    const custResult = await resolveCustomerId(c, ownerId, body)
    if (!custResult.id) return c.json({ error: custResult.error || 'Customer is required' }, 400)
    const customerId = custResult.id

    const taxRate = body.tax_rate ?? 5.0
    let subtotal = 0

    // If line items provided, calculate from them
    if (body.items && body.items.length > 0) {
      for (const it of body.items) subtotal += (it.quantity || 1) * (it.unit_price || 0)
    } else {
      // Legacy: simple labor/material/other
      subtotal = (body.labor_cost || 0) + (body.material_cost || 0) + (body.other_cost || 0)
    }
    const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100
    const total = Math.round((subtotal + taxAmount) * 100) / 100
    const propNum = genProposalNum()

    const result = await c.env.DB.prepare(`
      INSERT INTO crm_proposals (owner_id, crm_customer_id, proposal_number, title, property_address, scope_of_work,
        materials_detail, labor_cost, material_cost, other_cost, subtotal, tax_rate, tax_amount, total_amount,
        valid_until, notes, warranty_terms, payment_terms, source_report_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    `).bind(ownerId, customerId, propNum, body.title, body.property_address || null,
      body.scope_of_work || null, body.materials_detail || null,
      body.labor_cost || 0, body.material_cost || 0, body.other_cost || 0,
      subtotal, taxRate, taxAmount, total,
      body.valid_until || null, body.notes || null,
      body.warranty_terms || null, body.payment_terms || null,
      body.source_report_id || null).run()

    const proposalId = result.meta.last_row_id
    if (!proposalId) return c.json({ error: 'Failed to create proposal' }, 500)

    await logFromContext(c, { entity_type: 'proposal', entity_id: Number(proposalId), action: 'created', metadata: { proposal_number: propNum, title: body.title, total } })

    // Insert line items
    if (body.items && body.items.length > 0) {
      for (let i = 0; i < body.items.length; i++) {
        const it = body.items[i]
        const amt = Math.round((it.quantity || 1) * (it.unit_price || 0) * 100) / 100
        await c.env.DB.prepare(
          'INSERT INTO crm_proposal_items (proposal_id, description, quantity, unit, unit_price, amount, sort_order) VALUES (?,?,?,?,?,?,?)'
        ).bind(proposalId, it.description || '', it.quantity || 1, it.unit || 'ea', it.unit_price || 0, amt, i).run()
      }
    }
    return c.json({ success: true, id: proposalId, proposal_number: propNum })
  } catch (err: any) {
    console.error('[CRM] Proposal create failed:', err.message)
    return c.json({ error: 'Failed to save proposal: ' + err.message }, 500)
  }
})

// UPDATE proposal with line items
crmRoutes.put('/proposals/:id', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  try {
    const body = await c.req.json()
    const id = c.req.param('id')

    // Quick status-only update
    if (body.status && Object.keys(body).length <= 2) {
      await c.env.DB.prepare("UPDATE crm_proposals SET status = ?, updated_at = datetime('now') WHERE id = ? AND owner_id = ?").bind(body.status, id, ownerId).run()
      return c.json({ success: true })
    }
    // Quick source_report_id-only update
    if ('source_report_id' in body && Object.keys(body).length === 1) {
      await c.env.DB.prepare("UPDATE crm_proposals SET source_report_id = ?, updated_at = datetime('now') WHERE id = ? AND owner_id = ?").bind(body.source_report_id ?? null, id, ownerId).run()
      return c.json({ success: true })
    }

    // Resolve customer — either existing or auto-create new
    const custResult = await resolveCustomerId(c, ownerId, body)
    if (!custResult.id) return c.json({ error: custResult.error || 'Customer is required' }, 400)
    const customerId = custResult.id

    const taxRate = body.tax_rate ?? 5.0
    let subtotal = 0
    if (body.items && body.items.length > 0) {
      for (const it of body.items) subtotal += (it.quantity || 1) * (it.unit_price || 0)
    } else {
      subtotal = (body.labor_cost || 0) + (body.material_cost || 0) + (body.other_cost || 0)
    }
    const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100
    const total = Math.round((subtotal + taxAmount) * 100) / 100

    await c.env.DB.prepare(`
      UPDATE crm_proposals SET crm_customer_id=?, title=?, property_address=?, scope_of_work=?, materials_detail=?,
        labor_cost=?, material_cost=?, other_cost=?, subtotal=?, tax_rate=?, tax_amount=?, total_amount=?,
        valid_until=?, notes=?, warranty_terms=?, payment_terms=?, status=?, source_report_id=?, updated_at=datetime('now')
      WHERE id=? AND owner_id=?
    `).bind(customerId, body.title, body.property_address || null, body.scope_of_work || null,
      body.materials_detail || null, body.labor_cost || 0, body.material_cost || 0, body.other_cost || 0,
      subtotal, taxRate, taxAmount, total, body.valid_until || null, body.notes || null,
      body.warranty_terms || null, body.payment_terms || null,
      body.status || 'draft', body.source_report_id ?? null, id, ownerId).run()

    // Replace line items
    if (body.items) {
      await c.env.DB.prepare('DELETE FROM crm_proposal_items WHERE proposal_id = ?').bind(id).run()
      for (let i = 0; i < body.items.length; i++) {
        const it = body.items[i]
        const amt = Math.round((it.quantity || 1) * (it.unit_price || 0) * 100) / 100
        await c.env.DB.prepare(
          'INSERT INTO crm_proposal_items (proposal_id, description, quantity, unit, unit_price, amount, sort_order) VALUES (?,?,?,?,?,?,?)'
        ).bind(id, it.description || '', it.quantity || 1, it.unit || 'ea', it.unit_price || 0, amt, i).run()
      }
    }
    return c.json({ success: true })
  } catch (err: any) {
    console.error('[CRM] Proposal update failed:', err.message)
    return c.json({ error: 'Failed to update proposal: ' + err.message }, 500)
  }
})

// DELETE proposal + its items
crmRoutes.delete('/proposals/:id', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM crm_proposal_items WHERE proposal_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM proposal_view_log WHERE proposal_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM crm_proposals WHERE id = ? AND owner_id = ?').bind(id, ownerId).run()
  return c.json({ success: true })
})

// Get proposal view stats + detailed log
crmRoutes.get('/proposals/:id/views', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')

  const proposal = await c.env.DB.prepare(
    'SELECT view_count, last_viewed_at, share_token, sent_at FROM crm_proposals WHERE id = ? AND owner_id = ?'
  ).bind(id, ownerId).first<any>()
  if (!proposal) return c.json({ error: 'Proposal not found' }, 404)

  // Get detailed view log
  const viewLog = await c.env.DB.prepare(`
    SELECT viewed_at, ip_address, user_agent, referrer FROM proposal_view_log
    WHERE proposal_id = ? ORDER BY viewed_at DESC LIMIT 50
  `).bind(id).all()

  return c.json({
    view_count: proposal.view_count || 0,
    last_viewed_at: proposal.last_viewed_at,
    sent_at: proposal.sent_at,
    share_token: proposal.share_token,
    view_log: viewLog.results
  })
})

// ============================================================
// CRM JOBS
// ============================================================

function genJobNum() { const d = new Date().toISOString().slice(0,10).replace(/-/g,''); return `JOB-${d}-${Math.floor(Math.random()*9999).toString().padStart(4,'0')}` }

const DEFAULT_CHECKLIST = [
  { item_type: 'permit', label: 'Building Permit', sort_order: 0 },
  { item_type: 'material', label: 'Material Delivery', sort_order: 1 },
  { item_type: 'dumpster', label: 'Dumpster Ordered', sort_order: 2 },
  { item_type: 'inspection', label: 'Final Inspection', sort_order: 3 },
]

crmRoutes.get('/jobs', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const month = c.req.query('month') || ''
  const status = c.req.query('status') || ''

  let q = `SELECT cj.*, cc.name as customer_name, cc.phone as customer_phone
    FROM crm_jobs cj LEFT JOIN crm_customers cc ON cc.id = cj.crm_customer_id WHERE cj.owner_id = ?`
  const params: any[] = [ownerId]
  if (month) { q += ` AND cj.scheduled_date LIKE ?`; params.push(`${month}%`) }
  if (status) { q += ` AND cj.status = ?`; params.push(status) }
  q += ` ORDER BY cj.scheduled_date ASC`
  const jobs = await c.env.DB.prepare(q).bind(...params).all()

  const stats = await c.env.DB.prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN status='scheduled' THEN 1 ELSE 0 END) as scheduled,
      SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) as in_progress,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed
    FROM crm_jobs WHERE owner_id = ?
  `).bind(ownerId).first()
  return c.json({ jobs: jobs.results, stats })
})

// Schedule/assign a job to a crew member on a date (dispatch board drag-and-drop)
crmRoutes.post('/jobs/schedule', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const { jobId, crewMemberId, scheduledDate, scheduledTime } = await c.req.json()
  if (!jobId || !scheduledDate) return c.json({ error: 'jobId and scheduledDate required' }, 400)

  // Verify job belongs to owner
  const job = await c.env.DB.prepare('SELECT id FROM crm_jobs WHERE id = ? AND owner_id = ?').bind(jobId, ownerId).first()
  if (!job) return c.json({ error: 'Job not found' }, 404)

  // Update job schedule — clear stale route_order since any reassignment invalidates it
  await c.env.DB.prepare(
    `UPDATE crm_jobs SET scheduled_date = ?, scheduled_time = ?, route_order = NULL, status = CASE WHEN status IN ('', 'cancelled', 'postponed') THEN 'scheduled' ELSE status END, updated_at = datetime('now') WHERE id = ?`
  ).bind(scheduledDate, scheduledTime || null, jobId).run()

  // Assign crew member if provided — UNIQUE index on (job_id, crew_member_id) prevents duplicates
  if (crewMemberId) {
    await c.env.DB.prepare('INSERT OR IGNORE INTO job_crew_assignments (job_id, crew_member_id, role) VALUES (?, ?, ?)').bind(jobId, crewMemberId, 'crew').run()
  }
  return c.json({ success: true })
})

crmRoutes.get('/jobs/:id', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')
  const job = await c.env.DB.prepare(
    `SELECT cj.*, cc.name as customer_name, cc.phone as customer_phone, cc.address as customer_address
     FROM crm_jobs cj LEFT JOIN crm_customers cc ON cc.id = cj.crm_customer_id WHERE cj.id = ? AND cj.owner_id = ?`
  ).bind(id, ownerId).first()
  if (!job) return c.json({ error: 'Job not found' }, 404)
  const checklist = await c.env.DB.prepare('SELECT * FROM crm_job_checklist WHERE job_id = ? ORDER BY sort_order').bind(id).all()
  return c.json({ job, checklist: checklist.results })
})

crmRoutes.post('/jobs', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const body = await c.req.json()
  if (!body.title || !body.scheduled_date) return c.json({ error: 'Title and date required' }, 400)

  // Resolve customer — either existing or auto-create new (optional for jobs)
  let customerId = body.crm_customer_id || null
  if (!customerId && body.new_customer && body.new_customer.name) {
    const custResult = await resolveCustomerId(c, ownerId, body)
    if (custResult.id) customerId = custResult.id
  }

  const jobNum = genJobNum()
  const result = await c.env.DB.prepare(`
    INSERT INTO crm_jobs (owner_id, crm_customer_id, proposal_id, job_number, title, property_address, job_type, scheduled_date, scheduled_time, estimated_duration, crew_size, notes, material_delivery_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')
  `).bind(ownerId, customerId, body.proposal_id || null, jobNum, body.title, body.property_address || null, body.job_type || 'install', body.scheduled_date, body.scheduled_time || null, body.estimated_duration || null, body.crew_size || null, body.notes || null, body.material_delivery_date || null).run()

  const jobId = result.meta.last_row_id
  // Seed default checklist
  for (const item of DEFAULT_CHECKLIST) {
    await c.env.DB.prepare(
      'INSERT INTO crm_job_checklist (job_id, item_type, label, sort_order) VALUES (?,?,?,?)'
    ).bind(jobId, item.item_type, item.label, item.sort_order).run()
  }
  return c.json({ success: true, id: jobId, job_number: jobNum })
})

crmRoutes.put('/jobs/:id', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const body = await c.req.json()
  const id = c.req.param('id')

  if (body.status && Object.keys(body).length <= 2) {
    let extra = ''
    if (body.status === 'completed') extra = ", completed_date = date('now')"
    await c.env.DB.prepare(`UPDATE crm_jobs SET status = ?${extra}, updated_at = datetime('now') WHERE id = ? AND owner_id = ?`).bind(body.status, id, ownerId).run()
    return c.json({ success: true })
  }

  await c.env.DB.prepare(`
    UPDATE crm_jobs SET crm_customer_id=?, title=?, property_address=?, job_type=?, scheduled_date=?, scheduled_time=?, estimated_duration=?, crew_size=?, notes=?, material_delivery_date=?, status=?, updated_at=datetime('now')
    WHERE id=? AND owner_id=?
  `).bind(body.crm_customer_id || null, body.title, body.property_address || null, body.job_type || 'install', body.scheduled_date, body.scheduled_time || null, body.estimated_duration || null, body.crew_size || null, body.notes || null, body.material_delivery_date || null, body.status || 'scheduled', id, ownerId).run()
  return c.json({ success: true })
})

// Toggle checklist item
crmRoutes.put('/jobs/:jobId/checklist/:itemId', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const { jobId, itemId } = c.req.param() as any
  const body = await c.req.json()

  // Verify job ownership
  const job = await c.env.DB.prepare('SELECT id FROM crm_jobs WHERE id = ? AND owner_id = ?').bind(jobId, ownerId).first()
  if (!job) return c.json({ error: 'Job not found' }, 404)

  await c.env.DB.prepare(`
    UPDATE crm_job_checklist SET is_completed = ?, completed_at = ?, notes = ? WHERE id = ? AND job_id = ?
  `).bind(body.is_completed ? 1 : 0, body.is_completed ? new Date().toISOString() : null, body.notes || null, itemId, jobId).run()
  return c.json({ success: true })
})

// Add custom checklist item
crmRoutes.post('/jobs/:jobId/checklist', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const jobId = c.req.param('jobId')
  const body = await c.req.json()
  if (!body.label || !body.label.trim()) return c.json({ error: 'Checklist item label is required' }, 400)

  // Verify job ownership
  const job = await c.env.DB.prepare('SELECT id FROM crm_jobs WHERE id = ? AND owner_id = ?').bind(jobId, ownerId).first()
  if (!job) return c.json({ error: 'Job not found' }, 404)

  // Get max sort_order for this job
  const maxOrder = await c.env.DB.prepare('SELECT COALESCE(MAX(sort_order), -1) as max_order FROM crm_job_checklist WHERE job_id = ?').bind(jobId).first<any>()
  const nextOrder = (maxOrder?.max_order ?? -1) + 1

  const result = await c.env.DB.prepare(
    'INSERT INTO crm_job_checklist (job_id, item_type, label, sort_order) VALUES (?,?,?,?)'
  ).bind(jobId, body.item_type || 'custom', body.label.trim(), nextOrder).run()

  return c.json({ success: true, id: result.meta.last_row_id })
})

// Delete checklist item
crmRoutes.delete('/jobs/:jobId/checklist/:itemId', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const { jobId, itemId } = c.req.param() as any

  // Verify job ownership
  const job = await c.env.DB.prepare('SELECT id FROM crm_jobs WHERE id = ? AND owner_id = ?').bind(jobId, ownerId).first()
  if (!job) return c.json({ error: 'Job not found' }, 404)

  await c.env.DB.prepare('DELETE FROM crm_job_checklist WHERE id = ? AND job_id = ?').bind(itemId, jobId).run()
  return c.json({ success: true })
})

crmRoutes.delete('/jobs/:id', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM crm_job_checklist WHERE job_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM crm_jobs WHERE id = ? AND owner_id = ?').bind(id, ownerId).run()
  return c.json({ success: true })
})

// ============================================================
// DASHBOARD ANALYTICS — Jobs, Revenue, Crew Utilization
// ============================================================

crmRoutes.get('/analytics', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)

  // Jobs completed by month (last 6 months)
  const jobsByMonth = await c.env.DB.prepare(`
    SELECT strftime('%Y-%m', COALESCE(completed_date, scheduled_date)) as month, COUNT(*) as count
    FROM crm_jobs WHERE owner_id = ? AND status = 'completed'
    GROUP BY month ORDER BY month DESC LIMIT 6
  `).bind(ownerId).all<any>()

  // Jobs by status
  const jobsByStatus = await c.env.DB.prepare(`
    SELECT status, COUNT(*) as count FROM crm_jobs WHERE owner_id = ? GROUP BY status
  `).bind(ownerId).all<any>()

  // Jobs by type
  const jobsByType = await c.env.DB.prepare(`
    SELECT job_type, COUNT(*) as count FROM crm_jobs WHERE owner_id = ? GROUP BY job_type
  `).bind(ownerId).all<any>()

  // Revenue by month (last 6 months — paid invoices)
  const revenueByMonth = await c.env.DB.prepare(`
    SELECT strftime('%Y-%m', COALESCE(paid_date, created_at)) as month, SUM(total) as revenue
    FROM crm_invoices WHERE owner_id = ? AND status = 'paid'
    GROUP BY month ORDER BY month DESC LIMIT 6
  `).bind(ownerId).all<any>()

  // Revenue totals
  const revTotals = await c.env.DB.prepare(`
    SELECT
      SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END) as total_paid,
      SUM(CASE WHEN status IN ('sent','viewed','overdue') THEN total ELSE 0 END) as total_owing,
      SUM(CASE WHEN status = 'overdue' THEN total ELSE 0 END) as total_overdue,
      COUNT(CASE WHEN status = 'paid' THEN 1 END) as paid_count,
      COUNT(*) as total_count
    FROM crm_invoices WHERE owner_id = ?
  `).bind(ownerId).first<any>()

  // Crew utilization (last 30 days)
  const crewHours = await c.env.DB.prepare(`
    SELECT c.name, ctl.crew_member_id as id, SUM(ctl.duration_minutes) as total_minutes, COUNT(DISTINCT ctl.job_id) as jobs_worked
    FROM crew_time_logs ctl
    JOIN customers c ON c.id = ctl.crew_member_id
    JOIN crm_jobs j ON j.id = ctl.job_id
    WHERE j.owner_id = ? AND ctl.clock_in >= datetime('now', '-30 days') AND ctl.clock_out IS NOT NULL
    GROUP BY ctl.crew_member_id ORDER BY total_minutes DESC
  `).bind(ownerId).all<any>()

  return c.json({
    jobs: {
      by_month: (jobsByMonth.results || []).reverse(),
      by_status: jobsByStatus.results || [],
      by_type: jobsByType.results || []
    },
    revenue: {
      by_month: (revenueByMonth.results || []).reverse(),
      total_paid: revTotals?.total_paid || 0,
      total_owing: revTotals?.total_owing || 0,
      total_overdue: revTotals?.total_overdue || 0,
      paid_count: revTotals?.paid_count || 0,
      total_count: revTotals?.total_count || 0
    },
    crew: {
      hours: crewHours.results || []
    }
  })
})

// ============================================================
// CREW MANAGER — Assignment + Progress Tracking
// ============================================================

// My assigned jobs — for crew members (team members viewing their own work)
crmRoutes.get('/my-jobs', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return c.json({ error: 'Not authenticated' }, 401)
  const session = await c.env.DB.prepare("SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')").bind(token).first<any>()
  if (!session) return c.json({ error: 'Session expired' }, 401)
  const myId = session.customer_id

  const jobs = await c.env.DB.prepare(
    `SELECT j.*, jca.role as crew_role, cc.name as customer_name, cc.phone as customer_phone,
       (SELECT COUNT(*) FROM job_crew_assignments WHERE job_id = j.id) as total_crew,
       (SELECT GROUP_CONCAT(c2.name, ', ') FROM job_crew_assignments jca2 JOIN customers c2 ON c2.id = jca2.crew_member_id WHERE jca2.job_id = j.id) as crew_names
     FROM job_crew_assignments jca
     JOIN crm_jobs j ON j.id = jca.job_id
     LEFT JOIN crm_customers cc ON cc.id = j.crm_customer_id
     WHERE jca.crew_member_id = ?
     ORDER BY j.scheduled_date DESC`
  ).bind(myId).all<any>()

  // Check for active clock-in (open time log)
  const activeClockIn = await c.env.DB.prepare(
    `SELECT ctl.id, ctl.job_id, ctl.clock_in, ctl.clock_in_lat, ctl.clock_in_lng, j.title as job_title, j.property_address
     FROM crew_time_logs ctl JOIN crm_jobs j ON j.id = ctl.job_id
     WHERE ctl.crew_member_id = ? AND ctl.clock_out IS NULL LIMIT 1`
  ).bind(myId).first<any>()

  return c.json({ jobs: jobs.results || [], is_crew_member: true, active_clock_in: activeClockIn || null, my_id: myId })
})

// List available crew members (team members)
crmRoutes.get('/crew', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const members = await c.env.DB.prepare(
    `SELECT tm.id as team_member_id, tm.member_customer_id, tm.name, tm.email, tm.phone, tm.role, tm.status,
            (SELECT COUNT(*) FROM job_crew_assignments jca WHERE jca.crew_member_id = tm.member_customer_id) as total_assignments,
            (SELECT COUNT(*) FROM job_crew_assignments jca JOIN crm_jobs j ON j.id = jca.job_id WHERE jca.crew_member_id = tm.member_customer_id AND j.status = 'in_progress') as active_jobs
     FROM team_members tm WHERE tm.owner_id = ? AND tm.status = 'active' ORDER BY tm.name`
  ).bind(ownerId).all<any>()
  // Also include the owner as a potential crew lead
  const owner = await c.env.DB.prepare('SELECT id, name, email, phone FROM customers WHERE id = ?').bind(ownerId).first<any>()
  return c.json({ crew: members.results || [], owner: owner || null })
})

// Get crew assigned to a job
crmRoutes.get('/jobs/:id/crew', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const jobId = parseInt(c.req.param('id'))
  const crew = await c.env.DB.prepare(
    `SELECT jca.*, c.name, c.email, c.phone FROM job_crew_assignments jca
     LEFT JOIN customers c ON c.id = jca.crew_member_id
     WHERE jca.job_id = ? ORDER BY jca.role DESC, jca.assigned_at`
  ).bind(jobId).all<any>()
  return c.json({ crew: crew.results || [] })
})

// Assign crew to a job
crmRoutes.post('/jobs/:id/crew', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const jobId = parseInt(c.req.param('id'))
  const { crew_member_id, role } = await c.req.json()
  if (!crew_member_id) return c.json({ error: 'crew_member_id required' }, 400)
  // UNIQUE index on (job_id, crew_member_id) guarantees idempotency
  await c.env.DB.prepare('INSERT OR IGNORE INTO job_crew_assignments (job_id, crew_member_id, role) VALUES (?, ?, ?)').bind(jobId, crew_member_id, role || 'crew').run()
  return c.json({ success: true })
})

// Remove crew from a job
crmRoutes.delete('/jobs/:id/crew/:memberId', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const jobId = parseInt(c.req.param('id'))
  const memberId = parseInt(c.req.param('memberId'))
  await c.env.DB.prepare('DELETE FROM job_crew_assignments WHERE job_id = ? AND crew_member_id = ?').bind(jobId, memberId).run()
  return c.json({ success: true })
})

// Get progress updates for a job
crmRoutes.get('/jobs/:id/progress', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const jobId = parseInt(c.req.param('id'))
  const updates = await c.env.DB.prepare(
    'SELECT * FROM job_progress WHERE job_id = ? ORDER BY created_at DESC'
  ).bind(jobId).all<any>()
  return c.json({ updates: updates.results || [] })
})

// Add progress update (note or photo)
crmRoutes.post('/jobs/:id/progress', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const jobId = parseInt(c.req.param('id'))
  const { update_type, content, photo_data, photo_caption, author_name } = await c.req.json()
  if (!content && !photo_data) return c.json({ error: 'Content or photo required' }, 400)
  // Get author info
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  const session = await c.env.DB.prepare("SELECT customer_id FROM customer_sessions WHERE session_token = ?").bind(token).first<any>()
  const authorId = session?.customer_id || ownerId
  let name = author_name || ''
  if (!name) {
    const cust = await c.env.DB.prepare('SELECT name FROM customers WHERE id = ?').bind(authorId).first<any>()
    name = cust?.name || 'Unknown'
  }
  const result = await c.env.DB.prepare(
    'INSERT INTO job_progress (job_id, author_id, author_name, update_type, content, photo_data, photo_caption) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(jobId, authorId, name, update_type || 'note', content || '', photo_data || null, photo_caption || '').run()
  return c.json({ success: true, id: result.meta.last_row_id })
})

// Delete progress update
crmRoutes.delete('/jobs/:id/progress/:updateId', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const updateId = parseInt(c.req.param('updateId'))
  await c.env.DB.prepare('DELETE FROM job_progress WHERE id = ?').bind(updateId).run()
  return c.json({ success: true })
})

// ============================================================
// CREW MANAGER — Time Tracking, Status Updates, Messaging
// ============================================================

// Update job status (owner/manager only)
crmRoutes.post('/jobs/:jobId/status', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const jobId = parseInt(c.req.param('jobId'))
  const { status } = await c.req.json()
  const allowed = ['scheduled', 'in_progress', 'completed', 'cancelled', 'postponed']
  if (!status || !allowed.includes(status)) return c.json({ error: 'Invalid status' }, 400)

  const completedDate = status === 'completed' ? "date('now')" : 'NULL'
  await c.env.DB.prepare(
    `UPDATE crm_jobs SET status = ?, completed_date = ${status === 'completed' ? "date('now')" : 'completed_date'}, updated_at = datetime('now') WHERE id = ? AND owner_id = ?`
  ).bind(status, jobId, ownerId).run()
  return c.json({ success: true })
})

// Check in to a job with GPS (crew member)
crmRoutes.post('/jobs/:jobId/check-in', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return c.json({ error: 'Not authenticated' }, 401)
  const session = await c.env.DB.prepare("SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')").bind(token).first<any>()
  if (!session) return c.json({ error: 'Session expired' }, 401)
  const myId = session.customer_id
  const jobId = parseInt(c.req.param('jobId'))
  const { lat, lng } = await c.req.json()

  // Check no open time log exists
  const open = await c.env.DB.prepare('SELECT id FROM crew_time_logs WHERE job_id = ? AND crew_member_id = ? AND clock_out IS NULL').bind(jobId, myId).first()
  if (open) return c.json({ error: 'Already clocked in to this job' }, 400)

  const result = await c.env.DB.prepare(
    "INSERT INTO crew_time_logs (job_id, crew_member_id, clock_in, clock_in_lat, clock_in_lng) VALUES (?, ?, datetime('now'), ?, ?)"
  ).bind(jobId, myId, lat || null, lng || null).run()

  // Auto-update job status to in_progress if currently scheduled
  await c.env.DB.prepare(
    "UPDATE crm_jobs SET status = 'in_progress', updated_at = datetime('now') WHERE id = ? AND status = 'scheduled'"
  ).bind(jobId).run()

  return c.json({ success: true, time_log_id: result.meta.last_row_id })
})

// Check out of a job (crew member)
crmRoutes.post('/jobs/:jobId/check-out', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return c.json({ error: 'Not authenticated' }, 401)
  const session = await c.env.DB.prepare("SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')").bind(token).first<any>()
  if (!session) return c.json({ error: 'Session expired' }, 401)
  const myId = session.customer_id
  const jobId = parseInt(c.req.param('jobId'))

  // Find open time log
  const openLog = await c.env.DB.prepare(
    'SELECT id, clock_in FROM crew_time_logs WHERE job_id = ? AND crew_member_id = ? AND clock_out IS NULL'
  ).bind(jobId, myId).first<any>()
  if (!openLog) return c.json({ error: 'No active clock-in found' }, 400)

  // Calculate duration in minutes
  const clockIn = new Date(openLog.clock_in + 'Z').getTime()
  const now = Date.now()
  const durationMinutes = Math.round((now - clockIn) / 60000)

  await c.env.DB.prepare(
    "UPDATE crew_time_logs SET clock_out = datetime('now'), duration_minutes = ? WHERE id = ?"
  ).bind(durationMinutes, openLog.id).run()

  return c.json({ success: true, duration_minutes: durationMinutes })
})

// Send a crew message for a job — accepts customer OR admin sessions
crmRoutes.post('/jobs/:jobId/messages', async (c) => {
  const auth = c.req.header('Authorization')
  if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const token = auth.replace('Bearer ', '')
  let authorId: number | null = null
  let authorName = 'Unknown'
  const session = await c.env.DB.prepare("SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')").bind(token).first<any>()
  if (session) {
    authorId = session.customer_id
    const cust = await c.env.DB.prepare('SELECT name FROM customers WHERE id = ?').bind(authorId).first<any>()
    authorName = cust?.name || 'Unknown'
  } else {
    const admin = await validateAdminSession(c.env.DB, auth)
    if (!admin) return c.json({ error: 'Session expired' }, 401)
    authorId = admin.id
    authorName = admin.email || 'Admin'
  }
  const jobId = parseInt(c.req.param('jobId'))
  const { content } = await c.req.json()
  if (!content || !content.trim()) return c.json({ error: 'Message content required' }, 400)
  const result = await c.env.DB.prepare(
    'INSERT INTO crew_messages (job_id, author_id, author_name, content) VALUES (?, ?, ?, ?)'
  ).bind(jobId, authorId, authorName, content.trim()).run()
  return c.json({ success: true, id: result.meta.last_row_id })
})

// Get messages for a job — accepts customer OR admin sessions
crmRoutes.get('/jobs/:jobId/messages', async (c) => {
  const auth = c.req.header('Authorization')
  if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const token = auth.replace('Bearer ', '')
  const session = await c.env.DB.prepare("SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')").bind(token).first<any>()
  let myId: number | null = null
  if (session) {
    myId = session.customer_id
  } else {
    const admin = await validateAdminSession(c.env.DB, auth)
    if (!admin) return c.json({ error: 'Session expired' }, 401)
    myId = admin.id
  }
  const jobId = parseInt(c.req.param('jobId'))
  const messages = await c.env.DB.prepare(
    'SELECT * FROM crew_messages WHERE job_id = ? ORDER BY created_at ASC'
  ).bind(jobId).all<any>()
  return c.json({ messages: messages.results || [], my_id: myId })
})

// ============================================================
// CREW MANAGER — Voice Walkaround with AI Notes
// ============================================================

// Process a voice walkaround recording: transcribe → organize → store
crmRoutes.post('/jobs/:jobId/walkaround', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return c.json({ error: 'Not authenticated' }, 401)
  const session = await c.env.DB.prepare("SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')").bind(token).first<any>()
  if (!session) return c.json({ error: 'Session expired' }, 401)
  const authorId = session.customer_id
  const jobId = parseInt(c.req.param('jobId'))

  // Resolve author name
  const cust = await c.env.DB.prepare('SELECT name FROM customers WHERE id = ?').bind(authorId).first<any>()
  const authorName = cust?.name || 'Unknown'

  const { audio_data } = await c.req.json()
  if (!audio_data) return c.json({ error: 'No audio data provided' }, 400)

  const apiKey = (c.env as any).OPENAI_API_KEY
  const baseUrl = (c.env as any).OPENAI_BASE_URL || 'https://www.genspark.ai/api/llm_proxy/v1'

  if (!apiKey) return c.json({ error: 'OpenAI API key not configured' }, 500)

  try {
    // Step 1: Decode base64 audio → Blob for Whisper
    const base64Data = audio_data.includes(',') ? audio_data.split(',')[1] : audio_data
    const binaryString = atob(base64Data)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    const audioBlob = new Blob([bytes], { type: 'audio/webm' })
    const audioFile = new File([audioBlob], 'walkaround.webm', { type: 'audio/webm' })

    // Step 2: Transcribe with Whisper
    const whisperForm = new FormData()
    whisperForm.append('file', audioFile, 'walkaround.webm')
    whisperForm.append('model', 'whisper-1')
    whisperForm.append('language', 'en')

    const whisperRes = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: whisperForm
    })

    let transcription = ''
    if (whisperRes.ok) {
      const whisperData: any = await whisperRes.json()
      transcription = whisperData.text || ''
    }

    if (!transcription) {
      return c.json({ error: 'Could not transcribe audio. Please try again or speak more clearly.' }, 400)
    }

    // Step 3: Organize with GPT
    let organizedNotes = transcription // fallback: raw transcript
    try {
      const chatRes = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are an AI assistant for a roofing crew. Organize this voice walkaround transcript into clear, structured job site notes. Format using these sections (only include sections that have relevant content):

**Site Conditions:** Current state of the roof/property
**Work Completed:** What has been done so far
**Issues Found:** Problems, damage, or concerns discovered
**Materials Needed:** Supplies or materials mentioned
**Next Steps:** What needs to happen next

Be concise and professional. Remove filler words, repetition, and off-topic conversation. If the transcript is very short or unclear, do your best to extract the key points.`
            },
            {
              role: 'user',
              content: `Here is the walkaround voice transcript from a roofing job site:\n\n${transcription}`
            }
          ],
          max_tokens: 1000,
          temperature: 0.3
        })
      })

      if (chatRes.ok) {
        const chatData: any = await chatRes.json()
        const aiContent = chatData.choices?.[0]?.message?.content
        if (aiContent) organizedNotes = aiContent
      }
    } catch (e) {
      // GPT failed — use raw transcript as fallback
      console.error('[Walkaround] GPT organization failed:', e)
    }

    // Step 4: Store as job progress
    const result = await c.env.DB.prepare(
      `INSERT INTO job_progress (job_id, author_id, author_name, update_type, content, audio_data, transcription, ai_notes)
       VALUES (?, ?, ?, 'walkaround', ?, ?, ?, ?)`
    ).bind(jobId, authorId, authorName, organizedNotes, audio_data, transcription, organizedNotes).run()

    return c.json({
      success: true,
      id: result.meta.last_row_id,
      content: organizedNotes,
      transcription: transcription
    })
  } catch (e: any) {
    console.error('[Walkaround] Error:', e)
    return c.json({ error: 'Failed to process walkaround: ' + (e.message || 'Unknown error') }, 500)
  }
})

// ============================================================
// GMAIL OAUTH — Per-customer Gmail connection for sending proposals
// ============================================================

// Check Gmail connection status
crmRoutes.get('/gmail/status', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)

  const customer = await c.env.DB.prepare(
    'SELECT gmail_connected_email, gmail_connected_at FROM customers WHERE id = ?'
  ).bind(ownerId).first<any>()

  return c.json({
    connected: !!customer?.gmail_connected_email,
    email: customer?.gmail_connected_email || null,
    connected_at: customer?.gmail_connected_at || null
  })
})

// Start Gmail OAuth flow
crmRoutes.get('/gmail/connect', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)

  const clientId = (c.env as any).GMAIL_CLIENT_ID
  if (!clientId) {
    return c.json({ error: 'Gmail integration is not configured. Contact support.' }, 400)
  }

  const url = new URL(c.req.url)
  const redirectUri = `${url.protocol}//${url.host}/api/crm/gmail/callback`

  const state = `${ownerId}:${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`
  
  // Store state in a temp session
  try {
    await c.env.DB.prepare(
      "INSERT OR REPLACE INTO settings (master_company_id, setting_key, setting_value) VALUES (?, ?, ?)"
    ).bind(ownerId, 'gmail_oauth_state', state).run()
  } catch(e) {
    // If settings table doesn't have this key, create it
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS customer_gmail_state (id INTEGER PRIMARY KEY, customer_id INTEGER, state TEXT, created_at TEXT DEFAULT (datetime('now')))
    `).run().catch((e) => console.warn("[silent-catch]", (e && e.message) || e))
  }

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events')
  authUrl.searchParams.set('access_type', 'offline')
  const forceSelect = c.req.query('select') === '1'
  authUrl.searchParams.set('prompt', forceSelect ? 'select_account consent' : 'consent')
  authUrl.searchParams.set('state', state)

  return c.json({ auth_url: authUrl.toString() })
})

// Gmail OAuth callback (browser redirect)
crmRoutes.get('/gmail/callback', async (c) => {
  const code = c.req.query('code')
  const error = c.req.query('error')
  const state = c.req.query('state') || ''

  if (error || !code) {
    return c.html(`<!DOCTYPE html><html><head><title>Gmail Connection</title><link rel="stylesheet" href="/static/tailwind.css"></head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center"><div class="bg-white rounded-2xl shadow-xl p-8 max-w-md text-center">
<div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"><i class="fas fa-times text-red-500 text-2xl"></i></div>
<h2 class="text-xl font-bold text-gray-800 mb-2">Connection Failed</h2>
<p class="text-gray-600 mb-4">${error || 'No authorization code received'}</p>
<button onclick="window.close()" class="bg-sky-600 text-white px-6 py-2 rounded-lg font-semibold">Close Window</button>
</div></body></html>`)
  }

  const customerId = parseInt(state.split(':')[0])
  if (!customerId) {
    return c.html(`<!DOCTYPE html><html><head><title>Gmail Connection</title></head><body><p>Invalid state. Please try again.</p></body></html>`)
  }

  const clientId = (c.env as any).GMAIL_CLIENT_ID
  // BUG FIX: Read client_secret from DB if not in env (admin may have stored it via /api/auth/gmail/setup)
  let clientSecret = (c.env as any).GMAIL_CLIENT_SECRET || ''
  if (!clientSecret) {
    try {
      const csRow = await c.env.DB.prepare(
        "SELECT setting_value FROM settings WHERE setting_key = 'gmail_client_secret' AND master_company_id = 1"
      ).first<any>()
      if (csRow?.setting_value) clientSecret = csRow.setting_value
    } catch (e) { /* ignore */ }
  }

  const url = new URL(c.req.url)
  const redirectUri = `${url.protocol}//${url.host}/api/crm/gmail/callback`

  if (!clientId || !clientSecret) {
    return c.html(`<!DOCTYPE html><html><head><title>Gmail Connection</title><link rel="stylesheet" href="/static/tailwind.css"></head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center"><div class="bg-white rounded-2xl shadow-xl p-8 max-w-md text-center">
<div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"><i class="fas fa-exclamation-triangle text-red-500 text-2xl"></i></div>
<h2 class="text-xl font-bold text-gray-800 mb-2">Configuration Error</h2>
<p class="text-gray-600 mb-4">Gmail OAuth credentials are not configured. Ask your admin to set up GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET.</p>
<button onclick="window.close()" class="bg-sky-600 text-white px-6 py-2 rounded-lg font-semibold">Close</button>
</div></body></html>`)
  }

  // Exchange code for tokens
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri
    }).toString()
  })

  const tokenData: any = await tokenResp.json()
  if (!tokenResp.ok || !tokenData.refresh_token) {
    return c.html(`<!DOCTYPE html><html><head><title>Gmail Connection</title><link rel="stylesheet" href="/static/tailwind.css"></head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center"><div class="bg-white rounded-2xl shadow-xl p-8 max-w-md text-center">
<div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"><i class="fas fa-exclamation-triangle text-red-500 text-2xl"></i></div>
<h2 class="text-xl font-bold text-gray-800 mb-2">Token Exchange Failed</h2>
<p class="text-gray-600 mb-1"><strong>Error:</strong> ${tokenData.error || (tokenData.refresh_token === undefined ? 'no_refresh_token' : 'unknown')}</p>
<p class="text-gray-600 mb-1"><strong>Description:</strong> ${tokenData.error_description || '(none)'}</p>
<p class="text-gray-500 text-xs mb-4"><strong>Redirect URI used:</strong> ${redirectUri}</p>
<button onclick="window.close()" class="bg-sky-600 text-white px-6 py-2 rounded-lg font-semibold">Close</button>
</div></body></html>`)
  }

  // Get user email
  let gmailEmail = ''
  try {
    const profileResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    })
    const profile: any = await profileResp.json()
    gmailEmail = profile.emailAddress || ''
  } catch(e) {}

  // Store tokens on the customer record
  await c.env.DB.prepare(`
    UPDATE customers SET gmail_refresh_token = ?, gmail_connected_email = ?, gmail_connected_at = datetime('now') WHERE id = ?
  `).bind(tokenData.refresh_token, gmailEmail, customerId).run()

  return c.html(`<!DOCTYPE html>
<html><head><title>Gmail Connected</title>
<link rel="stylesheet" href="/static/tailwind.css">
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
</head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center">
<div class="bg-white rounded-2xl shadow-xl p-8 max-w-md text-center">
  <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
    <i class="fas fa-check text-green-600 text-2xl"></i>
  </div>
  <h2 class="text-xl font-bold text-gray-800 mb-2">Gmail Connected!</h2>
  <p class="text-gray-600 mb-1">Successfully connected:</p>
  <p class="text-sky-600 font-semibold mb-4">${gmailEmail}</p>
  <p class="text-sm text-gray-500 mb-6">You can now send proposals directly from your Gmail. This window will close automatically.</p>
  <button onclick="window.close()" class="bg-sky-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-sky-700">Close Window</button>
</div>
<script>
  // Notify parent window
  if (window.opener) {
    window.opener.postMessage({ type: 'gmail_connected', email: '${gmailEmail}' }, '*');
    setTimeout(function() { window.close(); }, 3000);
  }
</script>
</body></html>`)
})

// Disconnect Gmail
crmRoutes.post('/gmail/disconnect', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)

  await c.env.DB.prepare(
    "UPDATE customers SET gmail_refresh_token = NULL, gmail_connected_email = NULL, gmail_connected_at = NULL WHERE id = ?"
  ).bind(ownerId).run()

  return c.json({ success: true })
})

// ============================================================
// ENHANCED PROPOSAL SEND — Email via customer's connected Gmail
// ============================================================
crmRoutes.post('/proposals/:id/send', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')

  const proposal = await c.env.DB.prepare(`
    SELECT cp.*, cc.name as customer_name, cc.email as customer_email, cc.phone as customer_phone,
           cc.address as customer_address, cc.city as customer_city, cc.province as customer_province
    FROM crm_proposals cp LEFT JOIN crm_customers cc ON cc.id = cp.crm_customer_id
    WHERE cp.id = ? AND cp.owner_id = ?
  `).bind(id, ownerId).first<any>()
  if (!proposal) return c.json({ error: 'Proposal not found' }, 404)

  // Get line items for the email
  const itemsResult = await c.env.DB.prepare(
    'SELECT * FROM crm_proposal_items WHERE proposal_id = ? ORDER BY sort_order'
  ).bind(id).all()
  const lineItems = itemsResult.results || []

  // Generate share token if needed
  let shareToken = proposal.share_token
  if (!shareToken) {
    shareToken = crypto.randomUUID().replace(/-/g, '').substring(0, 16)
  }

  await c.env.DB.prepare(`
    UPDATE crm_proposals SET status = 'sent', share_token = ?, sent_at = datetime('now'), view_count = COALESCE(view_count, 0), updated_at = datetime('now')
    WHERE id = ? AND owner_id = ?
  `).bind(shareToken, id, ownerId).run()

  const baseUrl = new URL(c.req.url).origin
  const publicLink = `${baseUrl}/proposal/view/${shareToken}`

  // Try sending via customer's connected Gmail
  let emailSent = false
  let emailError = ''
  const customer = await c.env.DB.prepare(
    'SELECT gmail_refresh_token, gmail_connected_email, name, email, phone, brand_business_name, brand_logo_url, brand_primary_color FROM customers WHERE id = ?'
  ).bind(ownerId).first<any>()

  if (customer?.gmail_refresh_token && proposal.customer_email) {
    const clientId = (c.env as any).GMAIL_CLIENT_ID
    // Read client_secret from env or DB
    let clientSecret = (c.env as any).GMAIL_CLIENT_SECRET || ''
    if (!clientSecret) {
      try {
        const csRow = await c.env.DB.prepare(
          "SELECT setting_value FROM settings WHERE setting_key = 'gmail_client_secret' AND master_company_id = 1"
        ).first<any>()
        if (csRow?.setting_value) clientSecret = csRow.setting_value
      } catch (e) { /* ignore */ }
    }

    if (clientId && clientSecret) {
      try {
        // Refresh access token
        const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: customer.gmail_refresh_token,
            client_id: clientId,
            client_secret: clientSecret
          }).toString()
        })
        const tokenData: any = await tokenResp.json()

        if (tokenData.access_token) {
          const businessName = customer.brand_business_name || customer.name || 'Your Roofer'
          const fromEmail = customer.gmail_connected_email || customer.email
          const primaryColor = customer.brand_primary_color || '#0369a1'
          const fullAddress = [proposal.property_address, proposal.customer_city, proposal.customer_province].filter(Boolean).join(', ')

          // Build line items HTML for email
          let itemsHtml = ''
          if (lineItems.length > 0) {
            itemsHtml = '<table style="width:100%;border-collapse:collapse;margin:0 0 12px;">'
            itemsHtml += '<tr style="background:#f1f5f9;"><td style="color:#475569;font-size:11px;font-weight:600;padding:6px 8px;text-align:left;">Item</td><td style="color:#475569;font-size:11px;font-weight:600;padding:6px 8px;text-align:center;">Qty</td><td style="color:#475569;font-size:11px;font-weight:600;padding:6px 8px;text-align:right;">Price</td><td style="color:#475569;font-size:11px;font-weight:600;padding:6px 8px;text-align:right;">Amount</td></tr>'
            for (const item of lineItems) {
              itemsHtml += `<tr><td style="color:#374151;font-size:12px;padding:6px 8px;border-bottom:1px solid #f1f5f9;">${(item as any).description}</td><td style="color:#374151;font-size:12px;padding:6px 8px;text-align:center;border-bottom:1px solid #f1f5f9;">${(item as any).quantity} ${(item as any).unit || ''}</td><td style="color:#374151;font-size:12px;padding:6px 8px;text-align:right;border-bottom:1px solid #f1f5f9;">$${parseFloat((item as any).unit_price).toFixed(2)}</td><td style="color:#374151;font-size:12px;padding:6px 8px;text-align:right;border-bottom:1px solid #f1f5f9;">$${parseFloat((item as any).amount).toFixed(2)}</td></tr>`
            }
            itemsHtml += '</table>'
          }

          const emailHtml = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
  <div style="background:${primaryColor};padding:32px;border-radius:12px 12px 0 0;">
    ${customer.brand_logo_url ? `<img src="${customer.brand_logo_url}" alt="${businessName}" style="max-height:48px;margin-bottom:8px;">` : ''}
    <h1 style="color:#ffffff;margin:0;font-size:22px;">${businessName}</h1>
    <p style="color:rgba(255,255,255,0.7);margin:8px 0 0;font-size:14px;">Roofing Proposal &middot; ${proposal.proposal_number}</p>
  </div>
  <div style="padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
    <p style="color:#374151;font-size:16px;margin:0 0 8px;">Hi ${proposal.customer_name || 'there'},</p>
    <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0 0 24px;">
      Thank you for the opportunity to provide you with a roofing estimate. Please review your personalized proposal below.
    </p>
    
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:0 0 24px;">
      <table style="width:100%;border-collapse:collapse;margin:0 0 8px;">
        <tr><td style="color:#6b7280;font-size:13px;padding:4px 0;">Project</td><td style="color:#1e293b;font-size:13px;font-weight:600;text-align:right;">${proposal.title}</td></tr>
        ${fullAddress ? `<tr><td style="color:#6b7280;font-size:13px;padding:4px 0;">Property</td><td style="color:#1e293b;font-size:13px;text-align:right;">${fullAddress}</td></tr>` : ''}
      </table>
      ${itemsHtml}
      <table style="width:100%;border-collapse:collapse;">
        ${proposal.subtotal ? `<tr><td style="color:#6b7280;font-size:13px;padding:4px 0;">Subtotal</td><td style="color:#1e293b;font-size:13px;text-align:right;">$${parseFloat(proposal.subtotal).toFixed(2)}</td></tr>` : ''}
        ${proposal.tax_amount ? `<tr><td style="color:#6b7280;font-size:13px;padding:4px 0;">Tax (${proposal.tax_rate || 5}%)</td><td style="color:#1e293b;font-size:13px;text-align:right;">$${parseFloat(proposal.tax_amount).toFixed(2)}</td></tr>` : ''}
        <tr><td colspan="2" style="border-top:1px solid #e2e8f0;padding-top:8px;"></td></tr>
        <tr><td style="color:${primaryColor};font-size:18px;font-weight:700;padding:4px 0;">Total</td><td style="color:${primaryColor};font-size:18px;font-weight:700;text-align:right;">$${parseFloat(proposal.total_amount).toFixed(2)} CAD</td></tr>
      </table>
    </div>

    <div style="text-align:center;margin:0 0 24px;">
      <a href="${publicLink}" style="display:inline-block;background:${primaryColor};color:#ffffff;text-decoration:none;padding:14px 40px;border-radius:8px;font-weight:600;font-size:15px;">
        View Full Proposal
      </a>
    </div>

    <p style="color:#9ca3af;font-size:12px;text-align:center;margin:0;">
      ${proposal.valid_until ? 'This proposal is valid until ' + new Date(proposal.valid_until).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }) + '.' : ''}
    </p>
  </div>
  <p style="color:#9ca3af;font-size:11px;text-align:center;margin:16px 0 0;padding:0;">
    Sent via Roof Manager &middot; ${fromEmail}
  </p>
</div>`

          // Build RFC 2822 MIME message
          const subject = `Roofing Proposal: ${proposal.title} — ${proposal.proposal_number}`
          const boundary = 'boundary_' + crypto.randomUUID().replace(/-/g, '').substring(0, 16)
          const rawMessage = [
            `From: ${businessName} <${fromEmail}>`,
            `To: ${proposal.customer_email}`,
            `Subject: ${subject}`,
            'MIME-Version: 1.0',
            `Content-Type: multipart/alternative; boundary="${boundary}"`,
            '',
            `--${boundary}`,
            'Content-Type: text/plain; charset=UTF-8',
            '',
            `Hi ${proposal.customer_name || 'there'},\n\nPlease find your roofing proposal:\n\nProject: ${proposal.title}\nTotal: $${parseFloat(proposal.total_amount).toFixed(2)} CAD\n\nView your proposal: ${publicLink}\n\nBest regards,\n${businessName}`,
            '',
            `--${boundary}`,
            'Content-Type: text/html; charset=UTF-8',
            '',
            emailHtml,
            '',
            `--${boundary}--`
          ].join('\r\n')

          // Base64url encode
          const encoded = btoa(unescape(encodeURIComponent(rawMessage)))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

          const sendResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${tokenData.access_token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ raw: encoded })
          })

          if (sendResp.ok) {
            emailSent = true
          } else {
            const errData: any = await sendResp.json().catch(() => ({}))
            emailError = errData?.error?.message || `Gmail API error (${sendResp.status})`
          }
        } else {
          emailError = 'Could not refresh Gmail token. Please reconnect Gmail.'
        }
      } catch(e: any) {
        emailError = e.message || 'Gmail send failed'
      }
    }
  } else if (!customer?.gmail_refresh_token) {
    emailError = 'Gmail not connected. Connect Gmail in settings to send proposals by email.'
  } else if (!proposal.customer_email) {
    emailError = 'Customer has no email address on file.'
  }

  return c.json({
    success: true,
    share_token: shareToken,
    public_link: publicLink,
    email_sent: emailSent,
    email_error: emailError || null,
    sent_to: emailSent ? proposal.customer_email : null
  })
})

// ============================================================
// PROPOSAL ACCEPT/DECLINE — Public endpoint (no auth, uses share_token)
// ============================================================
crmRoutes.post('/proposals/respond/:token', async (c) => {
  const token = c.req.param('token')
  const { action, signature, printed_name, signed_date } = await c.req.json()

  if (!['accept', 'decline'].includes(action)) {
    return c.json({ error: 'Invalid action' }, 400)
  }

  const proposal = await c.env.DB.prepare(
    `SELECT cp.*, cc.name as customer_name, cc.email as customer_email
     FROM crm_proposals cp LEFT JOIN crm_customers cc ON cc.id = cp.crm_customer_id
     WHERE cp.share_token = ?`
  ).bind(token).first<any>()

  if (!proposal) return c.json({ error: 'Proposal not found' }, 404)
  if (proposal.status === 'accepted' || proposal.status === 'declined') {
    return c.json({ error: 'This proposal has already been ' + proposal.status }, 400)
  }

  // Enforce valid_until expiry — reject acceptance of expired proposals
  if (action === 'accept' && proposal.valid_until) {
    const expiryDate = new Date(proposal.valid_until)
    if (!isNaN(expiryDate.getTime()) && expiryDate < new Date()) {
      return c.json({ error: 'This proposal has expired. Please contact the business for an updated quote.' }, 400)
    }
  }

  const newStatus = action === 'accept' ? 'accepted' : 'declined'
  const dateCol = action === 'accept' ? 'accepted_at' : 'declined_at'
  const safeSignature = signature && typeof signature === 'string' && signature.startsWith('data:image/') ? signature : null

  await c.env.DB.prepare(`
    UPDATE crm_proposals SET status = ?, ${dateCol} = datetime('now'), customer_signature = ?, printed_name = ?, signed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
  `).bind(newStatus, safeSignature, printed_name || null, proposal.id).run()

  // Email notification to business owner
  try {
    const owner = await c.env.DB.prepare('SELECT email, name, gmail_refresh_token FROM customers WHERE id = ?').bind(proposal.owner_id).first<any>()
    if (owner?.email) {
      const clientId = (c.env as any).GMAIL_CLIENT_ID
      const clientSecret = (c.env as any).GMAIL_CLIENT_SECRET
      const refreshToken = (c.env as any).GMAIL_REFRESH_TOKEN || owner?.gmail_refresh_token || ''
      if (clientId && clientSecret && refreshToken) {
        const emoji = action === 'accept' ? '✅' : '❌'
        const statusText = action === 'accept' ? 'ACCEPTED' : 'DECLINED'
        const notifHtml = `
<div style="max-width:600px;margin:0 auto;font-family:Inter,system-ui,sans-serif">
  <div style="background:${action === 'accept' ? '#16a34a' : '#dc2626'};padding:24px;border-radius:12px 12px 0 0;text-align:center">
    <h1 style="color:white;font-size:20px;margin:0">${emoji} Proposal ${statusText}</h1>
    <p style="color:rgba(255,255,255,0.8);font-size:13px;margin:4px 0 0">${proposal.proposal_number} — ${proposal.title || ''}</p>
  </div>
  <div style="background:white;padding:24px;border:1px solid #e2e8f0;border-top:none">
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:120px"><strong>Customer</strong></td><td style="padding:8px 0;font-size:14px;color:#1e293b">${proposal.customer_name || 'Unknown'}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;font-size:13px"><strong>Total Amount</strong></td><td style="padding:8px 0;font-size:14px;color:#1e293b;font-weight:700">$${Number(proposal.total_amount || 0).toFixed(2)}</td></tr>
      ${printed_name ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px"><strong>Signed By</strong></td><td style="padding:8px 0;font-size:14px;color:#1e293b">${escapeHtml(printed_name)}</td></tr>` : ''}
      ${signed_date ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px"><strong>Date</strong></td><td style="padding:8px 0;font-size:14px;color:#1e293b">${escapeHtml(signed_date)}</td></tr>` : ''}
      ${proposal.property_address ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px"><strong>Property</strong></td><td style="padding:8px 0;font-size:14px;color:#1e293b">${escapeHtml(proposal.property_address)}</td></tr>` : ''}
    </table>
    ${signature && signature.startsWith('data:image/') ? `<div style="margin-top:16px;padding:12px;background:#f8fafc;border-radius:8px;text-align:center"><p style="font-size:11px;color:#94a3b8;margin:0 0 8px">Customer Signature</p><img src="${signature}" alt="Signature" style="max-height:60px"></div>` : ''}
  </div>
  <div style="background:#f8fafc;padding:16px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0;border-top:none;text-align:center">
    <a href="https://www.roofmanager.ca/customer/proposals" style="color:#0ea5e9;font-size:12px;font-weight:600">View in Dashboard</a>
  </div>
</div>`
        const { sendGmailOAuth2 } = await import('../services/email')
        sendGmailOAuth2(clientId, clientSecret, refreshToken, owner.email, `${emoji} Proposal ${statusText}: ${proposal.title || proposal.proposal_number} — $${Number(proposal.total_amount || 0).toFixed(2)}`, notifHtml, owner.email).catch((e) => console.warn("[silent-catch]", (e && e.message) || e))
      }
    }
  } catch {}

  // Auto-create job from accepted proposal
  if (action === 'accept' && proposal.property_address) {
    try {
      const d = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0')
      const jobNumber = `JOB-${d}-${rand}`
      await c.env.DB.prepare(
        `INSERT INTO crm_jobs (owner_id, crm_customer_id, proposal_id, job_number, title, property_address, job_type, scheduled_date, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, 'install', date('now', '+7 days'), ?, 'scheduled')`
      ).bind(proposal.owner_id, proposal.crm_customer_id, proposal.id, jobNumber, proposal.title || 'Accepted Proposal Job', proposal.property_address, 'Auto-created from accepted proposal ' + proposal.proposal_number).run()
    } catch {}
  }

  return c.json({ success: true, status: newStatus })
})

// ============================================================
// CRM DASHBOARD STATS — Aggregated counts for the dashboard tiles
// ============================================================
crmRoutes.get('/stats', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ customers: 0, invoices_owing: 0, proposals_open: 0, jobs_upcoming: 0 })

  try {
    const customerCount = await c.env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM crm_customers WHERE owner_id = ?"
    ).bind(ownerId).first<any>()

    const invoicesOwing = await c.env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM crm_invoices WHERE owner_id = ? AND status IN ('draft','sent','viewed','overdue')"
    ).bind(ownerId).first<any>()

    const proposalsOpen = await c.env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM crm_proposals WHERE owner_id = ? AND status IN ('draft','sent','viewed')"
    ).bind(ownerId).first<any>()

    const jobsUpcoming = await c.env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM crm_jobs WHERE owner_id = ? AND status IN ('scheduled','in_progress')"
    ).bind(ownerId).first<any>()

    return c.json({
      customers: customerCount?.cnt || 0,
      invoices_owing: invoicesOwing?.cnt || 0,
      proposals_open: proposalsOpen?.cnt || 0,
      jobs_upcoming: jobsUpcoming?.cnt || 0
    })
  } catch (e) {
    // Tables might not exist yet — return zeroes
    return c.json({ customers: 0, invoices_owing: 0, proposals_open: 0, jobs_upcoming: 0 })
  }
})

// ============================================================
// MATERIAL CATALOG — Custom product & pricing list
// ============================================================

// List catalog items
crmRoutes.get('/catalog', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const rows = await c.env.DB.prepare(
    'SELECT * FROM material_catalog WHERE owner_id = ? AND is_active = 1 ORDER BY category, sort_order, name'
  ).bind(ownerId).all<any>()
  return c.json({ products: rows.results || [] })
})

// Add catalog item
crmRoutes.post('/catalog', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const { category, name, description, sku, unit, unit_price, coverage_per_unit, supplier, is_default } = await c.req.json()
  if (!category || !name || !unit || unit_price === undefined) return c.json({ error: 'category, name, unit, unit_price required' }, 400)
  const result = await c.env.DB.prepare(
    `INSERT INTO material_catalog (owner_id, category, name, description, sku, unit, unit_price, coverage_per_unit, supplier, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(ownerId, category, name, description || '', sku || '', unit, unit_price, coverage_per_unit || '', supplier || '', is_default ? 1 : 0).run()
  return c.json({ success: true, id: result.meta.last_row_id })
})

// Update catalog item
crmRoutes.put('/catalog/:id', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const id = parseInt(c.req.param('id'))
  const body = await c.req.json()
  const updates: string[] = []
  const vals: any[] = []
  for (const key of ['category', 'name', 'description', 'sku', 'unit', 'unit_price', 'coverage_per_unit', 'supplier', 'is_default', 'sort_order']) {
    if (body[key] !== undefined) { updates.push(`${key}=?`); vals.push(body[key]) }
  }
  if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400)
  updates.push("updated_at=datetime('now')")
  vals.push(id, ownerId)
  await c.env.DB.prepare(`UPDATE material_catalog SET ${updates.join(', ')} WHERE id=? AND owner_id=?`).bind(...vals).run()
  return c.json({ success: true })
})

// Delete catalog item
crmRoutes.delete('/catalog/:id', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const id = parseInt(c.req.param('id'))
  await c.env.DB.prepare("UPDATE material_catalog SET is_active=0, updated_at=datetime('now') WHERE id=? AND owner_id=?").bind(id, ownerId).run()
  return c.json({ success: true })
})

// Seed default products with current market pricing
crmRoutes.post('/catalog/seed-defaults', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  const existing = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM material_catalog WHERE owner_id=? AND is_active=1').bind(ownerId).first<any>()
  if (existing && existing.cnt > 0) return c.json({ error: 'Catalog already has items. Delete existing items first or add products manually.', count: existing.cnt }, 400)

  const defaults = [
    { category: 'shingles', name: 'Architectural Shingles (Laminate)', unit: 'bundles', unit_price: 42.00, coverage_per_unit: '33 sq ft per bundle (3 bundles/square)', supplier: '', is_default: 1, sort_order: 1 },
    { category: 'shingles', name: '3-Tab Standard Shingles', unit: 'bundles', unit_price: 32.00, coverage_per_unit: '33 sq ft per bundle (3 bundles/square)', supplier: '', is_default: 0, sort_order: 2 },
    { category: 'underlayment', name: 'Synthetic Underlayment', unit: 'rolls', unit_price: 95.00, coverage_per_unit: '400 sq ft per roll', supplier: '', is_default: 1, sort_order: 3 },
    { category: 'ice_shield', name: 'Ice & Water Shield Membrane', unit: 'rolls', unit_price: 165.00, coverage_per_unit: '200 sq ft per roll', supplier: '', is_default: 1, sort_order: 4 },
    { category: 'starter', name: 'Starter Strip Shingles', unit: 'boxes', unit_price: 45.00, coverage_per_unit: '100 lin ft per box', supplier: '', is_default: 1, sort_order: 5 },
    { category: 'ridge_cap', name: 'Ridge/Hip Cap Shingles', unit: 'bundles', unit_price: 65.00, coverage_per_unit: '35 lin ft per bundle', supplier: '', is_default: 1, sort_order: 6 },
    { category: 'drip_edge', name: 'Aluminum Drip Edge (Type C/D)', unit: 'pieces', unit_price: 8.50, coverage_per_unit: '10 ft per piece', supplier: '', is_default: 1, sort_order: 7 },
    { category: 'valley_metal', name: 'W-Valley Flashing (Aluminum)', unit: 'pieces', unit_price: 22.00, coverage_per_unit: '10 ft per piece', supplier: '', is_default: 1, sort_order: 8 },
    { category: 'nails', name: 'Roofing Nails 1-1/4" Galvanized', unit: 'boxes', unit_price: 28.00, coverage_per_unit: '5 lb box (~2 squares)', supplier: '', is_default: 1, sort_order: 9 },
    { category: 'ventilation', name: 'Ridge Vent', unit: 'pieces', unit_price: 22.00, coverage_per_unit: '4 ft per piece', supplier: '', is_default: 1, sort_order: 10 },
    { category: 'custom', name: 'Roofing Cement / Caulk', unit: 'tubes', unit_price: 8.50, coverage_per_unit: '~1 tube per 5 squares', supplier: '', is_default: 1, sort_order: 11 },
    { category: 'custom', name: 'Pipe Boot / Collar', unit: 'pieces', unit_price: 18.00, coverage_per_unit: '~2 per 1000 sq ft', supplier: '', is_default: 0, sort_order: 12 },
  ]

  for (const d of defaults) {
    await c.env.DB.prepare(
      `INSERT INTO material_catalog (owner_id, category, name, unit, unit_price, coverage_per_unit, supplier, is_default, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(ownerId, d.category, d.name, d.unit, d.unit_price, d.coverage_per_unit, d.supplier, d.is_default, d.sort_order).run()
  }
  return c.json({ success: true, seeded: defaults.length })
})

// ============================================================
// SUPPLIER DIRECTORY & SUPPLIER ORDERS
// ============================================================

// Helper alias for CRM auth (reuses existing getOwnerId)
const getOwnerIdFromCRM = getOwnerId

// GET /suppliers — list suppliers
crmRoutes.get('/suppliers', async (c) => {
  const ownerId = await getOwnerIdFromCRM(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)
  const result = await c.env.DB.prepare(
    'SELECT * FROM supplier_directory WHERE owner_id = ? ORDER BY preferred DESC, name ASC'
  ).bind(ownerId).all()
  return c.json({ suppliers: result.results || [] })
})

// POST /suppliers — create supplier
crmRoutes.post('/suppliers', async (c) => {
  const ownerId = await getOwnerIdFromCRM(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)
  const body = await c.req.json()
  const { name, phone, email, address, city, province, branch_name, account_number, rep_name, rep_phone, rep_email, preferred, notes } = body
  if (!name) return c.json({ error: 'Supplier name is required' }, 400)

  const result = await c.env.DB.prepare(`
    INSERT INTO supplier_directory (owner_id, name, phone, email, address, city, province, branch_name, account_number, rep_name, rep_phone, rep_email, preferred, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(ownerId, name, phone || '', email || '', address || '', city || '', province || '', branch_name || '', account_number || '', rep_name || '', rep_phone || '', rep_email || '', preferred ? 1 : 0, notes || '').first()

  return c.json({ success: true, supplier_id: result?.id })
})

// PUT /suppliers/:id — update supplier
crmRoutes.put('/suppliers/:id', async (c) => {
  const ownerId = await getOwnerIdFromCRM(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)
  const id = parseInt(c.req.param('id'))
  const body = await c.req.json()

  await c.env.DB.prepare(`
    UPDATE supplier_directory SET name=?, phone=?, email=?, address=?, city=?, province=?,
    branch_name=?, account_number=?, rep_name=?, rep_phone=?, rep_email=?, preferred=?, notes=?, updated_at=datetime('now')
    WHERE id=? AND owner_id=?
  `).bind(body.name, body.phone||'', body.email||'', body.address||'', body.city||'', body.province||'',
    body.branch_name||'', body.account_number||'', body.rep_name||'', body.rep_phone||'', body.rep_email||'',
    body.preferred?1:0, body.notes||'', id, ownerId).run()

  return c.json({ success: true })
})

// POST /supplier-orders — create supplier material order
crmRoutes.post('/supplier-orders', async (c) => {
  const ownerId = await getOwnerIdFromCRM(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)
  const body = await c.req.json()
  const { proposal_id, supplier_id, report_id, material_estimate_id, job_address, customer_name, items, notes } = body

  const orderNum = 'SO-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + Math.random().toString(36).slice(2,6).toUpperCase()
  const totalAmount = (items || []).reduce((sum: number, item: any) => sum + (Number(item.quantity || 0) * Number(item.unit_price || 0)), 0)

  const result = await c.env.DB.prepare(`
    INSERT INTO supplier_orders (owner_id, proposal_id, supplier_id, report_id, material_estimate_id, order_number, job_address, customer_name, items_json, notes, total_amount)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
  `).bind(ownerId, proposal_id||null, supplier_id||null, report_id||null, material_estimate_id||null, orderNum, job_address||'', customer_name||'', JSON.stringify(items||[]), notes||'', totalAmount).first()

  return c.json({ success: true, order_id: result?.id, order_number: orderNum })
})

// GET /supplier-orders — list orders
crmRoutes.get('/supplier-orders', async (c) => {
  const ownerId = await getOwnerIdFromCRM(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)
  const result = await c.env.DB.prepare(
    'SELECT so.*, sd.name as supplier_name FROM supplier_orders so LEFT JOIN supplier_directory sd ON so.supplier_id = sd.id WHERE so.owner_id = ? ORDER BY so.created_at DESC'
  ).bind(ownerId).all()
  return c.json({ orders: result.results || [] })
})

// GET /supplier-orders/:id/print — printable HTML for supplier
crmRoutes.get('/supplier-orders/:id/print', async (c) => {
  const ownerId = await getOwnerIdFromCRM(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)
  const id = parseInt(c.req.param('id'))

  const order = await c.env.DB.prepare(
    'SELECT so.*, sd.name as supplier_name, sd.branch_name, sd.account_number, sd.address as supplier_address, sd.city as supplier_city, sd.province as supplier_province, sd.phone as supplier_phone, sd.email as supplier_email, sd.rep_name, sd.rep_phone, sd.rep_email FROM supplier_orders so LEFT JOIN supplier_directory sd ON so.supplier_id = sd.id WHERE so.id = ? AND so.owner_id = ?'
  ).bind(id, ownerId).first<any>()

  if (!order) return c.json({ error: 'Order not found' }, 404)

  // Get contractor info
  const contractor = await c.env.DB.prepare('SELECT name, company_name, phone, email FROM customers WHERE id = ?').bind(ownerId).first<any>()

  const items = JSON.parse(order.items_json || '[]')

  return c.html(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Material Order ${order.order_number}</title><style>*{font-family:Inter,Arial,sans-serif;margin:0;padding:0;box-sizing:border-box}body{background:white;color:#1a1a2e;padding:30px}@media print{body{padding:15px}.no-print{display:none!important}}table{width:100%;border-collapse:collapse}th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #eee;font-size:13px}th{background:#f8f9fa;font-weight:700;text-transform:uppercase;font-size:11px;color:#666;letter-spacing:0.5px}</style></head><body>
  <div class="no-print" style="margin-bottom:20px;display:flex;gap:10px">
    <button onclick="window.print()" style="background:#00FF88;color:#0a0a0a;border:none;padding:10px 24px;border-radius:8px;font-weight:700;cursor:pointer">Print / Save PDF</button>
    <button onclick="window.close()" style="background:#eee;color:#333;border:none;padding:10px 24px;border-radius:8px;font-weight:700;cursor:pointer">Close</button>
  </div>
  <div style="display:flex;justify-content:space-between;margin-bottom:30px">
    <div>
      <h1 style="font-size:24px;font-weight:800;margin-bottom:4px">MATERIAL ORDER</h1>
      <p style="color:#888;font-size:14px">#${order.order_number}</p>
      <p style="color:#888;font-size:13px">Date: ${new Date(order.created_at).toLocaleDateString()}</p>
    </div>
    <div style="text-align:right">
      <p style="font-weight:700">${contractor?.company_name || contractor?.name || 'Contractor'}</p>
      <p style="color:#666;font-size:13px">${contractor?.phone || ''}</p>
      <p style="color:#666;font-size:13px">${contractor?.email || ''}</p>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">
    <div style="background:#f8f9fa;padding:16px;border-radius:8px">
      <h3 style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Supplier</h3>
      <p style="font-weight:600">${order.supplier_name || 'N/A'}</p>
      ${order.branch_name ? `<p style="font-size:13px;color:#666">Branch: ${order.branch_name}</p>` : ''}
      ${order.account_number ? `<p style="font-size:13px;color:#666">Account #: ${order.account_number}</p>` : ''}
      ${order.supplier_address ? `<p style="font-size:13px;color:#666">${order.supplier_address}, ${order.supplier_city || ''} ${order.supplier_province || ''}</p>` : ''}
      ${order.rep_name ? `<p style="font-size:13px;color:#666;margin-top:8px">Rep: ${order.rep_name}</p>` : ''}
      ${order.rep_phone ? `<p style="font-size:13px;color:#666">${order.rep_phone}</p>` : ''}
      ${order.rep_email ? `<p style="font-size:13px;color:#666">${order.rep_email}</p>` : ''}
    </div>
    <div style="background:#f8f9fa;padding:16px;border-radius:8px">
      <h3 style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Job Details</h3>
      <p style="font-weight:600">${order.job_address || 'N/A'}</p>
      ${order.customer_name ? `<p style="font-size:13px;color:#666">Customer: ${order.customer_name}</p>` : ''}
    </div>
  </div>
  <table>
    <thead><tr><th>Material</th><th style="text-align:center">Qty</th><th style="text-align:center">Unit</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>
      ${items.map((item: any) => `<tr><td>${item.description || ''}</td><td style="text-align:center">${item.quantity || ''}</td><td style="text-align:center">${item.unit || ''}</td><td style="text-align:right">$${Number(item.unit_price || 0).toFixed(2)}</td><td style="text-align:right;font-weight:600">$${(Number(item.quantity || 0) * Number(item.unit_price || 0)).toFixed(2)}</td></tr>`).join('')}
    </tbody>
    <tfoot>
      <tr style="border-top:2px solid #333"><td colspan="4" style="text-align:right;font-weight:700;font-size:15px">Total:</td><td style="text-align:right;font-weight:700;font-size:15px">$${Number(order.total_amount || 0).toFixed(2)}</td></tr>
    </tfoot>
  </table>
  ${order.notes ? `<div style="margin-top:20px;padding:12px;background:#fffde7;border-radius:8px;font-size:13px"><strong>Notes:</strong> ${order.notes}</div>` : ''}
  <div style="margin-top:40px;font-size:12px;color:#999;text-align:center">Generated by Roof Manager — www.roofmanager.ca</div>
  </body></html>`)
})

// ============================================================
// DISPATCH BOARD — jobs × crews × days, with map + route optimization
// ============================================================

// Batched payload for the dispatch board
crmRoutes.get('/dispatch/board', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)
  const start = c.req.query('start') || new Date().toISOString().slice(0, 10)
  const days = Math.max(1, Math.min(31, parseInt(c.req.query('days') || '7', 10)))
  const end = new Date(new Date(start + 'T00:00:00Z').getTime() + days * 86400000).toISOString().slice(0, 10)

  const crewMembers = await c.env.DB.prepare(
    `SELECT tm.member_customer_id as id, tm.name, tm.email, tm.role
     FROM team_members tm
     WHERE tm.owner_id = ? AND tm.status = 'active'
     ORDER BY tm.name`
  ).bind(ownerId).all()

  const owner = await c.env.DB.prepare(
    `SELECT id, name, email FROM customers WHERE id = ?`
  ).bind(ownerId).first<any>().catch(() => null)

  const jobs = await c.env.DB.prepare(
    `SELECT j.id, j.job_number, j.title, j.property_address, j.job_type, j.status,
            j.scheduled_date, j.scheduled_time, j.estimated_duration, j.crew_size,
            j.notes, j.lat, j.lng, j.route_order,
            cc.name as customer_name, cc.phone as customer_phone,
            (SELECT COUNT(*) FROM job_photos WHERE job_id = j.id) as photo_count,
            (SELECT COUNT(*) FROM crew_messages WHERE job_id = j.id) as note_count
     FROM crm_jobs j
     LEFT JOIN crm_customers cc ON cc.id = j.crm_customer_id
     WHERE j.owner_id = ?
       AND (j.scheduled_date IS NULL OR (j.scheduled_date >= ? AND j.scheduled_date < ?))
     ORDER BY j.scheduled_date ASC, j.route_order ASC, j.id ASC`
  ).bind(ownerId, start, end).all()

  const jobIds = (jobs.results || []).map((j: any) => j.id)
  let assignments: any[] = []
  if (jobIds.length) {
    const placeholders = jobIds.map(() => '?').join(',')
    const r = await c.env.DB.prepare(
      `SELECT jca.job_id, jca.crew_member_id, jca.role, c.name as crew_name
       FROM job_crew_assignments jca
       LEFT JOIN customers c ON c.id = jca.crew_member_id
       WHERE jca.job_id IN (${placeholders})`
    ).bind(...jobIds).all()
    assignments = r.results || []
  }

  // Live clock-in status per crew member — scoped to this account's jobs
  const activeClockIns = await c.env.DB.prepare(
    `SELECT ctl.crew_member_id, ctl.job_id, ctl.clock_in
     FROM crew_time_logs ctl
     JOIN crm_jobs j ON j.id = ctl.job_id
     WHERE ctl.clock_out IS NULL AND j.owner_id = ?`
  ).bind(ownerId).all()

  return c.json({
    start, end, days,
    crew: crewMembers.results || [],
    owner,
    jobs: jobs.results || [],
    assignments,
    active_clock_ins: activeClockIns.results || [],
  })
})

// Geocode a single job (or all missing) — address → lat/lng
crmRoutes.post('/jobs/:id/geocode', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)
  const id = parseInt(c.req.param('id'), 10)
  const apiKey = c.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return c.json({ error: 'GOOGLE_MAPS_API_KEY not configured' }, 500)
  const job = await c.env.DB.prepare(
    `SELECT id, property_address FROM crm_jobs WHERE id = ? AND owner_id = ?`
  ).bind(id, ownerId).first<any>()
  if (!job) return c.json({ error: 'Job not found' }, 404)
  if (!job.property_address) return c.json({ error: 'Job has no address' }, 400)
  const loc = await geocodeAddress(job.property_address, apiKey)
  if (!loc) return c.json({ error: 'Geocoding failed' }, 502)
  await c.env.DB.prepare(`UPDATE crm_jobs SET lat = ?, lng = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(loc.lat, loc.lng, id).run()
  return c.json({ success: true, lat: loc.lat, lng: loc.lng })
})

// Bulk geocode all jobs missing lat/lng (owner scope)
crmRoutes.post('/dispatch/geocode-missing', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)
  const apiKey = c.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return c.json({ error: 'GOOGLE_MAPS_API_KEY not configured' }, 500)
  const rows = await c.env.DB.prepare(
    `SELECT id, property_address FROM crm_jobs
     WHERE owner_id = ? AND property_address IS NOT NULL AND property_address != ''
       AND (lat IS NULL OR lng IS NULL) LIMIT 50`
  ).bind(ownerId).all()
  let ok = 0, fail = 0
  for (const job of (rows.results || []) as any[]) {
    const loc = await geocodeAddress(job.property_address, apiKey)
    if (loc) {
      await c.env.DB.prepare(`UPDATE crm_jobs SET lat = ?, lng = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(loc.lat, loc.lng, job.id).run()
      ok++
    } else fail++
  }
  return c.json({ success: true, geocoded: ok, failed: fail, total: (rows.results || []).length })
})

// Optimize route for a crew member on a given date
crmRoutes.post('/dispatch/optimize', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)
  const { crewMemberId, date, origin } = await c.req.json() as { crewMemberId: number; date: string; origin?: LatLng }
  if (!crewMemberId || !date) return c.json({ error: 'crewMemberId and date required' }, 400)
  const apiKey = c.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return c.json({ error: 'GOOGLE_MAPS_API_KEY not configured' }, 500)

  const jobs = await c.env.DB.prepare(
    `SELECT j.id, j.title, j.property_address, j.lat, j.lng
     FROM crm_jobs j
     JOIN job_crew_assignments jca ON jca.job_id = j.id
     WHERE j.owner_id = ? AND jca.crew_member_id = ? AND j.scheduled_date = ?
     ORDER BY j.route_order, j.id`
  ).bind(ownerId, crewMemberId, date).all()

  const withCoords = (jobs.results || []).filter((j: any) => typeof j.lat === 'number' && typeof j.lng === 'number')
  if (withCoords.length < 2) return c.json({ error: 'Need at least 2 geocoded jobs to optimize', jobs: withCoords }, 400)

  let originPt: LatLng | null = origin || null
  if (!originPt) {
    const lastClock = await c.env.DB.prepare(
      `SELECT clock_in_lat, clock_in_lng FROM crew_time_logs
       WHERE crew_member_id = ? AND clock_in_lat IS NOT NULL
       ORDER BY clock_in DESC LIMIT 1`
    ).bind(crewMemberId).first<any>()
    if (lastClock?.clock_in_lat) originPt = { lat: lastClock.clock_in_lat, lng: lastClock.clock_in_lng }
  }
  if (!originPt) originPt = { lat: (withCoords[0] as any).lat, lng: (withCoords[0] as any).lng }

  const stops: LatLng[] = withCoords.map((j: any) => ({ lat: j.lat, lng: j.lng }))
  const result = await optimizeRoute(originPt, stops, apiKey)
  if (!result) return c.json({ error: 'Directions API failed' }, 502)

  // Persist route_order per job
  const ordered = result.order.map(i => withCoords[i]).filter(Boolean) as any[]
  for (let i = 0; i < ordered.length; i++) {
    await c.env.DB.prepare(`UPDATE crm_jobs SET route_order = ? WHERE id = ?`).bind(i + 1, ordered[i].id).run()
  }

  return c.json({
    success: true,
    order: ordered.map(j => j.id),
    jobs: ordered,
    total_km: +(result.totalMeters / 1000).toFixed(1),
    total_minutes: Math.round(result.totalSeconds / 60),
    polyline: result.polyline,
    origin: originPt,
  })
})

// Unassign a crew member from a job (drag-to-unassigned)
crmRoutes.post('/jobs/:id/unassign', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)
  const id = parseInt(c.req.param('id'), 10)
  const { crew_member_id, clear_schedule } = await c.req.json().catch(() => ({})) as { crew_member_id?: number; clear_schedule?: boolean }
  const job = await c.env.DB.prepare(`SELECT id FROM crm_jobs WHERE id = ? AND owner_id = ?`).bind(id, ownerId).first()
  if (!job) return c.json({ error: 'Job not found' }, 404)
  if (crew_member_id) {
    await c.env.DB.prepare(`DELETE FROM job_crew_assignments WHERE job_id = ? AND crew_member_id = ?`).bind(id, crew_member_id).run()
  } else {
    await c.env.DB.prepare(`DELETE FROM job_crew_assignments WHERE job_id = ?`).bind(id).run()
  }
  if (clear_schedule) {
    await c.env.DB.prepare(`UPDATE crm_jobs SET scheduled_date = NULL, scheduled_time = NULL, route_order = NULL, updated_at = datetime('now') WHERE id = ?`).bind(id).run()
  }
  return c.json({ success: true })
})

// ============================================================
// JOB PHOTOS — crew uploads progress photos tied to jobs
// ============================================================

async function resolveAuthor(c: any): Promise<{ id: number | null; name: string; ownerId: number | null }> {
  const auth = c.req.header('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) return { id: null, name: '', ownerId: null }
  const token = auth.slice(7)
  const session = await c.env.DB.prepare(
    "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
  ).bind(token).first<any>()
  if (session) {
    const cust = await c.env.DB.prepare('SELECT id, name FROM customers WHERE id = ?').bind(session.customer_id).first<any>()
    const { ownerId } = await resolveTeamOwner(c.env.DB, session.customer_id)
    return { id: session.customer_id, name: cust?.name || '', ownerId }
  }
  const admin = await validateAdminSession(c.env.DB, auth)
  if (admin) return { id: null, name: admin.email || 'Admin', ownerId: 1000000 + admin.id }
  return { id: null, name: '', ownerId: null }
}

// Upload a photo (base64 data URL) for a job
crmRoutes.post('/jobs/:id/photos', async (c) => {
  const author = await resolveAuthor(c)
  if (!author.ownerId) return c.json({ error: 'Unauthorized' }, 401)
  const jobId = parseInt(c.req.param('id'), 10)
  const job = await c.env.DB.prepare('SELECT id FROM crm_jobs WHERE id = ? AND owner_id = ?').bind(jobId, author.ownerId).first()
  if (!job) return c.json({ error: 'Job not found' }, 404)
  const body = await c.req.json() as { data_url?: string; caption?: string; phase?: string; lat?: number; lng?: number }
  if (!body.data_url || !body.data_url.startsWith('data:image/')) return c.json({ error: 'Valid image data_url required' }, 400)
  if (body.data_url.length > 3_000_000) return c.json({ error: 'Image too large (max ~2MB after downscale)' }, 413)
  const phase = ['before','during','after','damage','material_delivery'].includes(body.phase || '') ? body.phase : 'during'
  const result = await c.env.DB.prepare(
    `INSERT INTO job_photos (job_id, crew_member_id, author_name, data_url, caption, phase, lat, lng)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(jobId, author.id, author.name, body.data_url, body.caption || '', phase, body.lat ?? null, body.lng ?? null).run()
  return c.json({ success: true, id: result.meta.last_row_id })
})

// List photos for a job
crmRoutes.get('/jobs/:id/photos', async (c) => {
  const author = await resolveAuthor(c)
  if (!author.ownerId) return c.json({ error: 'Unauthorized' }, 401)
  const jobId = parseInt(c.req.param('id'), 10)
  const job = await c.env.DB.prepare('SELECT id FROM crm_jobs WHERE id = ? AND owner_id = ?').bind(jobId, author.ownerId).first()
  if (!job) return c.json({ error: 'Job not found' }, 404)
  const phase = c.req.query('phase')
  const rows = phase
    ? await c.env.DB.prepare('SELECT * FROM job_photos WHERE job_id = ? AND phase = ? ORDER BY created_at DESC').bind(jobId, phase).all()
    : await c.env.DB.prepare('SELECT * FROM job_photos WHERE job_id = ? ORDER BY created_at DESC').bind(jobId).all()
  return c.json({ photos: rows.results || [] })
})

// Delete a photo (author or account owner only)
crmRoutes.delete('/photos/:id', async (c) => {
  const author = await resolveAuthor(c)
  if (!author.ownerId) return c.json({ error: 'Unauthorized' }, 401)
  const photoId = parseInt(c.req.param('id'), 10)
  const row = await c.env.DB.prepare(
    `SELECT p.id, p.crew_member_id, j.owner_id FROM job_photos p JOIN crm_jobs j ON j.id = p.job_id WHERE p.id = ?`
  ).bind(photoId).first<any>()
  if (!row) return c.json({ error: 'Not found' }, 404)
  if (row.owner_id !== author.ownerId && row.crew_member_id !== author.id) return c.json({ error: 'Forbidden' }, 403)
  await c.env.DB.prepare('DELETE FROM job_photos WHERE id = ?').bind(photoId).run()
  return c.json({ success: true })
})

// Summary for crew mobile: today's jobs with photo count + latest note
crmRoutes.get('/crew/today', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)
  const session = await c.env.DB.prepare(
    "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
  ).bind(token).first<any>()
  if (!session) return c.json({ error: 'Unauthorized' }, 401)
  const myId = session.customer_id
  const me = await c.env.DB.prepare('SELECT id, name, email FROM customers WHERE id = ?').bind(myId).first<any>()
  const qDate = c.req.query('date')
  const today = (qDate && /^\d{4}-\d{2}-\d{2}$/.test(qDate)) ? qDate : new Date().toISOString().slice(0,10)

  const jobs = await c.env.DB.prepare(
    `SELECT j.id, j.job_number, j.title, j.property_address, j.job_type, j.status,
            j.scheduled_date, j.scheduled_time, j.estimated_duration, j.crew_size,
            j.notes, j.lat, j.lng, j.route_order,
            cc.name as customer_name, cc.phone as customer_phone,
            (SELECT COUNT(*) FROM job_photos WHERE job_id = j.id) as photo_count,
            (SELECT COUNT(*) FROM crew_messages WHERE job_id = j.id) as note_count
     FROM crm_jobs j
     JOIN job_crew_assignments jca ON jca.job_id = j.id AND jca.crew_member_id = ?
     LEFT JOIN crm_customers cc ON cc.id = j.crm_customer_id
     WHERE j.scheduled_date = ?
     ORDER BY COALESCE(j.route_order, 999), j.scheduled_time, j.id`
  ).bind(myId, today).all()

  const active = await c.env.DB.prepare(
    `SELECT id, job_id, clock_in FROM crew_time_logs WHERE crew_member_id = ? AND clock_out IS NULL LIMIT 1`
  ).bind(myId).first()

  return c.json({ me, date: today, jobs: jobs.results || [], active_clock_in: active || null })
})
