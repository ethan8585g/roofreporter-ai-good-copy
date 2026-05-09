import { Hono } from 'hono'
import type { Bindings } from '../types'
import { validateAdminSession } from './auth'
import { sendGmailOAuth2, loadGmailCreds } from '../services/email'
import { logFromContext } from '../lib/team-activity'
import { resolveTeamOwner } from './team'
import { loadPermissionContext, can, redactFinancials, type PermissionContext } from '../lib/permissions'
import { getCustomerSessionToken } from '../lib/session-tokens'
import { getMerchantSquareCreds } from '../services/square-token'
import { verifySquareSignature } from '../routes/square'

export const invoiceRoutes = new Hono<{ Bindings: Bindings }>()

// Auth middleware — accepts Admin OR Customer tokens
// (Invoice Manager is used by both Super Admin and Customer dashboards)
invoiceRoutes.use('/*', async (c, next) => {
  const path = c.req.path
  // Allow public access to shared proposals/invoices and Square webhooks
  if (path.includes('/view/') || path.includes('/webhook') || path.includes('/respond/')) return next()

  // Try admin auth first
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (admin) { c.set('admin' as any, admin); return next() }

  // Fallback: try customer auth (Bearer header OR rm_customer_session cookie)
  const token = getCustomerSessionToken(c)
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
  const rand = Math.floor(Math.random() * 99999999).toString().padStart(8, '0')
  return `${prefix}-${d}-${rand}`
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function generateShareToken(): string {
  // Use crypto.getRandomValues — Math.random is not a CSPRNG and tokens grant
  // unauthenticated access to invoices/proposals. 32 base36 chars from 24 bytes
  // of entropy ≈ 192 bits, well above brute-force range.
  const buf = new Uint8Array(24)
  crypto.getRandomValues(buf)
  return Array.from(buf, b => b.toString(36).padStart(2, '0')).join('').slice(0, 32)
}

// Email format validation
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function isValidEmail(email: string): boolean {
  return typeof email === 'string' && EMAIL_REGEX.test(email.trim()) && email.trim().length <= 320
}

// Simple in-memory rate limiter for email send endpoints (per invoice ID)
const emailSendTimestamps = new Map<string, number>()
const RATE_LIMIT_MS = 60_000 // 1 minute between sends per document
function checkEmailRateLimit(invoiceId: string): boolean {
  const key = `send:${invoiceId}`
  const last = emailSendTimestamps.get(key)
  const now = Date.now()
  if (last && now - last < RATE_LIMIT_MS) return false
  emailSendTimestamps.set(key, now)
  // Prune old entries periodically to prevent memory leaks
  if (emailSendTimestamps.size > 500) {
    for (const [k, v] of emailSendTimestamps) {
      if (now - v > RATE_LIMIT_MS * 5) emailSendTimestamps.delete(k)
    }
  }
  return true
}

// P1-27: document + lock whether discount is applied before or after tax.
// Canadian GST/HST/PST compliance: discount reduces the taxable base, so tax
// is computed on the *discounted* subtotal. Flip this flag if the business
// ever needs U.S.-style "tax on full subtotal, then subtract discount".
export const DISCOUNT_APPLIED_BEFORE_TAX = true

// P1-26: all math runs in integer cents internally. The public contract
// stays in dollars (what every caller and the DB column expect) but the
// accumulator is never a float, so we can't lose pennies through repeated
// float addition. Cents are half-up rounded at each conversion.
//
// Inputs: items[].unit_price in dollars, taxRate/discountAmount in percent or
// dollars depending on discountType.
// Outputs: { subtotal, taxAmount, discount, total } in dollars, exact to 2dp.
export function calculateTotals(items: any[], taxRate: number, discountAmount: number, discountType: string = 'fixed') {
  const toCents = (v: number) => Math.round(((typeof v === 'string' ? Number(v) : v) || 0) * 100)

  let subtotalCents = 0
  let taxableCents = 0
  for (const item of items) {
    const qty = Number(item.quantity ?? 1) || 0
    // unit_price can be a float dollar figure → convert via cents on the
    // multiplication result to avoid "0.1 + 0.2" drift.
    const unitCents = toCents(item.unit_price)
    const lineCents = Math.round(qty * unitCents)
    subtotalCents += lineCents
    if (item.is_taxable !== false && item.is_taxable !== 0) taxableCents += lineCents
  }

  const discountCents = discountType === 'percentage'
    ? Math.round(subtotalCents * ((Number(discountAmount) || 0) / 100))
    : toCents(discountAmount)

  // Discount-before-tax (see DISCOUNT_APPLIED_BEFORE_TAX). Apply proportional
  // share of the discount to the taxable portion so tax is on the discounted
  // taxable subtotal, not the gross.
  let taxableAfterDiscountCents = taxableCents
  if (DISCOUNT_APPLIED_BEFORE_TAX && subtotalCents > 0) {
    taxableAfterDiscountCents = Math.round(taxableCents * (1 - discountCents / subtotalCents))
  }
  const taxCents = Math.round(taxableAfterDiscountCents * ((Number(taxRate) || 0) / 100))
  const totalCents = Math.max(0, subtotalCents - discountCents + taxCents)

  return {
    subtotal: subtotalCents / 100,
    taxAmount: taxCents / 100,
    discount: discountCents / 100,
    total: totalCents / 100,
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
      valid_until, attached_report_id, proposal_tier, proposal_group_id, my_cost, accent_color, show_report_sections,
      send_customer_copy
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

    // Validate tax rate is non-negative
    const taxRateVal = tax_rate != null ? Math.max(0, tax_rate) : 5.0
    const discountVal = discount_amount || 0
    const { subtotal, taxAmount, discount, total } = calculateTotals(items, taxRateVal, discountVal, discount_type || 'fixed')

    // Normalize due date to midnight UTC to avoid timezone drift
    const now = new Date()
    const dueDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + (due_days || 30)))

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
                            attached_report_id, proposal_tier, proposal_group_id, my_cost, accent_color, show_report_sections,
                            send_customer_copy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      show_report_sections ? JSON.stringify(show_report_sections) : null,
      send_customer_copy === 0 || send_customer_copy === false ? 0 : 1
    ).run()

    const invoiceId = result.meta.last_row_id

    await logFromContext(c, { entity_type: 'invoice', entity_id: Number(invoiceId), action: 'created', metadata: { invoice_number: number, document_type: docType, total, customer_name: crmName } })

    // P1-25: insert all line items atomically so a mid-loop error can't
    // leave a header row with partial children on disk.
    if (items.length > 0) {
      const stmts = items.map((item: any, i: number) => {
        const qty = item.quantity || 1
        const price = item.unit_price || 0
        const amount = Math.round(qty * price * 100) / 100
        return c.env.DB.prepare(`
          INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order, unit, is_taxable, category)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(invoiceId, item.description, qty, price, amount, i, item.unit || 'each', item.is_taxable !== false ? 1 : 0, item.category || '')
      })
      await c.env.DB.batch(stmts)
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
      valid_until, attached_report_id, my_cost, accent_color, show_report_sections,
      send_customer_copy
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

    // Phase 2: UTC-stable date arithmetic (avoids setDate rollover edge cases
    // around DST and month boundaries).
    const dueDays = Number(due_days || 30)
    const dueDate = new Date(Date.now() + dueDays * 86400000)

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
        valid_until = ?, attached_report_id = ?, my_cost = ?, accent_color = ?, show_report_sections = ?,
        send_customer_copy = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      resolvedCustomerId || null, crm_customer_id || null, crmName, crmEmail, crmPhone,
      order_id || null, subtotal, taxRateVal, taxAmount, discountVal, discount_type || 'fixed', total,
      dueDate.toISOString().slice(0, 10), notes || null, terms || null, docType,
      scope_of_work || '', warranty_terms || '', payment_terms_text || '',
      valid_until || '', attached_report_id || null, my_cost != null ? my_cost : null,
      accent_color || null,
      show_report_sections ? JSON.stringify(show_report_sections) : null,
      send_customer_copy === 0 || send_customer_copy === false ? 0 : 1,
      id
    ).run()

    // P1-25: DELETE + all re-inserts run as a single atomic batch so an
    // error mid-loop can't leave the invoice with zero items on disk.
    if (items && items.length > 0) {
      const stmts: any[] = [c.env.DB.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').bind(id)]
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const qty = item.quantity || 1
        const price = item.unit_price || 0
        const amount = Math.round(qty * price * 100) / 100
        stmts.push(c.env.DB.prepare(`
          INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order, unit, is_taxable, category)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(id, item.description, qty, price, amount, i, item.unit || 'each', item.is_taxable !== false ? 1 : 0, item.category || ''))
      }
      await c.env.DB.batch(stmts)
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

    const own = await c.env.DB.prepare('SELECT customer_id, status as old_status FROM invoices WHERE id = ?').bind(id).first<any>()
    if (!own) return c.json({ error: 'Invoice not found' }, 404)
    const scope = getScope(c)
    if (!scope.isAdmin && own.customer_id !== scope.ownerId) return c.json({ error: 'Invoice not found' }, 404)

    const updates: string[] = ['status = ?', "updated_at = datetime('now')"]
    const binds: any[] = [status]
    if (status === 'sent') updates.push("sent_date = date('now')")
    if (status === 'paid') updates.push("paid_date = date('now')")

    await c.env.DB.prepare(`UPDATE invoices SET ${updates.join(', ')} WHERE id = ?`).bind(...binds, id).run()

    // Audit trail
    const admin = c.get('admin' as any) as any
    await c.env.DB.prepare(
      `INSERT INTO invoice_audit_log (invoice_id, action, old_value, new_value, changed_by) VALUES (?, 'status_change', ?, ?, ?)`
    ).bind(id, own.old_status || '', status, admin?.email || 'unknown').run().catch((e) => console.warn('[invoice-status-audit]', (e && e.message) || e))

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

    // Rate limit check
    if (!checkEmailRateLimit(id)) {
      return c.json({ error: 'Please wait at least 1 minute before resending this document' }, 429)
    }

    const docType = invoice.document_type || 'invoice'
    const docLabel = docType.charAt(0).toUpperCase() + docType.slice(1)

    // Validate email before attempting to send
    if (!invoice.customer_email || !isValidEmail(invoice.customer_email)) {
      return c.json({ error: 'Customer does not have a valid email address on file' }, 400)
    }

    // Actually send the email via Gmail OAuth2 if configured.
    // Resolves creds from env first, then D1 settings (so the /api/auth/gmail
    // "Connect Gmail" flow works without env vars also being set).
    let emailSent = false
    let emailError = ''
    const { clientId, clientSecret, refreshToken, senderEmail } = await loadGmailCreds(c.env)
    if (!clientId || !clientSecret || !refreshToken) {
      return c.json({
        error: 'Email not configured. Please connect Gmail at /api/auth/gmail or set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN.',
        connect_url: '/api/auth/gmail'
      }, 503)
    }
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
    <p style="color:#64748b;font-size:14px;margin:0 0 24px">Hi ${escapeHtml(invoice.customer_name || 'there')},</p>
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
        await sendGmailOAuth2(clientId, clientSecret, refreshToken, invoice.customer_email, `${docLabel} ${invoice.invoice_number} — $${Number(invoice.total || 0).toFixed(2)}`, emailHtml, senderEmail || c.env.GMAIL_SENDER_EMAIL || 'sales@roofmanager.ca')
        emailSent = true
      } catch (e: any) {
        emailError = e.message || 'Email send failed'
        console.error('[invoice-send] Gmail send failed:', emailError)
      }
    }

    if (!emailSent) {
      return c.json({
        error: `Failed to send ${docLabel.toLowerCase()} email to ${invoice.customer_email}. ${emailError || 'Unknown email error.'}`,
        email_error: emailError || 'Unknown email error',
        customer_email: invoice.customer_email
      }, 502)
    }

    await c.env.DB.prepare(`UPDATE invoices SET status = 'sent', sent_date = date('now'), updated_at = datetime('now') WHERE id = ?`).bind(id).run()

    await c.env.DB.prepare(`INSERT INTO user_activity_log (company_id, action, details) VALUES (1, 'document_sent', ?)`).bind(`${docLabel} ${invoice.invoice_number} sent to ${invoice.customer_email}`).run().catch((e) => console.warn("[silent-catch]", (e && e.message) || e))

    return c.json({
      success: true,
      message: `${docLabel} ${invoice.invoice_number} emailed to ${invoice.customer_email}`,
      email_sent: emailSent,
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
    const dueDate = new Date(Date.now() + 30 * 86400000)

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

    // P1-25: copy all source line items atomically.
    const copyItems = (items.results || []) as any[]
    if (copyItems.length > 0) {
      const stmts = copyItems.map((item) =>
        c.env.DB.prepare(`
          INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order, unit, is_taxable, category)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(invoiceId, item.description, item.quantity, item.unit_price, item.amount, item.sort_order, item.unit || 'each', item.is_taxable ?? 1, item.category || '')
      )
      await c.env.DB.batch(stmts)
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

    // Per-user Square OAuth: payment goes to the invoice owner's Square account.
    // No fallback to admin global token — each user must connect their own Square.
    if (!invoice.customer_id) {
      return c.json({ error: 'Invoice has no customer assigned; cannot create a payment link.' }, 400)
    }
    const creds = await getMerchantSquareCreds(c.env, invoice.customer_id)
    if ('error' in creds) return c.json({ error: creds.error }, creds.status as any)
    const squareAccessToken = creds.accessToken
    const locationId = creds.locationId

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
// Verifies HMAC-SHA256 signature against SQUARE_WEBHOOK_SIGNATURE_KEY before
// processing. Without this check anyone could POST a forged payment.completed
// payload and flip any invoice (by guessing square_order_id) to status='paid'.
// ============================================================
invoiceRoutes.post('/webhook/square', async (c) => {
  try {
    const body = await c.req.text()

    // ── Signature verification (matches src/routes/square.ts handler) ──
    // Without this, anyone could POST a forged payment.completed payload and
    // flip any invoice (by guessing square_order_id) to status='paid'.
    const sigKey = (c.env as any).SQUARE_WEBHOOK_SIGNATURE_KEY as string | undefined
    const webhookUrl = (c.env as any).SQUARE_WEBHOOK_URL as string | undefined
    if (!sigKey || !webhookUrl) {
      console.error('[invoices/webhook/square] SQUARE_WEBHOOK_SIGNATURE_KEY or SQUARE_WEBHOOK_URL not configured — rejecting webhook')
      return c.json({ error: 'webhook verification not configured' }, 500)
    }
    const sig = c.req.header('x-square-hmacsha256-signature') || ''
    if (!sig) return c.json({ error: 'missing signature' }, 400)
    const valid = await verifySquareSignature(body, sig, sigKey, webhookUrl)
    if (!valid) {
      console.warn('[invoices/webhook/square] invalid signature')
      return c.json({ error: 'invalid signature' }, 400)
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
        // Batch both updates together — if either fails, log the error clearly
        const batchStmts = [
          c.env.DB.prepare(`
            UPDATE square_payment_links SET status = 'paid', transaction_id = ?, receipt_url = ?, paid_at = datetime('now'), updated_at = datetime('now')
            WHERE id = ?
          `).bind(transactionId, receiptUrl, link.id),
          c.env.DB.prepare(`
            UPDATE invoices SET status = 'paid', paid_date = date('now'), payment_method = 'square', payment_reference = ?, updated_at = datetime('now')
            WHERE id = ?
          `).bind(transactionId, link.invoice_id),
        ]
        await c.env.DB.batch(batchStmts)

        // Log webhook processed
        await c.env.DB.prepare(`
          UPDATE webhook_logs SET processed = 1, invoice_id = ? WHERE event_id = ?
        `).bind(link.invoice_id, payload.event_id || '').run().catch((e) => console.warn("[webhook-log]", (e && e.message) || e))

        // Audit trail for payment
        await c.env.DB.prepare(
          `INSERT INTO invoice_audit_log (invoice_id, action, old_value, new_value, changed_by) VALUES (?, 'payment_received', '', ?, 'square_webhook')`
        ).bind(link.invoice_id, `Square payment $${(payment.amount_money?.amount || 0) / 100} txn:${transactionId}`).run().catch((e) => console.warn('[invoice-square-audit]', (e && e.message) || e))

        await c.env.DB.prepare(`INSERT INTO user_activity_log (company_id, action, details) VALUES (1, 'payment_received', ?)`).bind(`Square payment $${(payment.amount_money?.amount || 0) / 100} for invoice #${link.invoice_id}`).run().catch((e) => console.warn("[webhook-log]", (e && e.message) || e))
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
    // Mirror the list endpoint's document_type behavior so stats and list
    // never disagree. Default (or ?document_type=invoice) restricts to true
    // invoices + legacy NULL rows; pass ?document_type=proposal etc. to scope
    // the stats to a specific document type.
    const docType = c.req.query('document_type')
    let docFilter = ''
    const docParams: any[] = []
    if (docType === 'invoice' || !docType) {
      docFilter = "(document_type IS NULL OR document_type = 'invoice')"
    } else {
      docFilter = 'document_type = ?'
      docParams.push(docType)
    }
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
      WHERE ${docFilter}
    `
    const stats = scope.isAdmin
      ? await c.env.DB.prepare(base).bind(...docParams).first()
      : await c.env.DB.prepare(base + ' AND customer_id = ?').bind(...docParams, scope.ownerId).first()
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
            (SELECT COALESCE(SUM(price), 0) FROM orders WHERE customer_id = c.id AND payment_status = 'paid' AND (is_trial IS NULL OR is_trial = 0) AND (notes IS NULL OR notes NOT LIKE 'Paid via credit balance%'))
              + (SELECT COALESCE(SUM(amount), 0) FROM manual_payments WHERE customer_id = c.id) as total_spent,
            (SELECT COUNT(*) FROM invoices WHERE customer_id = c.id) as invoice_count,
            (SELECT SUM(total) FROM invoices WHERE customer_id = c.id AND status = 'paid') as invoices_paid,
            'portal' as source
          FROM customers c WHERE c.is_active = 1 ORDER BY c.created_at DESC
        `).all()
      : await c.env.DB.prepare(`
          SELECT c.*,
            (SELECT COUNT(*) FROM orders WHERE customer_id = c.id) as order_count,
            (SELECT COALESCE(SUM(price), 0) FROM orders WHERE customer_id = c.id AND payment_status = 'paid' AND (is_trial IS NULL OR is_trial = 0) AND (notes IS NULL OR notes NOT LIKE 'Paid via credit balance%'))
              + (SELECT COALESCE(SUM(amount), 0) FROM manual_payments WHERE customer_id = c.id) as total_spent,
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
    // Rate limit
    if (!checkEmailRateLimit(String(id))) {
      return c.json({ error: 'Please wait at least 1 minute before resending this invoice' }, 429)
    }
    const invoice = await c.env.DB.prepare('SELECT i.*, c.name as customer_name, c.email as customer_email FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.id = ?').bind(id).first<any>()
    if (!invoice) return c.json({ error: 'Invoice not found' }, 404)
    {
      const scope = getScope(c)
      if (!scope.isAdmin && invoice.customer_id !== scope.ownerId) return c.json({ error: 'Invoice not found' }, 404)
    }
    if (!invoice.customer_email || !isValidEmail(invoice.customer_email)) return c.json({ error: 'Customer has no valid email address' }, 400)

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

    // Get or create Square payment link — MUST use the invoice owner's
    // per-merchant Square credentials, not the platform admin token. Sending
    // homeowner payments to the platform's Square account routes funds to the
    // wrong place (matches the pattern at line ~860 above).
    let paymentUrl = invoice.square_payment_link_url || ''
    if (!paymentUrl && invoice.customer_id && invoice.total > 0) {
      const creds = await getMerchantSquareCreds(c.env as any, invoice.customer_id)
      if (!('error' in creds)) {
        try {
          const sqResp = await fetch('https://connect.squareup.com/v2/online-checkout/payment-links', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json', 'Square-Version': '2025-01-23' },
            body: JSON.stringify({ idempotency_key: `inv-email-${id}-${Date.now()}`, quick_pay: { name: `Invoice ${invoice.invoice_number}`, price_money: { amount: Math.round(invoice.total * 100), currency: invoice.currency || 'CAD' }, location_id: creds.locationId } })
          })
          const sqData: any = await sqResp.json()
          if (sqData.payment_link?.url) {
            paymentUrl = sqData.payment_link.url
            await c.env.DB.prepare("UPDATE invoices SET square_payment_link_url = ?, square_payment_link_id = ?, updated_at = datetime('now') WHERE id = ?").bind(paymentUrl, sqData.payment_link.id, id).run()
          }
        } catch (sqErr: any) {
          console.warn('[Square] send-gmail payment link failed:', sqErr.message)
        }
      } else {
        console.warn('[Square] send-gmail: no merchant credentials for customer', invoice.customer_id, '-', (creds as any).error)
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
    <p style="color:#64748b;font-size:14px;margin:0 0 24px">Hi ${escapeHtml(invoice.customer_name || 'there')},</p>
    <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 16px">Please find your ${docLabel.toLowerCase()} below. ${paymentUrl ? 'Click the button to pay securely online via Square.' : ''}</p>
    ${itemsHtml}
    <div style="background:#f8fafc;border-radius:12px;padding:16px;margin:16px 0">
      <div style="display:flex;justify-content:space-between;font-size:13px;color:#64748b;margin-bottom:4px"><span>Subtotal</span><span>$${Number(invoice.subtotal || 0).toFixed(2)}</span></div>
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

    // Send email — env first, D1 settings fallback (honors /api/auth/gmail flow)
    const { clientId, clientSecret, refreshToken, senderEmail } = await loadGmailCreds(c.env)
    if (clientId && clientSecret && refreshToken) {
      await sendGmailOAuth2(clientId, clientSecret, refreshToken, invoice.customer_email, `${docLabel} ${invoice.invoice_number} — $${Number(invoice.total || 0).toFixed(2)}`, emailHtml, senderEmail || c.env.GMAIL_SENDER_EMAIL || 'sales@roofmanager.ca')
    } else {
      return c.json({ error: 'Gmail not configured. Connect Gmail at /api/auth/gmail or set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN.', connect_url: '/api/auth/gmail' }, 503)
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

  // Rate limit check
  if (!checkEmailRateLimit(id)) {
    return c.json({ error: 'Please wait at least 1 minute before resending this certificate' }, 429)
  }

  // Send to the homeowner (crm_customer_email stored on the invoice), not the roofing company owner
  const customerEmail = proposal.crm_customer_email
  if (!customerEmail) return c.json({ error: 'No customer email on file for this proposal. Make sure a CRM customer with an email address is linked to this proposal.' }, 400)
  if (!isValidEmail(customerEmail)) return c.json({ error: 'Customer email address is not a valid format. Please update the CRM contact email.' }, 400)

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
      <tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:120px"><strong>Customer</strong></td><td style="padding:8px 0;font-size:14px;color:#1e293b">${escapeHtml(proposal.customer_name || 'Unknown')}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;font-size:13px"><strong>Total Amount</strong></td><td style="padding:8px 0;font-size:14px;color:#1e293b;font-weight:700">$${Number(proposal.total || 0).toFixed(2)}</td></tr>
      ${printed_name ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px"><strong>Signed By</strong></td><td style="padding:8px 0;font-size:14px;color:#1e293b">${escapeHtml(printed_name)}</td></tr>` : ''}
      ${signed_date ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px"><strong>Date</strong></td><td style="padding:8px 0;font-size:14px;color:#1e293b">${escapeHtml(signed_date)}</td></tr>` : ''}
    </table>
    ${signature && signature.startsWith('data:image/') ? `<div style="margin-top:16px;padding:12px;background:#f8fafc;border-radius:8px;text-align:center"><p style="font-size:11px;color:#94a3b8;margin:0 0 8px">Customer Signature</p><img src="${signature}" alt="Signature" style="max-height:60px"></div>` : ''}
  </div>
</div>`
        try {
          await sendGmailOAuth2(clientId, clientSecret, refreshToken, owner.email, `${emoji} ${docLabel} ${statusText}: ${proposal.invoice_number} — $${Number(proposal.total || 0).toFixed(2)}`, notifHtml, owner.email, c.env)
        } catch (e: any) {
          console.warn("[proposal-notify] send failed:", (e && e.message) || e)
          try {
            await c.env.DB.prepare(
              "INSERT INTO user_activity_log (company_id, action, details) VALUES (1, 'email_send_failed', ?)"
            ).bind(`Proposal ${proposal.invoice_number} notification to ${owner.email} failed: ${(e && e.message) || e}`.slice(0, 500)).run()
          } catch {}
        }
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
          `SELECT auto_send_certificate, cert_trigger_type, name, email, phone, address, city, province, company_name, logo_url,
                  gmail_refresh_token, brand_business_name, brand_logo_url, brand_address,
                  brand_phone, brand_email, brand_license_number, brand_primary_color
           FROM customers WHERE id = ?`
        ).bind(proposal.customer_id).first<any>()

        // Only auto-send if enabled AND trigger type is 'proposal_signed' (or default)
        const triggerType = ownerForCert?.cert_trigger_type || 'proposal_signed'
        if (ownerForCert?.auto_send_certificate === 1 && triggerType === 'proposal_signed') {
          // Re-fetch the invoice with the orders join to get property_address
          const fullProposal = await c.env.DB.prepare(`
            SELECT i.*, o.property_address as order_property_address
            FROM invoices i LEFT JOIN orders o ON o.id = i.order_id
            WHERE i.id = ?
          `).bind(proposal.id).first<any>()

          // Prevent duplicate certificate sends
          if (fullProposal?.certificate_sent_at) {
            // Certificate already sent — skip
          } else {

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
            try {
              await sendGmailOAuth2(
                clientId, clientSecret, refreshToken,
                homeownerEmail,
                `Certificate of New Roof Installation — ${propAddress || 'Your Property'}`,
                certHtml,
                ownerForCert.email
              )
              await c.env.DB.prepare(
                `UPDATE invoices SET certificate_sent_at = datetime('now') WHERE id = ?`
              ).bind(proposal.id).run()
            } catch (emailErr: any) {
              console.error('[cert-auto-send] Email failed:', emailErr?.message || emailErr)
              // Don't mark certificate_sent_at — it wasn't actually sent
            }
          }
          } // close else (duplicate prevention)
        }
      } catch (certErr: any) {
        console.error('[cert-auto-send] Error:', certErr?.message || certErr)
      }
    }
  }

  return c.json({ success: true, status: newStatus })
})
