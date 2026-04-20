import type { Bindings } from '../types'
import { logAutoInvoiceStep } from './auto-invoice-audit'

export interface AutoInvoiceResult {
  status: 'created' | 'skipped' | 'error'
  reason?: string
  invoice_id?: number
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
function isValidEmail(e: string | null | undefined): boolean {
  return typeof e === 'string' && EMAIL_RE.test(e.trim()) && e.trim().length <= 320
}

function pickNumber(obj: any, paths: string[]): number {
  for (const p of paths) {
    const v = p.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), obj)
    if (typeof v === 'number' && isFinite(v) && v > 0) return v
    if (typeof v === 'string' && v.trim()) {
      const n = parseFloat(v)
      if (isFinite(n) && n > 0) return n
    }
  }
  return 0
}

function genShareToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let t = ''
  for (let i = 0; i < 32; i++) t += chars[Math.floor(Math.random() * chars.length)]
  return t
}

function genProposalNumber(): string {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.floor(Math.random() * 99999999).toString().padStart(8, '0')
  return `PROP-${d}-${rand}`
}

/**
 * Event-driven auto-invoice creator. Call this AFTER a report transitions to
 * status='completed'. Idempotent: safe to call multiple times per order.
 *
 * Produces a DRAFT PROPOSAL (document_type='proposal', status='draft'). The
 * roofer reviews and sends it from the Proposal Dashboard — this function
 * never sends email on its own.
 */
export async function createAutoInvoiceForOrder(
  env: Bindings,
  orderId: number
): Promise<AutoInvoiceResult> {
  try {
    await logAutoInvoiceStep(env, { order_id: orderId, step: 'entered' })

    // Idempotency: if we've already drafted for this order, stop.
    const existing = await env.DB.prepare(
      `SELECT id FROM invoices WHERE order_id = ? AND created_by = 'auto-invoice' LIMIT 1`
    ).bind(orderId).first<{ id: number }>()
    if (existing?.id) {
      await logAutoInvoiceStep(env, {
        order_id: orderId, step: 'skipped_already_exists',
        invoice_id: existing.id, reason: 'auto-invoice row already present'
      })
      return { status: 'skipped', reason: 'already_exists', invoice_id: existing.id }
    }

    const order = await env.DB.prepare(
      `SELECT id, order_number, customer_id, property_address,
              invoice_customer_name, invoice_customer_email, invoice_customer_phone
       FROM orders WHERE id = ?`
    ).bind(orderId).first<any>()
    if (!order) {
      await logAutoInvoiceStep(env, { order_id: orderId, step: 'error', reason: 'order not found' })
      return { status: 'error', reason: 'order_not_found' }
    }

    // Homeowner recipient required to produce a meaningful draft.
    if (!order.invoice_customer_name || !isValidEmail(order.invoice_customer_email)) {
      await logAutoInvoiceStep(env, {
        order_id: orderId, step: 'skipped_no_recipient',
        reason: 'invoice_customer_name/email missing on order'
      })
      return { status: 'skipped', reason: 'no_recipient' }
    }

    // Roofer's automation settings
    const settings = await env.DB.prepare(
      `SELECT auto_invoice_enabled, invoice_pricing_mode, invoice_price_per_square,
              invoice_price_per_bundle
       FROM customers WHERE id = ?`
    ).bind(order.customer_id).first<any>()
    if (!settings || !settings.auto_invoice_enabled) {
      await logAutoInvoiceStep(env, {
        order_id: orderId, step: 'skipped_not_enabled',
        reason: `customer_id=${order.customer_id} auto_invoice_enabled=0`
      })
      return { status: 'skipped', reason: 'automation_disabled' }
    }

    const report = await env.DB.prepare(
      `SELECT status, report_data FROM reports WHERE order_id = ?`
    ).bind(orderId).first<any>()
    if (!report || report.status !== 'completed') {
      await logAutoInvoiceStep(env, {
        order_id: orderId, step: 'skipped_no_report',
        reason: `report.status=${report?.status || 'missing'}`
      })
      return { status: 'skipped', reason: 'report_not_completed' }
    }

    let reportData: any = {}
    try { reportData = JSON.parse(report.report_data || '{}') } catch { /* empty */ }

    const grossSquares = pickNumber(reportData, [
      'gross_squares', 'true_area_squares', 'roof_area_squares',
      'measurements.gross_squares', 'measurements.true_area_squares',
      'full_report.measurements.gross_squares',
      'full_report.gross_squares',
      'bom.gross_squares'
    ])
    const bundles = pickNumber(reportData, [
      'total_bundles', 'bom_total_bundles',
      'measurements.total_bundles', 'bom.total_bundles',
      'full_report.bom.total_bundles', 'full_report.total_bundles'
    ])

    const pricingMode = settings.invoice_pricing_mode || 'per_square'
    let quantity = 0
    let unitPrice = 0
    let unit = 'square'
    let lineDescription = ''
    const measurementMissing = grossSquares <= 0 && bundles <= 0

    if (pricingMode === 'per_square') {
      quantity = Math.round(grossSquares * 100) / 100
      unitPrice = Number(settings.invoice_price_per_square) || 350
      unit = 'square'
      lineDescription = measurementMissing
        ? `Roofing — ${order.property_address} (measurement data unavailable — review and update quantity)`
        : `Roofing — ${quantity} squares @ $${unitPrice}/sq — ${order.property_address}`
    } else {
      quantity = Math.round(bundles)
      unitPrice = Number(settings.invoice_price_per_bundle) || 125
      unit = 'bundle'
      lineDescription = measurementMissing
        ? `Roofing — ${order.property_address} (measurement data unavailable — review and update quantity)`
        : `Roofing — ${quantity} bundles @ $${unitPrice}/bundle — ${order.property_address}`
    }

    const subtotal = Math.round(quantity * unitPrice * 100) / 100
    const taxRate = 5.0
    const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100
    const total = Math.round((subtotal + taxAmount) * 100) / 100

    const proposalNumber = genProposalNumber()
    const shareToken = genShareToken()

    const now = new Date()
    const validUntil = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 30))
      .toISOString().slice(0, 10)

    const notes = measurementMissing
      ? `Auto-drafted proposal for ${order.property_address}. Measurement data was unavailable at generation time — please review quantities and pricing before sending.`
      : `Auto-drafted proposal for ${order.property_address}. Review before sending.`

    const recipientName = String(order.invoice_customer_name).trim()
    const recipientEmail = String(order.invoice_customer_email).toLowerCase().trim()
    const recipientPhone = order.invoice_customer_phone ? String(order.invoice_customer_phone).trim() : ''

    const inv = await env.DB.prepare(`
      INSERT INTO invoices (
        invoice_number, customer_id, order_id,
        crm_customer_name, crm_customer_email, crm_customer_phone,
        subtotal, tax_rate, tax_amount, discount_amount, discount_type, total,
        status, due_date, notes, terms, created_by,
        document_type, share_token, share_url, valid_until
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'fixed', ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      proposalNumber, order.customer_id, orderId,
      recipientName, recipientEmail, recipientPhone,
      subtotal, taxRate, taxAmount, total,
      validUntil, notes,
      'This proposal is valid for 30 days from the date of issue.',
      'auto-invoice', 'proposal',
      shareToken, `/proposal/view/${shareToken}`, validUntil
    ).run()

    const invoiceId = Number(inv.meta.last_row_id)

    await env.DB.prepare(`
      INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order, unit, is_taxable, category)
      VALUES (?, ?, ?, ?, ?, 0, ?, 1, 'roofing')
    `).bind(invoiceId, lineDescription, quantity, unitPrice, subtotal, unit).run()

    await logAutoInvoiceStep(env, {
      order_id: orderId, invoice_id: invoiceId,
      step: measurementMissing ? 'quantity_zero_drafted' : 'proposal_drafted',
      reason: `proposal_number=${proposalNumber} total=$${total.toFixed(2)} gross_squares=${grossSquares} bundles=${bundles}`
    })

    return { status: 'created', invoice_id: invoiceId }
  } catch (e: any) {
    await logAutoInvoiceStep(env, {
      order_id: orderId, step: 'error',
      reason: (e?.message || String(e)).slice(0, 500)
    })
    return { status: 'error', reason: e?.message || 'unknown' }
  }
}

/**
 * Cron-mode sweep: find recently-completed reports for orders that are
 * configured for auto-invoice but have no draft yet. Catches races where
 * the inline hook didn't fire (worker was killed, deploy boundary, etc).
 */
export async function sweepAutoInvoices(env: Bindings, lookbackMinutes = 60): Promise<number> {
  const rows = await env.DB.prepare(`
    SELECT r.order_id
    FROM reports r
    JOIN orders o ON o.id = r.order_id
    JOIN customers c ON c.id = o.customer_id
    WHERE r.status = 'completed'
      AND c.auto_invoice_enabled = 1
      AND o.invoice_customer_email IS NOT NULL
      AND o.invoice_customer_email != ''
      AND r.updated_at >= datetime('now', '-' || ? || ' minutes')
      AND NOT EXISTS (
        SELECT 1 FROM invoices i
        WHERE i.order_id = r.order_id AND i.created_by = 'auto-invoice'
      )
    LIMIT 50
  `).bind(lookbackMinutes).all<{ order_id: number }>()

  let created = 0
  for (const row of (rows.results || [])) {
    const res = await createAutoInvoiceForOrder(env, row.order_id)
    if (res.status === 'created') created++
  }
  return created
}
