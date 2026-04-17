import { Hono } from 'hono'
import type { Bindings } from '../types'
import { validateAdminSession } from './auth'
import { sendGmailOAuth2 } from '../services/email'
import { logFromContext } from '../lib/team-activity'
import { resolveTeamOwner } from './team'
import { loadPermissionContext, can, redactFinancials, type PermissionContext } from '../lib/permissions'
import { verifySquareSignature } from './square'

export const invoiceRoutes = new Hono<{ Bindings: Bindings }>()

// Auth middleware — accepts Admin OR Customer tokens
// (Invoice Manager is used by both Super Admin and Customer dashboards)
invoiceRoutes.use('/*', async (c, next) => {
  const path = c.req.path
  // Allow public access to shared proposals/invoices and Square webhooks
  if (path.includes('/view/') || path.includes('/webhook') || path.includes('/respond/')) return next()

  // Try admin auth first
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (admin) { c.set('admin' as any, admin); return next() }

  // Fallback: try customer auth
  const authHeader = c.req.header('Authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (token) {
    const session = await c.env.DB.prepare(`
      SELECT cs.customer_id, c.email, c.name FROM customer_sessions cs
      JOIN customers c ON c.id = cs.customer_id
      WHERE cs.session_token = ? AND cs.expires_at > datetime('now')
    `).bind(token).first<any>()
    if (session) {
      const teamInfo = await resolveTeamOwner(c.env.DB, session.customer_id)
      const perms = await loadPermissionContext(c.env.DB, session.customer_id)
      c.set('admin' as any, {
        id: session.customer_id,
        email: session.email,
        name: session.name,
        role: 'customer',
        ownerCustomerId: teamInfo.ownerId,
      })
      c.set('perms' as any, perms)
      return next()
    }
  }

  return c.json({ error: 'Authentication required' }, 401)
})

// Scope helper: returns the effective data owner for a request.
// - Admin/superadmin: { isAdmin: true, ownerId: null } → full access
// - Customer (incl. team member): { isAdmin: false, ownerId: effective team owner id }
export function getScope(c: any): { isAdmin: boolean; ownerId: number | null } {
  const user = c.get('admin' as any) as any
  if (!user) return { isAdmin: false, ownerId: null }
  if (user.role === 'customer') {
    return { isAdmin: false, ownerId: (user.ownerCustomerId ?? user.id) as number }
  }
  return { isAdmin: true, ownerId: null }
}

// Pulls the PermissionContext loaded by the auth middleware. Super-admins
// (non-customer sessions) have no context; they bypass everything.
function getPerms(c: any): PermissionContext | null {
  return (c.get('perms' as any) as PermissionContext | undefined) || null
}

// ── Helpers ──────────────────────────────────────────────────
function generateNumber(prefix: string): string {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0')
  return `${prefix}-${d}-${rand}`
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function generateShareToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let token = ''
  for (let i = 0; i < 32; i++) token += chars[Math.floor(Math.random() * chars.length)]
  return token
}

export function calculateTotals(items: any[], taxRate: number, discountAmount: number, discountType: string = 'fixed') {
  let subtotal = 0
  let taxableSubtotal = 0
  for (const item of items) {
    const amount = (item.quantity || 1) * (item.unit_price || 0)
    subtotal += amount
    if (item.is_taxable !== false && item.is_taxable !== 0) taxableSubtotal += amount
  }
  const actualDiscount = discountType === 'percentage'
    ? Math.round(subtotal * (discountAmount / 100) * 100) / 100
    : (discountAmount || 0)
  const taxAmount = Math.round(taxableSubtotal * (taxRate / 100) * 100) / 100
  const total = Math.round((subtotal - actualDiscount + taxAmount) * 100) / 100
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    taxAmount: Math.round(taxAmount * 100) / 100,
    discount: Math.round(actualDiscount * 100) / 100,
    total: Math.max(0, total)
  }
}

// ============================================================
// LIST ALL INVOICES/PROPOSALS/ESTIMATES
// ============================================================
invoiceRoutes.get('/', async (c) => {
  try {
    const status = c.req.query('status')
    const customerId = c.req.query('customer_id')
    const docType = c.req.query('document_type')
    const scope = getScope(c)

    let query = `
      SELECT i.*,
             COALESCE(NULLIF(i.crm_customer_name,''), c.name) as customer_name,
             COALESCE(NULLIF(i.crm_customer_email,''), c.email) as customer_email,
             c.company_name as customer_company,
             o.order_number, o.property_address,
             CASE WHEN o.id IS NOT NULL THEN (
               SELECT COUNT(*) FROM reports r WHERE r.order_id = o.id AND r.status IN ('completed','enhancing')
             ) ELSE 0 END as has_report,
             (SELECT payment_link_url FROM square_payment_links WHERE invoice_id = i.id AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1) as payment_link_url
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id
      LEFT JOIN orders o ON o.id = i.order_id
      WHERE 1=1
    `
    const params: any[] = []

    // Enforce per-customer scoping for non-admin sessions
    if (!scope.isAdmin) {
      if (scope.ownerId == null) return c.json({ error: 'Authentication required' }, 401)
      query += ' AND i.customer_id = ?'; params.push(scope.ownerId)
    }

    if (status) { query += ' AND i.status = ?'; params.push(status) }
    if (customerId) { query += ' AND i.customer_id = ?'; params.push(customerId) }
    // M-3: treat document_type=invoice the same as no filter — include legacy NULL rows
    if (docType === 'invoice' || !docType) { query += " AND (i.document_type IS NULL OR i.document_type = 'invoice')" }
    else { query += ' AND i.document_type = ?'; params.push(docType) }

    query += ' ORDER BY i.created_at DESC'
    const invoices = await c.env.DB.prepare(query).bind(...params).all()

    // C-7: Scope stats by customer when request comes from a customer session
    const stats = !scope.isAdmin
      ? await c.env.DB.prepare(`
          SELECT
            COUNT(*) as total_invoices,
            SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END) as total_paid,
            SUM(CASE WHEN status IN ('sent','viewed') THEN total ELSE 0 END) as total_outstanding,
            SUM(CASE WHEN status = 'overdue' THEN total ELSE 0 END) as total_overdue,
            SUM(CASE WHEN status = 'draft' THEN total ELSE 0 END) as total_draft
          FROM invoices WHERE customer_id = ?
        `).bind(scope.ownerId).first()
      : await c.env.DB.prepare(`
          SELECT
            COUNT(*) as total_invoices,
            SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END) as total_paid,
            SUM(CASE WHEN status IN ('sent','viewed') THEN total ELSE 0 END) as total_outstanding,
            SUM(CASE WHEN status = 'overdue' THEN total ELSE 0 END) as total_overdue,
            SUM(CASE WHEN status = 'draft' THEN total ELSE 0 END) as total_draft
          FROM invoices
        `).first()

    // Team members without view_financials see rows but not dollar amounts.
    const perms = getPerms(c)
    const hideMoney = perms ? !can(perms, 'view_financials') : false
    const rows = invoices.results as any[]
    const safeInvoices = hideMoney ? rows.map(r => redactFinancials(r)) : rows
    const safeStats = hideMoney && stats ? redactFinancials(stats as any) : stats

    return c.json({ invoices: safeInvoices, stats: safeStats, financials_hidden: hideMoney })
  } catch (err: any) {
    console.error("[error]", err && err.message); return c.json({ error: 'Failed to fetch invoices' }, 500)
  }
})

// ============================================================
// GET SINGLE INVOICE with items + payment links
// ============================================================
invoiceRoutes.get('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    if (id === 'stats' || id === 'customers') return c.json({ error: 'Use specific endpoint' }, 400)

    const invoice = await c.env.DB.prepare(`
      SELECT i.*,
             COALESCE(NULLIF(i.crm_customer_name,''), c.name) as customer_name,
             COALESCE(NULLIF(i.crm_customer_email,''), c.email) as customer_email,
             COALESCE(NULLIF(i.crm_customer_phone,''), c.phone) as customer_phone,
             c.company_name as customer_company, c.address as customer_address,
             c.city as customer_city, c.province as customer_province, c.postal_code as customer_postal,
             o.order_number, o.property_address
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id
      LEFT JOIN orders o ON o.id = i.order_id
      WHERE i.id = ?
    `).bind(id).first() as any

    if (!invoice) return c.json({ error: 'Invoice not found' }, 404)

    const scope = getScope(c)
    if (!scope.isAdmin && invoice.customer_id !== scope.ownerId) {
      return c.json({ error: 'Invoice not found' }, 404)
    }

    const items = await c.env.DB.prepare(
      'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order'
    ).bind(id).all()

    // Get Square payment links
    let paymentLinks: any[] = []
    try {
      const links = await c.env.DB.prepare(
        'SELECT * FROM square_payment_links WHERE invoice_id = ? ORDER BY created_at DESC'
      ).bind(id).all()
      paymentLinks = links.results || []
    } catch { /* table may not exist yet */ }

    // Get attached report if any
    let attachedReport = null
    if ((invoice as any).attached_report_id) {
      try {
        attachedReport = await c.env.DB.prepare(`
          SELECT r.id, r.status, o.order_number, o.property_address
          FROM reports r JOIN orders o ON o.id = r.order_id
          WHERE r.id = ? AND r.status IN ('completed','enhancing')
        `).bind((invoice as any).attached_report_id).first()
      } catch {}
    }

    const perms = getPerms(c)
    const hideMoney = perms ? !can(perms, 'view_financials') : false
    const safeInvoice = hideMoney ? redactFinancials(invoice as any) : invoice
    const safeItems = hideMoney ? (items.results as any[]).map(r => redactFinancials(r)) : items.results
    return c.json({ invoice: safeInvoice, items: safeItems, payment_links: paymentLinks, attached_report: attachedReport, financials_hidden: hideMoney })
  } catch (err: any) {
    console.error("[error]", err && err.message); return c.json({ error: 'Failed to fetch invoice' }, 500)
  }
})

// ============================================================
// CREATE INVOICE / PROPOSAL / ESTIMATE
// ============================================================
invoiceRoutes.post('/', async (c) => {
  try {
    const body = await c.req.json()
    const {
      customer_id, crm_customer_id, new_customer, order_id, items, notes, terms, due_days, tax_rate, discount_amount,
      discount_type, document_type, scope_of_work, warranty_terms, payment_terms_text,
      valid_until, attached_report_id, proposal_tier, proposal_group_id, my_cost, accent_color, show_report_sections
    } = body

    if (!customer_id && !crm_customer_id && !new_customer) return c.json({ error: 'customer_id or new_customer is required' }, 400)
    if (!items || !items.length) return c.json({ error: 'At least one line item is required' }, 400)

    // RBAC: creating documents requires the 'invoices' module permission.
    const perms = getPerms(c)
    if (perms && !can(perms, 'invoices')) {
      return c.json({ error: 'You do not have permission to create invoices or proposals' }, 403)
    }

    // For non-admin sessions, reject cross-customer writes up front.
    const scope = getScope(c)
    if (!scope.isAdmin) {
      if (scope.ownerId == null) return c.json({ error: 'Authentication required' }, 401)
      if (customer_id && Number(customer_id) !== scope.ownerId) {
        return c.json({ error: 'Cannot create document for another customer' }, 403)
      }
      if (crm_customer_id) {
        const crm = await c.env.DB.prepare('SELECT owner_id FROM crm_customers WHERE id = ?').bind(crm_customer_id).first<any>()
        if (!crm || crm.owner_id !== scope.ownerId) {
          return c.json({ error: 'CRM contact not found' }, 404)
        }
      }
    }

    const docType = ['invoice', 'proposal', 'estimate'].includes(document_type) ? document_type : 'invoice'
    const prefix = docType === 'proposal' ? 'PROP' : docType === 'estimate' ? 'EST' : 'INV'
    const number = generateNumber(prefix)
    const shareToken = generateShareToken()

    // Resolve customer — from main customers table, crm_customers, or inline new_customer
    let resolvedCustomerId = customer_id
    let crmName = '', crmEmail = '', crmPhone = ''
    if (new_customer && !customer_id && !crm_customer_id) {
      if (!new_customer.name || !new_customer.email) return c.json({ error: 'New customer name and email are required' }, 400)
      const email = new_customer.email.toLowerCase().trim()
      const existing = await c.env.DB.prepare('SELECT id FROM customers WHERE email = ?').bind(email).first<any>()
      if (existing) {
        resolvedCustomerId = existing.id
      } else {
        const ins = await c.env.DB.prepare(
          `INSERT INTO customers (email, name, phone, company_name, is_active) VALUES (?, ?, ?, ?, 1)`
        ).bind(email, new_customer.name.trim(), new_customer.phone || null, new_customer.company_name || null).run()
        resolvedCustomerId = ins.meta.last_row_id
      }
    } else if (crm_customer_id) {
      const crmCust = await c.env.DB.prepare(
        'SELECT id, owner_id, name, email, phone FROM crm_customers WHERE id = ?'
      ).bind(crm_customer_id).first<any>()
      if (!crmCust) return c.json({ error: 'CRM customer not found' }, 404)
      crmName = crmCust.name || ''
      crmEmail = crmCust.email || ''
      crmPhone = crmCust.phone || ''
      if (crmCust.owner_id < 1000000) {
        // Portal customer owns this CRM contact — use their ID directly
        resolvedCustomerId = crmCust.owner_id
      } else {
        // Admin-owned CRM contact (owner_id = 1000000 + admin_id).
        // invoices.customer_id is NOT NULL so we find/create a real customers row
        // linked to the admin's email address.
        const adminId = crmCust.owner_id - 1000000
        const adminUser = await c.env.DB.prepare(
          'SELECT email, name FROM admin_users WHERE id = ?'
        ).bind(adminId).first<any>()
        if (adminUser?.email) {
          const adminEmail = adminUser.email.toLowerCase()
          const existingCust = await c.env.DB.prepare(
            'SELECT id FROM customers WHERE email = ?'
          ).bind(adminEmail).first<any>()
          if (existingCust) {
            resolvedCustomerId = existingCust.id
          } else {
            const ins = await c.env.DB.prepare(
              'INSERT INTO customers (email, name, is_active) VALUES (?, ?, 1)'
            ).bind(adminEmail, adminUser.name || adminEmail).run()
            resolvedCustomerId = ins.meta.last_row_id
          }
        }
      }
    } else {
      const customer = await c.env.DB.prepare('SELECT id, name FROM customers WHERE id = ?').bind(customer_id).first()
      if (!customer) return c.json({ error: 'Customer not found' }, 404)
    }

    const taxRateVal = tax_rate != null ? tax_rate : 5.0
    const discountVal = discount_amount || 0
    const { subtotal, taxAmount, discount, total } = calculateTotals(items, taxRateVal, discountVal, discount_type || 'fixed')

    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + (due_days || 30))

    const defaultTerms = docType === 'proposal'
      ? 'This proposal is valid for 30 days from the date of issue.'
      : docType === 'estimate'
        ? 'This estimate is approximate and subject to change upon site inspection.'
        : 'Payment due within 30 days of invoice date.'

    const result = await c.env.DB.prepare(`
      INSERT INTO invoices (invoice_number, customer_id, crm_customer_id, crm_customer_name,
                            crm_customer_email, crm_customer_phone,
                            order_id, subtotal, tax_rate, tax_amount,
                            discount_amount, discount_type, total, status, due_date, notes, terms, created_by, document_type,
                            share_token, share_url, scope_of_work, warranty_terms, payment_terms_text, valid_until,
                            attached_report_id, proposal_tier, proposal_group_id, my_cost, accent_color, show_report_sections)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      number, resolvedCustomerId, crm_customer_id || null, crmName, crmEmail, crmPhone,
      order_id || null,
      subtotal, taxRateVal, taxAmount, discountVal, discount_type || 'fixed', total,
      dueDate.toISOString().slice(0, 10),
      notes || null, terms || defaultTerms, 'admin', docType,
      shareToken, `/proposal/view/${shareToken}`,
      scope_of_work || '', warranty_terms || '', payment_terms_text || '',
      valid_until || '', attached_report_id || null, proposal_tier || '', proposal_group_id || '',
      my_cost != null ? my_cost : null,
      accent_color || null,
      show_report_sections ? JSON.stringify(show_report_sections) : null
    ).run()

    const invoiceId = result.meta.last_row_id

    await logFromContext(c, { entity_type: 'invoice', entity_id: Number(invoiceId), action: 'created', metadata: { invoice_number: number, document_type: docType, total, customer_name: crmName } })

    // Insert line items with unit and taxable flag
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const qty = item.quantity || 1
      const price = item.unit_price || 0
      const amount = Math.round(qty * price * 100) / 100
      await c.env.DB.prepare(`
        INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order, unit, is_taxable, category)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(invoiceId, item.description, qty, price, amount, i, item.unit || 'each', item.is_taxable !== false ? 1 : 0, item.category || '').run()
    }

    await c.env.DB.prepare(`
      INSERT INTO user_activity_log (company_id, action, details)
      VALUES (1, 'document_created', ?)
    `).bind(`${docType.charAt(0).toUpperCase() + docType.slice(1)} ${number} for $${total} CAD`).run().catch((e) => console.warn("[silent-catch]", (e && e.message) || e))

    const shareUrl = `/proposal/view/${shareToken}`

    return c.json({
      success: true,
      invoice: {
        id: invoiceId, invoice_number: number, total, status: 'draft',
        document_type: docType, share_token: shareToken, share_url: shareUrl
      }
    }, 201)
  } catch (err: any) {
    console.error("[error]", err && err.message); return c.json({ error: 'Failed to create document' }, 500)
  }
})

// ============================================================
// UPDATE INVOICE (draft only — full edit)
// ============================================================
invoiceRoutes.put('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const invoice = await c.env.DB.prepare("SELECT id, status, customer_id FROM invoices WHERE id = ?").bind(id).first<any>()
    if (!invoice) return c.json({ error: 'Invoice not found' }, 404)
    const scope = getScope(c)
    if (!scope.isAdmin && invoice.customer_id !== scope.ownerId) {
      return c.json({ error: 'Invoice not found' }, 404)
    }
    if (invoice.status !== 'draft') return c.json({ error: 'Only draft documents can be edited' }, 400)

    const body = await c.req.json()
    const {
      customer_id, crm_customer_id, order_id, items, notes, terms, due_days, tax_rate, discount_amount,
      discount_type, document_type, scope_of_work, warranty_terms, payment_terms_text,
      valid_until, attached_report_id, my_cost, accent_color, show_report_sections
    } = body

    if (!scope.isAdmin) {
      if (customer_id && Number(customer_id) !== scope.ownerId) {
        return c.json({ error: 'Cannot reassign document to another customer' }, 403)
      }
      if (crm_customer_id) {
        const crm = await c.env.DB.prepare('SELECT owner_id FROM crm_customers WHERE id = ?').bind(crm_customer_id).first<any>()
        if (!crm || crm.owner_id !== scope.ownerId) {
          return c.json({ error: 'CRM contact not found' }, 404)
        }
      }
    }

    const docType = ['invoice', 'proposal', 'estimate'].includes(document_type) ? document_type : 'invoice'
    const taxRateVal = tax_rate != null ? tax_rate : 5.0
    const discountVal = discount_amount || 0

    let subtotal = 0, taxAmount = 0, total = 0, discount = 0
    if (items && items.length) {
      const calc = calculateTotals(items, taxRateVal, discountVal, discount_type || 'fixed')
      subtotal = calc.subtotal; taxAmount = calc.taxAmount; discount = calc.discount; total = calc.total
    }

    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + (due_days || 30))

    // Resolve customer info for CRM contacts
    let resolvedCustomerId = customer_id
    let crmName = '', crmEmail = '', crmPhone = ''
    if (crm_customer_id) {
      const crmCust = await c.env.DB.prepare(
        'SELECT id, owner_id, name, email, phone FROM crm_customers WHERE id = ?'
      ).bind(crm_customer_id).first<any>()
      if (crmCust) {
        crmName = crmCust.name || ''
        crmEmail = crmCust.email || ''
        crmPhone = crmCust.phone || ''
        if (crmCust.owner_id < 1000000) {
          resolvedCustomerId = crmCust.owner_id
        } else {
          const adminId = crmCust.owner_id - 1000000
          const adminUser = await c.env.DB.prepare(
            'SELECT email, name FROM admin_users WHERE id = ?'
          ).bind(adminId).first<any>()
          if (adminUser?.email) {
            const adminEmail = adminUser.email.toLowerCase()
            const existingCust = await c.env.DB.prepare(
              'SELECT id FROM customers WHERE email = ?'
            ).bind(adminEmail).first<any>()
            if (existingCust) {
              resolvedCustomerId = existingCust.id
            } else {
              const ins = await c.env.DB.prepare(
                'INSERT INTO customers (email, name, is_active) VALUES (?, ?, 1)'
              ).bind(adminEmail, adminUser.name || adminEmail).run()
              resolvedCustomerId = ins.meta.last_row_id
            }
          }
        }
      }
    }

    await c.env.DB.prepare(`
      UPDATE invoices SET customer_id = ?, crm_customer_id = ?, crm_customer_name = ?,
        crm_customer_email = ?, crm_customer_phone = ?,
        order_id = ?, subtotal = ?, tax_rate = ?,
        tax_amount = ?, discount_amount = ?, discount_type = ?, total = ?, due_date = ?, notes = ?, terms = ?,
        document_type = ?, scope_of_work = ?, warranty_terms = ?, payment_terms_text = ?,
        valid_until = ?, attached_report_id = ?, my_cost = ?, accent_color = ?, show_report_sections = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      resolvedCustomerId || null, crm_customer_id || null, crmName, crmEmail, crmPhone,
      order_id || null, subtotal, taxRateVal, taxAmount, discountVal, discount_type || 'fixed', total,
      dueDate.toISOString().slice(0, 10), notes || null, terms || null, docType,
      scope_of_work || '', warranty_terms || '', payment_terms_text || '',
      valid_until || '', attached_report_id || null, my_cost != null ? my_cost : null,
      accent_color || null,
      show_report_sections ? JSON.stringify(show_report_sections) : null,
      id
    ).run()

    if (items && items.length > 0) {
      await c.env.DB.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').bind(id).run()
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const qty = item.quantity || 1
        const price = item.unit_price || 0
        const amount = Math.round(qty * price * 100) / 100
        await c.env.DB.prepare(`
          INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order, unit, is_taxable, category)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(id, item.description, qty, price, amount, i, item.unit || 'each', item.is_taxable !== false ? 1 : 0, item.category || '').run()
      }
    }

    return c.json({ success: true, invoice: { id, total, status: 'draft', document_type: docType } })
  } catch (err: any) {
    console.error("[error]", err && err.message); return c.json({ error: 'Failed to update document' }, 500)
  }
})

// ============================================================
// UPDATE STATUS
// ============================================================
invoiceRoutes.patch('/:id/status', async (c) => {
  try {
    const id = c.req.param('id')
    const { status } = await c.req.json()
    const validStatuses = ['draft', 'sent', 'viewed', 'paid', 'overdue', 'cancelled', 'refunded', 'accepted', 'declined']
    if (!validStatuses.includes(status)) return c.json({ error: 'Invalid status' }, 400)

    const own = await c.env.DB.prepare('SELECT customer_id FROM invoices WHERE id = ?').bind(id).first<any>()
    if (!own) return c.json({ error: 'Invoice not found' }, 404)
    const scope = getScope(c)
    if (!scope.isAdmin && own.customer_id !== scope.ownerId) return c.json({ error: 'Invoice not found' }, 404)

    await c.env.DB.prepare(`
      UPDATE invoices SET
        status = ?,
        updated_at = datetime('now'),
        sent_date = CASE WHEN ? = 'sent' THEN date('now') ELSE sent_date END,
        paid_date = CASE WHEN ? = 'paid' THEN date('now') ELSE paid_date END
      WHERE id = ?
    `).bind(status, status, status, id).run()
    await c.env.DB.prepare(`INSERT INTO user_activity_log (company_id, action, details) VALUES (1, 'status_updated', ?)`).bind(`Document #${id} → ${status}`).run().catch((e) => console.warn("[silent-catch]", (e && e.message) || e))

    return c.json({ success: true, status })
  } catch (err: any) {
    console.error("[error]", err && err.message); return c.json({ error: 'Failed to update status' }, 500)
  }
})

// ============================================================
// SEND (mark as sent + generate share link)
// ============================================================
invoiceRoutes.post('/:id/send', async (c) => {
  try {
    const id = c.req.param('id')
    const invoice = await c.env.DB.prepare(`
      SELECT i.*,
             COALESCE(NULLIF(i.crm_customer_email,''), c.email) as customer_email,
             COALESCE(NULLIF(i.crm_customer_name,''), c.name) as customer_name,
             COALESCE(NULLIF(i.crm_customer_phone,''), c.phone) as customer_phone,
             c.company_name as customer_company,
             o.order_number, o.property_address, o.id as linked_order_id
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id
      LEFT JOIN orders o ON o.id = i.order_id
      WHERE i.id = ?
    `).bind(id).first<any>()
    if (!invoice) return c.json({ error: 'Document not found' }, 404)
    {
      const scope = getScope(c)
      if (!scope.isAdmin && invoice.customer_id !== scope.ownerId) return c.json({ error: 'Document not found' }, 404)
    }

    const items = await c.env.DB.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order').bind(id).all()

    // Generate share token if missing
    let shareToken = invoice.share_token
    if (!shareToken) {
      shareToken = generateShareToken()
      await c.env.DB.prepare('UPDATE invoices SET share_token = ? WHERE id = ?').bind(shareToken, id).run()
    }

    // Check attached report
    let attachedReport = null
    if (invoice.linked_order_id || invoice.attached_report_id) {
      const reportId = invoice.attached_report_id || invoice.linked_order_id
      const report = await c.env.DB.prepare(`
        SELECT r.id, r.status, o.order_number, o.property_address
        FROM reports r JOIN orders o ON o.id = r.order_id
        WHERE (r.id = ? OR r.order_id = ?) AND r.status IN ('completed','enhancing') LIMIT 1
      `).bind(reportId, reportId).first<any>()
      if (report) attachedReport = { report_id: report.id, order_number: report.order_number, property_address: report.property_address, report_url: `/api/reports/${report.id}/html` }
    }

    const docType = invoice.document_type || 'invoice'
    const docLabel = docType.charAt(0).toUpperCase() + docType.slice(1)

    // Actually send the email via Gmail OAuth2 if configured
    let emailSent = false
    let emailError = ''
    const clientId = (c.env as any).GMAIL_CLIENT_ID
    const clientSecret = (c.env as any).GMAIL_CLIENT_SECRET
    const refreshToken = (c.env as any).GMAIL_REFRESH_TOKEN
    if (clientId && clientSecret && refreshToken && invoice.customer_email) {
      try {
        const origin = new URL(c.req.url).origin
        const viewUrl = `${origin}/proposal/view/${shareToken}`
        const lineItems = items.results || []
        let itemsHtml = ''
        if (lineItems.length > 0) {
          itemsHtml = '<table style="width:100%;border-collapse:collapse;margin:16px 0"><thead><tr style="background:#f8fafc"><th style="text-align:left;padding:8px;border-bottom:2px solid #e2e8f0;font-size:13px;color:#64748b">Item</th><th style="text-align:center;padding:8px;border-bottom:2px solid #e2e8f0;font-size:13px;color:#64748b">Qty</th><th style="text-align:right;padding:8px;border-bottom:2px solid #e2e8f0;font-size:13px;color:#64748b">Amount</th></tr></thead><tbody>'
          for (const it of lineItems as any[]) {
            itemsHtml += `<tr><td style="padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px">${it.description}</td><td style="text-align:center;padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px">${it.quantity}</td><td style="text-align:right;padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:600">$${Number(it.amount).toFixed(2)}</td></tr>`
          }
          itemsHtml += '</tbody></table>'
        }
        const emailHtml = `
<div style="max-width:600px;margin:0 auto;font-family:Inter,system-ui,sans-serif">
  <div style="background:linear-gradient(135deg,#0ea5e9,#2563eb);padding:32px;border-radius:16px 16px 0 0;text-align:center">
    <h1 style="color:white;font-size:22px;margin:0">Roof Manager</h1>
    <p style="color:#bfdbfe;font-size:13px;margin:4px 0 0">Professional Roof Measurement Reports</p>
  </div>
  <div style="background:white;padding:32px;border:1px solid #e2e8f0;border-top:none">
    <h2 style="color:#1e293b;font-size:18px;margin:0 0 8px">${docLabel} ${invoice.invoice_number}</h2>
    <p style="color:#64748b;font-size:14px;margin:0 0 24px">Hi ${invoice.customer_name || 'there'},</p>
    <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 16px">Please find your ${docLabel.toLowerCase()} below. Click the link to view it online and accept.</p>
    ${itemsHtml}
    <div style="background:#f8fafc;border-radius:12px;padding:16px;margin:16px 0">
      <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:800;color:#0f172a"><span>Total</span><span>$${Number(invoice.total || 0).toFixed(2)} CAD</span></div>
    </div>
    <div style="text-align:center;margin:24px 0"><a href="${viewUrl}" style="display:inline-block;background:#0ea5e9;color:white;padding:14px 32px;border-radius:12px;text-decoration:none;font-size:16px;font-weight:700">View ${docLabel}</a></div>
    ${invoice.valid_until ? `<p style="color:#64748b;font-size:12px;text-align:center">Valid until: ${invoice.valid_until}</p>` : ''}
  </div>
  <div style="background:#f8fafc;padding:16px;border-radius:0 0 16px 16px;text-align:center;border:1px solid #e2e8f0;border-top:none">
    <p style="color:#94a3b8;font-size:11px;margin:0">Powered by Roof Manager — Canada's AI Roof Measurement Platform</p>
  </div>
</div>`
        await sendGmailOAuth2(clientId, clientSecret, refreshToken, invoice.customer_email, `${docLabel} ${invoice.invoice_number} — $${Number(invoice.total || 0).toFixed(2)}`, emailHtml)
        emailSent = true
      } catch (e: any) {
        emailError = e.message || 'Email send failed'
      }
    }

    await c.env.DB.prepare(`UPDATE invoices SET status = 'sent', sent_date = date('now'), updated_at = datetime('now') WHERE id = ?`).bind(id).run()

    await c.env.DB.prepare(`INSERT INTO user_activity_log (company_id, action, details) VALUES (1, 'document_sent', ?)`).bind(`${docLabel} ${invoice.invoice_number} sent to ${invoice.customer_email}`).run().catch((e) => console.warn("[silent-catch]", (e && e.message) || e))

    return c.json({
      success: true,
      message: emailSent ? `${docLabel} ${invoice.invoice_number} emailed to ${invoice.customer_email}` : `${docLabel} ${invoice.invoice_number} marked as sent`,
      email_sent: emailSent,
      email_error: emailError || undefined,
      document_type: docType,
      customer_email: invoice.customer_email,
      customer_name: invoice.customer_name,
      invoice_number: invoice.invoice_number,
      total: invoice.total,
      items: items.results,
      share_url: `/proposal/view/${shareToken}`,
      share_token: shareToken,
      attached_report: attachedReport
    })
  } catch (err: any) {
    console.error("[error]", err && err.message); return c.json({ error: 'Failed to send document' }, 500)
  }
})

// ============================================================
// CREATE INVOICE FROM PROPOSAL (auto-populate)
// ============================================================
invoiceRoutes.post('/:id/convert-to-invoice', async (c) => {
  try {
    const id = c.req.param('id')
    const proposal = await c.env.DB.prepare('SELECT * FROM invoices WHERE id = ? AND document_type = ?').bind(id, 'proposal').first<any>()
    if (!proposal) return c.json({ error: 'Proposal not found' }, 404)
    {
      const scope = getScope(c)
      if (!scope.isAdmin && proposal.customer_id !== scope.ownerId) return c.json({ error: 'Proposal not found' }, 404)
    }

    const items = await c.env.DB.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order').bind(id).all()

    const invNumber = generateNumber('INV')
    const shareToken = generateShareToken()
    const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 30)

    const result = await c.env.DB.prepare(`
      INSERT INTO invoices (invoice_number, customer_id, order_id, subtotal, tax_rate, tax_amount,
                            discount_amount, total, status, due_date, notes, terms, created_by, document_type,
                            share_token, scope_of_work, warranty_terms, attached_report_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, 'admin', 'invoice', ?, ?, ?, ?)
    `).bind(
      invNumber, proposal.customer_id, proposal.order_id,
      proposal.subtotal, proposal.tax_rate, proposal.tax_amount,
      proposal.discount_amount, proposal.total,
      dueDate.toISOString().slice(0, 10),
      `Converted from proposal ${proposal.invoice_number}`,
      proposal.terms || 'Payment due within 30 days.',
      shareToken, proposal.scope_of_work || '', proposal.warranty_terms || '',
      proposal.attached_report_id
    ).run()

    const invoiceId = result.meta.last_row_id

    for (const item of (items.results || []) as any[]) {
      await c.env.DB.prepare(`
        INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order, unit, is_taxable, category)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(invoiceId, item.description, item.quantity, item.unit_price, item.amount, item.sort_order, item.unit || 'each', item.is_taxable ?? 1, item.category || '').run()
    }

    return c.json({
      success: true,
      invoice: { id: invoiceId, invoice_number: invNumber, total: proposal.total, status: 'draft', document_type: 'invoice' },
      message: `Invoice ${invNumber} created from proposal ${proposal.invoice_number}`
    }, 201)
  } catch (err: any) {
    console.error("[error]", err && err.message); return c.json({ error: 'Failed to convert proposal' }, 500)
  }
})

// ============================================================
// CREATE SQUARE PAYMENT LINK
// ============================================================
invoiceRoutes.post('/:id/payment-link', async (c) => {
  try {
    const id = c.req.param('id')
    const invoice = await c.env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(id).first<any>()
    if (!invoice) return c.json({ error: 'Invoice not found' }, 404)
    {
      const scope = getScope(c)
      if (!scope.isAdmin && invoice.customer_id !== scope.ownerId) return c.json({ error: 'Invoice not found' }, 404)
    }
    if (invoice.status === 'paid') return c.json({ error: 'Invoice already paid' }, 400)

    // Try per-user Square OAuth first (from admin/customer who created the invoice), then env fallback
    let squareAccessToken = c.env.SQUARE_ACCESS_TOKEN
    let locationId = (c.env as any).SQUARE_LOCATION_ID

    const admin = (c as any).get('admin')
    if (admin?.id) {
      const owner = await c.env.DB.prepare(
        'SELECT square_merchant_access_token, square_merchant_location_id FROM customers WHERE id = ?'
      ).bind(admin.id).first<any>()
      if (owner?.square_merchant_access_token) squareAccessToken = owner.square_merchant_access_token
      if (owner?.square_merchant_location_id) locationId = owner.square_merchant_location_id
    }

    if (!squareAccessToken) return c.json({ error: 'Square not configured. Set SQUARE_ACCESS_TOKEN in Cloudflare secrets or connect Square in Settings.' }, 400)
    if (!locationId) return c.json({ error: 'Square location ID not configured. Set SQUARE_LOCATION_ID in Cloudflare secrets or connect Square in Settings.' }, 400)

    const baseUrl = 'https://connect.squareup.com'

    const amountCents = Math.round(invoice.total * 100)
    if (amountCents <= 0) return c.json({ error: 'Invoice total must be greater than $0' }, 400)

    const idempotencyKey = `inv-${id}-${Date.now()}`

    const docLabel = (invoice.document_type || 'invoice').charAt(0).toUpperCase() + (invoice.document_type || 'invoice').slice(1)

    const sqResponse = await fetch(`${baseUrl}/v2/online-checkout/payment-links`, {
      method: 'POST',
      headers: {
        'Square-Version': '2024-01-18',
        'Authorization': `Bearer ${squareAccessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        idempotency_key: idempotencyKey,
        quick_pay: {
          name: `${docLabel} ${invoice.invoice_number}`,
          price_money: { amount: amountCents, currency: invoice.currency || 'CAD' },
          location_id: locationId
        },
        checkout_options: {
          allow_tipping: false,
          redirect_url: c.env.SQUARE_REDIRECT_URL || undefined
        }
      })
    })

    if (!sqResponse.ok) {
      const errBody: any = await sqResponse.json().catch(() => ({}))
      return c.json({ error: 'Square API error', details: errBody?.errors?.[0]?.detail || `HTTP ${sqResponse.status}` }, 502)
    }

    const sqData: any = await sqResponse.json()
    const link = sqData.payment_link
    const linkUrl = link?.url || link?.long_url || ''
    const linkId = link?.id || ''
    const orderId = sqData.related_resources?.orders?.[0]?.id || link?.order_id || ''

    await c.env.DB.prepare(`
      INSERT INTO square_payment_links (invoice_id, payment_link_id, payment_link_url, order_id, amount_cents, currency, status)
      VALUES (?, ?, ?, ?, ?, ?, 'created')
    `).bind(id, linkId, linkUrl, orderId, amountCents, invoice.currency || 'CAD').run()

    // Cache URL on the invoice row so send-gmail can find it without a JOIN
    if (linkUrl) {
      await c.env.DB.prepare(
        "UPDATE invoices SET square_payment_link_url = ?, square_payment_link_id = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(linkUrl, linkId, id).run()
    }

    return c.json({
      success: true,
      payment_link: { id: linkId, url: linkUrl, amount: invoice.total, currency: invoice.currency || 'CAD' }
    })
  } catch (err: any) {
    console.error("[error]", err && err.message); return c.json({ error: 'Failed to create payment link' }, 500)
  }
})

// ============================================================
// SQUARE WEBHOOK — Payment completed callback
// ============================================================
invoiceRoutes.post('/webhook/square', async (c) => {
  try {
    const body = await c.req.text()

    // Verify Square HMAC signature if key is configured
    const signatureKey = (c.env as any).SQUARE_WEBHOOK_SIGNATURE_KEY
    if (signatureKey) {
      const sigHeader = c.req.header('x-square-hmacsha256-signature') || ''
      const notificationUrl = c.req.url
      const isValid = await verifySquareSignature(body, sigHeader, signatureKey, notificationUrl)
      if (!isValid) {
        console.warn('[Invoice Square Webhook] Invalid signature — ignoring')
        return c.json({ ok: true }) // return 200 so Square doesn't retry
      }
    }

    const payload = JSON.parse(body)
    const eventType = payload.type || ''

    // Log webhook
    await c.env.DB.prepare(`
      INSERT INTO webhook_logs (source, event_type, event_id, payload, processed)
      VALUES ('square', ?, ?, ?, 0)
    `).bind(eventType, payload.event_id || '', body).run().catch((e) => console.warn("[silent-catch]", (e && e.message) || e))

    if (eventType === 'payment.completed' || eventType === 'payment.updated') {
      const payment = payload.data?.object?.payment
      if (!payment) return c.json({ ok: true })

      const orderId = payment.order_id || ''
      const transactionId = payment.id || ''
      const receiptUrl = payment.receipt_url || ''

      // Find the payment link by order_id
      const link = await c.env.DB.prepare(
        'SELECT * FROM square_payment_links WHERE order_id = ?'
      ).bind(orderId).first<any>()

      if (link) {
        await c.env.DB.prepare(`
          UPDATE square_payment_links SET status = 'paid', transaction_id = ?, receipt_url = ?, paid_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ?
        `).bind(transactionId, receiptUrl, link.id).run()

        // Mark invoice as paid
        await c.env.DB.prepare(`
          UPDATE invoices SET status = 'paid', paid_date = date('now'), payment_method = 'square', payment_reference = ?, updated_at = datetime('now')
          WHERE id = ?
        `).bind(transactionId, link.invoice_id).run()

        // Log webhook processed
        await c.env.DB.prepare(`
          UPDATE webhook_logs SET processed = 1, invoice_id = ? WHERE event_id = ?
        `).bind(link.invoice_id, payload.event_id || '').run().catch((e) => console.warn("[silent-catch]", (e && e.message) || e))

        await c.env.DB.prepare(`INSERT INTO user_activity_log (company_id, action, details) VALUES (1, 'payment_received', ?)`).bind(`Square payment $${(payment.amount_money?.amount || 0) / 100} for invoice #${link.invoice_id}`).run().catch((e) => console.warn("[silent-catch]", (e && e.message) || e))
      }
    }

    return c.json({ ok: true })
  } catch (err: any) {
    console.error('[Square Webhook]', err.message)
    return c.json({ ok: true }) // Always return 200 to Square
  }
})

// ============================================================
// DELETE (drafts only)
// ============================================================
invoiceRoutes.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const perms = getPerms(c)
    if (perms && !can(perms, 'delete_records')) {
      return c.json({ error: 'You do not have permission to delete records' }, 403)
    }
    const invoice = await c.env.DB.prepare("SELECT id, status, customer_id FROM invoices WHERE id = ?").bind(id).first<any>()
    if (!invoice) return c.json({ error: 'Invoice not found' }, 404)
    const scope = getScope(c)
    if (!scope.isAdmin && invoice.customer_id !== scope.ownerId) return c.json({ error: 'Invoice not found' }, 404)
    if (invoice.status !== 'draft') return c.json({ error: 'Only draft documents can be deleted' }, 400)

    await c.env.DB.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').bind(id).run()
    await c.env.DB.prepare('DELETE FROM square_payment_links WHERE invoice_id = ?').bind(id).run().catch((e) => console.warn("[silent-catch]", (e && e.message) || e))
    await c.env.DB.prepare('DELETE FROM invoices WHERE id = ?').bind(id).run()

    return c.json({ success: true })
  } catch (err: any) {
    console.error("[error]", err && err.message); return c.json({ error: 'Failed to delete document' }, 500)
  }
})

// ============================================================
// STATS
// ============================================================
invoiceRoutes.get('/stats/summary', async (c) => {
  try {
    const scope = getScope(c)
    const base = `
      SELECT
        COUNT(*) as total_invoices,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_count,
        SUM(CASE WHEN status IN ('sent','viewed') THEN 1 ELSE 0 END) as outstanding_count,
        SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) as overdue_count,
        SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END) as total_collected,
        SUM(CASE WHEN status IN ('sent','viewed') THEN total ELSE 0 END) as total_outstanding,
        SUM(CASE WHEN status = 'overdue' THEN total ELSE 0 END) as total_overdue,
        SUM(total) as grand_total
      FROM invoices
    `
    const stats = scope.isAdmin
      ? await c.env.DB.prepare(base).first()
      : await c.env.DB.prepare(base + ' WHERE customer_id = ?').bind(scope.ownerId).first()
    const perms = getPerms(c)
    const hideMoney = perms ? !can(perms, 'view_financials') : false
    return c.json({ stats: hideMoney && stats ? redactFinancials(stats as any) : stats, financials_hidden: hideMoney })
  } catch (err: any) {
    console.error("[error]", err && err.message); return c.json({ error: 'Failed to fetch stats' }, 500)
  }
})

// ============================================================
// LIST CUSTOMERS (admin — for proposal/invoice customer selector)
// ============================================================
invoiceRoutes.get('/customers/list', async (c) => {
  try {
    const scope = getScope(c)

    // Admins see the full portal customer list; customers only see their own row.
    const portalCustomers = scope.isAdmin
      ? await c.env.DB.prepare(`
          SELECT c.*,
            (SELECT COUNT(*) FROM orders WHERE customer_id = c.id) as order_count,
            (SELECT SUM(price) FROM orders WHERE customer_id = c.id AND payment_status = 'paid') as total_spent,
            (SELECT COUNT(*) FROM invoices WHERE customer_id = c.id) as invoice_count,
            (SELECT SUM(total) FROM invoices WHERE customer_id = c.id AND status = 'paid') as invoices_paid,
            'portal' as source
          FROM customers c WHERE c.is_active = 1 ORDER BY c.created_at DESC
        `).all()
      : await c.env.DB.prepare(`
          SELECT c.*,
            (SELECT COUNT(*) FROM orders WHERE customer_id = c.id) as order_count,
            (SELECT SUM(price) FROM orders WHERE customer_id = c.id AND payment_status = 'paid') as total_spent,
            (SELECT COUNT(*) FROM invoices WHERE customer_id = c.id) as invoice_count,
            (SELECT SUM(total) FROM invoices WHERE customer_id = c.id AND status = 'paid') as invoices_paid,
            'portal' as source
          FROM customers c WHERE c.is_active = 1 AND c.id = ?
        `).bind(scope.ownerId).all()

    // CRM contacts owned by the authenticated user (by team owner for team members)
    const ownerIdForCrm = scope.isAdmin ? (c.get('admin' as any) as any)?.id : scope.ownerId
    let crmCustomers: any[] = []
    if (ownerIdForCrm) {
      const res = await c.env.DB.prepare(
        `SELECT id, name, email, phone, company as company_name, address, 'crm' as source
         FROM crm_customers WHERE owner_id = ? ORDER BY name ASC`
      ).bind(ownerIdForCrm).all()
      crmCustomers = res.results as any[]
    }

    return c.json({ customers: [...(portalCustomers.results as any[]), ...crmCustomers] })
  } catch (err: any) {
    console.error("[error]", err && err.message); return c.json({ error: 'Failed to fetch customers' }, 500)
  }
})

// ============================================================
// GET SINGLE CUSTOMER
// ============================================================
invoiceRoutes.get('/customers/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const scope = getScope(c)
    if (!scope.isAdmin && Number(id) !== scope.ownerId) return c.json({ error: 'Customer not found' }, 404)
    const customer = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first()
    if (!customer) return c.json({ error: 'Customer not found' }, 404)
    const orders = await c.env.DB.prepare(`
      SELECT o.*, r.status as report_status, r.total_material_cost_cad
      FROM orders o LEFT JOIN reports r ON r.order_id = o.id
      WHERE o.customer_id = ? ORDER BY o.created_at DESC
    `).bind(id).all()
    const invoices = await c.env.DB.prepare('SELECT * FROM invoices WHERE customer_id = ? ORDER BY created_at DESC').bind(id).all()
    return c.json({ customer, orders: orders.results, invoices: invoices.results })
  } catch (err: any) {
    console.error("[error]", err && err.message); return c.json({ error: 'Failed to fetch customer' }, 500)
  }
})

// ============================================================
// SEND INVOICE VIA EMAIL — with Square payment link
// ============================================================
invoiceRoutes.post('/:id/send-gmail', async (c) => {
  try {
    const id = parseInt(c.req.param('id'))
    const invoice = await c.env.DB.prepare('SELECT i.*, c.name as customer_name, c.email as customer_email FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.id = ?').bind(id).first<any>()
    if (!invoice) return c.json({ error: 'Invoice not found' }, 404)
    {
      const scope = getScope(c)
      if (!scope.isAdmin && invoice.customer_id !== scope.ownerId) return c.json({ error: 'Invoice not found' }, 404)
    }
    if (!invoice.customer_email) return c.json({ error: 'Customer has no email address' }, 400)

    const items = await c.env.DB.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order').bind(id).all<any>()
    const lineItems = items.results || []

    // Ensure share token
    let shareToken = invoice.share_token
    if (!shareToken) {
      shareToken = crypto.randomUUID().replace(/-/g, '').substring(0, 24)
      await c.env.DB.prepare("UPDATE invoices SET share_token = ?, updated_at = datetime('now') WHERE id = ?").bind(shareToken, id).run()
    }
    const origin = new URL(c.req.url).origin
    const viewUrl = `${origin}/proposal/view/${shareToken}`

    // Get or create Square payment link
    let paymentUrl = invoice.square_payment_link_url || ''
    if (!paymentUrl) {
      // Try per-user Square OAuth first, then fall back to global env tokens
      let accessToken = (c.env as any).SQUARE_ACCESS_TOKEN
      let locationId = (c.env as any).SQUARE_LOCATION_ID
      const user = (c as any).get('admin')
      if (user?.id) {
        const owner = await c.env.DB.prepare(
          'SELECT square_merchant_access_token, square_merchant_location_id FROM customers WHERE id = ?'
        ).bind(user.id).first<any>()
        if (owner?.square_merchant_access_token) accessToken = owner.square_merchant_access_token
        if (owner?.square_merchant_location_id) locationId = owner.square_merchant_location_id
      }
      if (accessToken && locationId && invoice.total > 0) {
        try {
          const sqResp = await fetch('https://connect.squareup.com/v2/online-checkout/payment-links', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'Square-Version': '2025-01-23' },
            body: JSON.stringify({ idempotency_key: `inv-email-${id}-${Date.now()}`, quick_pay: { name: `Invoice ${invoice.invoice_number}`, price_money: { amount: Math.round(invoice.total * 100), currency: invoice.currency || 'CAD' }, location_id: locationId } })
          })
          const sqData: any = await sqResp.json()
          if (sqData.payment_link?.url) {
            paymentUrl = sqData.payment_link.url
            await c.env.DB.prepare("UPDATE invoices SET square_payment_link_url = ?, square_payment_link_id = ?, updated_at = datetime('now') WHERE id = ?").bind(paymentUrl, sqData.payment_link.id, id).run()
          }
        } catch (sqErr: any) {
          console.warn('[Square] send-gmail payment link failed:', sqErr.message)
        }
      }
    }

    // Build email HTML
    const docLabel = (invoice.document_type || 'invoice').charAt(0).toUpperCase() + (invoice.document_type || 'invoice').slice(1)
    let itemsHtml = ''
    if (lineItems.length > 0) {
      itemsHtml = '<table style="width:100%;border-collapse:collapse;margin:16px 0"><thead><tr style="background:#f8fafc"><th style="text-align:left;padding:8px;border-bottom:2px solid #e2e8f0;font-size:13px;color:#64748b">Item</th><th style="text-align:center;padding:8px;border-bottom:2px solid #e2e8f0;font-size:13px;color:#64748b">Qty</th><th style="text-align:right;padding:8px;border-bottom:2px solid #e2e8f0;font-size:13px;color:#64748b">Amount</th></tr></thead><tbody>'
      for (const it of lineItems as any[]) {
        itemsHtml += `<tr><td style="padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px">${it.description}</td><td style="text-align:center;padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px">${it.quantity}</td><td style="text-align:right;padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:600">$${Number(it.amount).toFixed(2)}</td></tr>`
      }
      itemsHtml += '</tbody></table>'
    }

    const emailHtml = `
<div style="max-width:600px;margin:0 auto;font-family:Inter,system-ui,sans-serif">
  <div style="background:linear-gradient(135deg,#0ea5e9,#2563eb);padding:32px;border-radius:16px 16px 0 0;text-align:center">
    <h1 style="color:white;font-size:22px;margin:0">Roof Manager</h1>
    <p style="color:#bfdbfe;font-size:13px;margin:4px 0 0">Professional Roof Measurement Reports</p>
  </div>
  <div style="background:white;padding:32px;border:1px solid #e2e8f0;border-top:none">
    <h2 style="color:#1e293b;font-size:18px;margin:0 0 8px">${docLabel} ${invoice.invoice_number}</h2>
    <p style="color:#64748b;font-size:14px;margin:0 0 24px">Hi ${invoice.customer_name || 'there'},</p>
    <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 16px">Please find your ${docLabel.toLowerCase()} below. ${paymentUrl ? 'Click the button to pay securely online via Square.' : ''}</p>
    ${itemsHtml}
    <div style="background:#f8fafc;border-radius:12px;padding:16px;margin:16px 0">
      <div style="display:flex;justify-content:space-between;font-size:13px;color:#64748b;margin-bottom:4px"><span>Subtotal</span><span>$${Number(invoice.subtotal || 0).toFixed(2)}</span></div>
      ${invoice.discount_amount ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:#16a34a;margin-bottom:4px"><span>Discount</span><span>-$${Number(invoice.discount_amount).toFixed(2)}</span></div>` : ''}
      ${invoice.tax_amount ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:#64748b;margin-bottom:4px"><span>Tax</span><span>$${Number(invoice.tax_amount).toFixed(2)}</span></div>` : ''}
      <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:800;color:#0f172a;border-top:2px solid #e2e8f0;padding-top:8px;margin-top:8px"><span>Total</span><span>$${Number(invoice.total || 0).toFixed(2)} ${invoice.currency || 'CAD'}</span></div>
    </div>
    ${paymentUrl ? `<div style="text-align:center;margin:24px 0"><a href="${paymentUrl}" style="display:inline-block;background:#16a34a;color:white;padding:14px 32px;border-radius:12px;text-decoration:none;font-size:16px;font-weight:700">Pay Now — $${Number(invoice.total || 0).toFixed(2)}</a><p style="color:#94a3b8;font-size:11px;margin:8px 0 0">Secure payment powered by Square</p></div>` : ''}
    <div style="text-align:center;margin:16px 0"><a href="${viewUrl}" style="color:#0ea5e9;font-size:13px;text-decoration:underline">View ${docLabel} Online</a></div>
    ${invoice.due_date ? `<p style="color:#64748b;font-size:12px;text-align:center">Due: ${new Date(invoice.due_date).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}</p>` : ''}
  </div>
  <div style="background:#f8fafc;padding:16px;border-radius:0 0 16px 16px;text-align:center;border:1px solid #e2e8f0;border-top:none">
    <p style="color:#94a3b8;font-size:11px;margin:0">Powered by Roof Manager — Canada's AI Roof Measurement Platform</p>
  </div>
</div>`

    // Send email
    const clientId = (c.env as any).GMAIL_CLIENT_ID
    const clientSecret = (c.env as any).GMAIL_CLIENT_SECRET
    const refreshToken = (c.env as any).GMAIL_REFRESH_TOKEN
    if (clientId && clientSecret && refreshToken) {
      await sendGmailOAuth2(clientId, clientSecret, refreshToken, invoice.customer_email, `${docLabel} ${invoice.invoice_number} — $${Number(invoice.total || 0).toFixed(2)}`, emailHtml)
    } else {
      return c.json({ error: 'Gmail not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN.' }, 503)
    }

    // Update status to sent
    await c.env.DB.prepare("UPDATE invoices SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END, sent_date = datetime('now'), updated_at = datetime('now') WHERE id = ?").bind(id).run()

    return c.json({ success: true, message: 'Invoice emailed to ' + invoice.customer_email, share_url: viewUrl, payment_url: paymentUrl || null })
  } catch (err: any) {
    return c.json({ error: 'Failed to send invoice: ' + err.message }, 500)
  }
})

// ============================================================
// CERTIFICATE OF NEW ROOF INSTALLATION
// ============================================================

// VIEW: return print-ready certificate HTML for an accepted proposal
invoiceRoutes.get('/:id/certificate', async (c) => {
  const scope = getScope(c)
  const id = c.req.param('id')
  const proposal = await c.env.DB.prepare(`
    SELECT i.*,
           o.property_address as order_property_address,
           c.name as owner_name, c.email as owner_email, c.phone as owner_phone,
           c.address as owner_address, c.city as owner_city, c.province as owner_province,
           c.company_name as owner_company_name, c.logo_url as owner_logo_url,
           c.brand_business_name, c.brand_logo_url, c.brand_address,
           c.brand_phone, c.brand_email, c.brand_license_number, c.brand_primary_color
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    LEFT JOIN orders o ON o.id = i.order_id
    WHERE i.id = ?${!scope.isAdmin ? ' AND i.customer_id = ?' : ''}
  `).bind(...(scope.isAdmin ? [id] : [id, scope.ownerId])).first<any>()
  if (!proposal) return c.json({ error: 'Proposal not found' }, 404)
  const { generateRoofInstallationCertificateHTML } = await import('../templates/certificate')
  const companyName = proposal.brand_business_name || proposal.owner_company_name || proposal.owner_name || 'Your Roofing Company'
  const companyAddress = proposal.brand_address || [proposal.owner_address, proposal.owner_city, proposal.owner_province].filter(Boolean).join(', ')
  const propAddress = proposal.property_address || proposal.order_property_address || ''
  const certHtml = generateRoofInstallationCertificateHTML({
    companyName,
    companyLogo: proposal.brand_logo_url || proposal.owner_logo_url || undefined,
    companyAddress: companyAddress || undefined,
    companyPhone: proposal.brand_phone || proposal.owner_phone || undefined,
    companyEmail: proposal.brand_email || proposal.owner_email || undefined,
    licenseNumber: proposal.brand_license_number || undefined,
    customerName: proposal.crm_customer_name || proposal.printed_name || 'Valued Customer',
    propertyAddress: propAddress,
    proposalNumber: proposal.invoice_number,
    signedAt: proposal.signed_at || new Date().toISOString(),
    scopeOfWork: proposal.scope_of_work || undefined,
    totalAmount: proposal.total ?? undefined,
    accentColor: proposal.brand_primary_color || undefined,
  })
  return c.html(certHtml)
})

// SEND: email certificate to customer for an accepted proposal
invoiceRoutes.post('/:id/send-certificate', async (c) => {
  const scope = getScope(c)
  const id = c.req.param('id')
  const proposal = await c.env.DB.prepare(`
    SELECT i.*,
           o.property_address as order_property_address,
           c.company_name as owner_company_name, c.logo_url as owner_logo_url,
           c.name as owner_name, c.email as owner_email, c.phone as owner_phone,
           c.address as owner_address, c.city as owner_city, c.province as owner_province,
           c.gmail_refresh_token as owner_gmail_token,
           c.brand_business_name, c.brand_logo_url, c.brand_address,
           c.brand_phone, c.brand_email, c.brand_license_number, c.brand_primary_color
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    LEFT JOIN orders o ON o.id = i.order_id
    WHERE i.id = ?${!scope.isAdmin ? ' AND i.customer_id = ?' : ''}
  `).bind(...(scope.isAdmin ? [id] : [id, scope.ownerId])).first<any>()
  if (!proposal) return c.json({ error: 'Proposal not found' }, 404)

  // Send to the homeowner (crm_customer_email stored on the invoice), not the roofing company owner
  const customerEmail = proposal.crm_customer_email
  if (!customerEmail) return c.json({ error: 'No customer email on file for this proposal. Make sure a CRM customer with an email address is linked to this proposal.' }, 400)

  const { generateRoofInstallationCertificateHTML } = await import('../templates/certificate')
  const companyName = proposal.brand_business_name || proposal.owner_company_name || proposal.owner_name || 'Your Roofing Company'
  const companyAddress = proposal.brand_address || [proposal.owner_address, proposal.owner_city, proposal.owner_province].filter(Boolean).join(', ')
  const propAddress = proposal.property_address || proposal.order_property_address || ''
  const certHtml = generateRoofInstallationCertificateHTML({
    companyName,
    companyLogo: proposal.brand_logo_url || proposal.owner_logo_url || undefined,
    companyAddress: companyAddress || undefined,
    companyPhone: proposal.brand_phone || proposal.owner_phone || undefined,
    companyEmail: proposal.brand_email || proposal.owner_email || undefined,
    licenseNumber: proposal.brand_license_number || undefined,
    customerName: proposal.crm_customer_name || proposal.printed_name || 'Valued Customer',
    propertyAddress: propAddress,
    proposalNumber: proposal.invoice_number,
    signedAt: proposal.signed_at || new Date().toISOString(),
    scopeOfWork: proposal.scope_of_work || undefined,
    totalAmount: proposal.total ?? undefined,
    accentColor: proposal.brand_primary_color || undefined,
  })

  const clientId = (c.env as any).GMAIL_CLIENT_ID
  const clientSecret = (c.env as any).GMAIL_CLIENT_SECRET
  const refreshToken = (c.env as any).GMAIL_REFRESH_TOKEN || proposal.owner_gmail_token || ''
  if (!clientId || !clientSecret || !refreshToken) {
    return c.json({ error: 'Email not configured. Please connect Gmail in your account settings.' }, 400)
  }

  try {
    await sendGmailOAuth2(
      clientId, clientSecret, refreshToken,
      customerEmail,
      `Certificate of New Roof Installation — ${propAddress || 'Your Property'}`,
      certHtml,
      proposal.owner_email
    )
    await c.env.DB.prepare(
      `UPDATE invoices SET certificate_sent_at = datetime('now') WHERE id = ?`
    ).bind(proposal.id).run()
    return c.json({ success: true, sent_to: customerEmail })
  } catch (err: any) {
    return c.json({ error: 'Failed to send certificate: ' + (err?.message || 'Unknown error') }, 500)
  }
})

// Public: Accept / Decline a proposal (invoices table) via share token
invoiceRoutes.post('/respond/:token', async (c) => {
  const token = c.req.param('token')
  const { action, signature, printed_name, signed_date } = await c.req.json()

  if (!['accept', 'decline'].includes(action)) {
    return c.json({ error: 'Invalid action' }, 400)
  }

  const proposal = await c.env.DB.prepare(
    `SELECT i.*, c.name as customer_name, c.email as customer_email
     FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
     WHERE i.share_token = ?`
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
  const safeSignature = signature && typeof signature === 'string' && signature.startsWith('data:image/') ? signature : null

  await c.env.DB.prepare(`
    UPDATE invoices SET status = ?, customer_signature = ?, printed_name = ?, signed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
  `).bind(newStatus, safeSignature, printed_name || null, proposal.id).run()

  // Email notification to the business owner (customer_id owner)
  try {
    const owner = await c.env.DB.prepare('SELECT email, name, gmail_refresh_token FROM customers WHERE id = ?').bind(proposal.customer_id).first<any>()
    if (owner?.email) {
      const clientId = (c.env as any).GMAIL_CLIENT_ID
      const clientSecret = (c.env as any).GMAIL_CLIENT_SECRET
      const refreshToken = (c.env as any).GMAIL_REFRESH_TOKEN || owner?.gmail_refresh_token || ''
      if (clientId && clientSecret && refreshToken) {
        const emoji = action === 'accept' ? '✅' : '❌'
        const statusText = action === 'accept' ? 'ACCEPTED' : 'DECLINED'
        const docLabel = (proposal.document_type || 'proposal').charAt(0).toUpperCase() + (proposal.document_type || 'proposal').slice(1)
        const notifHtml = `
<div style="max-width:600px;margin:0 auto;font-family:Inter,system-ui,sans-serif">
  <div style="background:${action === 'accept' ? '#16a34a' : '#dc2626'};padding:24px;border-radius:12px 12px 0 0;text-align:center">
    <h1 style="color:white;font-size:20px;margin:0">${emoji} ${docLabel} ${statusText}</h1>
    <p style="color:rgba(255,255,255,0.8);font-size:13px;margin:4px 0 0">${proposal.invoice_number}</p>
  </div>
  <div style="background:white;padding:24px;border:1px solid #e2e8f0;border-top:none">
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:120px"><strong>Customer</strong></td><td style="padding:8px 0;font-size:14px;color:#1e293b">${proposal.customer_name || 'Unknown'}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;font-size:13px"><strong>Total Amount</strong></td><td style="padding:8px 0;font-size:14px;color:#1e293b;font-weight:700">$${Number(proposal.total || 0).toFixed(2)}</td></tr>
      ${printed_name ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px"><strong>Signed By</strong></td><td style="padding:8px 0;font-size:14px;color:#1e293b">${escapeHtml(printed_name)}</td></tr>` : ''}
      ${signed_date ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px"><strong>Date</strong></td><td style="padding:8px 0;font-size:14px;color:#1e293b">${escapeHtml(signed_date)}</td></tr>` : ''}
    </table>
    ${signature && signature.startsWith('data:image/') ? `<div style="margin-top:16px;padding:12px;background:#f8fafc;border-radius:8px;text-align:center"><p style="font-size:11px;color:#94a3b8;margin:0 0 8px">Customer Signature</p><img src="${signature}" alt="Signature" style="max-height:60px"></div>` : ''}
  </div>
</div>`
        sendGmailOAuth2(clientId, clientSecret, refreshToken, owner.email, `${emoji} ${docLabel} ${statusText}: ${proposal.invoice_number} — $${Number(proposal.total || 0).toFixed(2)}`, notifHtml, owner.email).catch((e) => console.warn("[silent-catch]", (e && e.message) || e))
      }
    }
  } catch {}

  // Auto-send Certificate of New Roof Installation if owner has automation enabled
  if (action === 'accept') {
    // crm_customer_email is the homeowner's email stored on the invoice (i.*)
    // Do NOT use the customer_email alias — that resolves to the owner's email via the JOIN
    const homeownerEmail = proposal.crm_customer_email
    if (homeownerEmail) {
      try {
        const ownerForCert = await c.env.DB.prepare(
          `SELECT auto_send_certificate, name, email, phone, address, city, province, company_name, logo_url,
                  gmail_refresh_token, brand_business_name, brand_logo_url, brand_address,
                  brand_phone, brand_email, brand_license_number, brand_primary_color
           FROM customers WHERE id = ?`
        ).bind(proposal.customer_id).first<any>()

        if (ownerForCert?.auto_send_certificate === 1) {
          // Re-fetch the invoice with the orders join to get property_address
          const fullProposal = await c.env.DB.prepare(`
            SELECT i.*, o.property_address as order_property_address
            FROM invoices i LEFT JOIN orders o ON o.id = i.order_id
            WHERE i.id = ?
          `).bind(proposal.id).first<any>()

          const { generateRoofInstallationCertificateHTML } = await import('../templates/certificate')
          const companyName = ownerForCert.brand_business_name || ownerForCert.company_name || ownerForCert.name || 'Your Roofing Company'
          const companyAddress = ownerForCert.brand_address || [ownerForCert.address, ownerForCert.city, ownerForCert.province].filter(Boolean).join(', ')
          const propAddress = fullProposal?.property_address || fullProposal?.order_property_address || ''
          const certHtml = generateRoofInstallationCertificateHTML({
            companyName,
            companyLogo: ownerForCert.brand_logo_url || ownerForCert.logo_url || undefined,
            companyAddress: companyAddress || undefined,
            companyPhone: ownerForCert.brand_phone || ownerForCert.phone || undefined,
            companyEmail: ownerForCert.brand_email || ownerForCert.email || undefined,
            licenseNumber: ownerForCert.brand_license_number || undefined,
            customerName: fullProposal?.crm_customer_name || printed_name || 'Valued Customer',
            propertyAddress: propAddress,
            proposalNumber: proposal.invoice_number,
            signedAt: new Date().toISOString(),
            scopeOfWork: fullProposal?.scope_of_work || undefined,
            totalAmount: fullProposal?.total ?? undefined,
            accentColor: ownerForCert.brand_primary_color || undefined,
          })
          const clientId = (c.env as any).GMAIL_CLIENT_ID
          const clientSecret = (c.env as any).GMAIL_CLIENT_SECRET
          const refreshToken = (c.env as any).GMAIL_REFRESH_TOKEN || ownerForCert.gmail_refresh_token || ''
          if (clientId && clientSecret && refreshToken) {
            sendGmailOAuth2(
              clientId, clientSecret, refreshToken,
              homeownerEmail,
              `Certificate of New Roof Installation — ${propAddress || 'Your Property'}`,
              certHtml,
              ownerForCert.email
            ).catch((e) => console.warn("[silent-catch]", (e && e.message) || e))
            await c.env.DB.prepare(
              `UPDATE invoices SET certificate_sent_at = datetime('now') WHERE id = ?`
            ).bind(proposal.id).run()
          }
        }
      } catch {}
    }
  }

  return c.json({ success: true, status: newStatus })
})
