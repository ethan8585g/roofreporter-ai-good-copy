import type { Bindings } from '../types'
import { logAutoInvoiceStep } from './auto-invoice-audit'
import { sendGmailOAuth2, loadGmailCreds } from './email'

function escHtml(s: string): string {
  return String(s || '').replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  )
}

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
 * Produces a PROPOSAL (document_type='proposal'). When Gmail OAuth is
 * configured, the proposal is emailed to the homeowner immediately and
 * status is set to 'sent'. If email fails or Gmail isn't configured, the
 * proposal is left as 'draft' so the roofer can send it manually from the
 * Proposal Dashboard.
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

    // Prod schema stores measurements on direct columns (gross_squares, bundle_count)
    // and the full JSON in api_response_raw. There is no report_data column.
    const report = await env.DB.prepare(
      `SELECT status, gross_squares, bundle_count, api_response_raw
       FROM reports WHERE order_id = ?`
    ).bind(orderId).first<any>()
    if (!report || report.status !== 'completed') {
      await logAutoInvoiceStep(env, {
        order_id: orderId, step: 'skipped_no_report',
        reason: `report.status=${report?.status || 'missing'}`
      })
      return { status: 'skipped', reason: 'report_not_completed' }
    }

    // Direct columns first (the normal case). Fall back to parsing the raw JSON
    // blob if direct columns are null/zero — keeps us resilient to upstream drift
    // and to older reports that may pre-date the direct-column write path.
    let reportData: any = {}
    try { reportData = JSON.parse(report.api_response_raw || '{}') } catch { /* empty */ }

    const directGross = Number(report.gross_squares) || 0
    const directBundles = Number(report.bundle_count) || 0

    const grossSquares = directGross > 0 ? directGross : pickNumber(reportData, [
      'gross_squares', 'true_area_squares', 'roof_area_squares',
      'materials.gross_squares',
      'measurements.gross_squares', 'measurements.true_area_squares',
      'full_report.measurements.gross_squares',
      'full_report.gross_squares',
      'bom.gross_squares'
    ])
    const bundles = directBundles > 0 ? directBundles : pickNumber(reportData, [
      'bundle_count', 'total_bundles', 'bom_total_bundles',
      'materials.bundle_count',
      'measurements.total_bundles', 'bom.total_bundles',
      'full_report.bom.total_bundles', 'full_report.total_bundles'
    ])

    // Diagnostic: if nothing resolved — direct columns null AND JSON fallback
    // empty — log key shape so ops can diagnose from Cloudflare tail.
    if (grossSquares <= 0 && bundles <= 0) {
      const topKeys = reportData && typeof reportData === 'object' ? Object.keys(reportData) : []
      const measKeys = reportData?.measurements && typeof reportData.measurements === 'object'
        ? Object.keys(reportData.measurements) : []
      const materialsKeys = reportData?.materials && typeof reportData.materials === 'object'
        ? Object.keys(reportData.materials) : []
      console.warn(
        `[auto-invoice] no squares/bundles resolved for order ${orderId}; ` +
        `direct_gross=${report.gross_squares} direct_bundles=${report.bundle_count} ` +
        `top_keys=${JSON.stringify(topKeys)} ` +
        `measurements_keys=${JSON.stringify(measKeys)} ` +
        `materials_keys=${JSON.stringify(materialsKeys)}`
      )
    }

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

    // Auto-send the proposal email to the homeowner. Prefers the roofer's
    // connected Gmail (customers.gmail_refresh_token) so the homeowner sees
    // it coming from the actual contractor. Falls back to the platform
    // GMAIL_REFRESH_TOKEN env var. If neither is available, the proposal
    // remains in 'draft' and the roofer can retry from the dashboard.
    let emailSent = false
    let emailError = ''
    // Use loadGmailCreds() so the platform fallback also reads the D1
    // gmail_refresh_token setting when GMAIL_REFRESH_TOKEN env var is absent.
    // Without the D1 fallback, auto-proposals to homeowners silently failed
    // when only the env client_id/client_secret were configured.
    const platformCreds = await loadGmailCreds(env as any)
    const clientId = platformCreds.clientId || (env as any).GMAIL_CLIENT_ID
    const clientSecret = platformCreds.clientSecret || (env as any).GMAIL_CLIENT_SECRET
    const platformRefresh = platformCreds.refreshToken || ''
    const platformSender = platformCreds.senderEmail || (env as any).GMAIL_SENDER_EMAIL

    // Per-customer Gmail (populated when the roofer connected their account
    // via Settings → Gmail integration).
    const roofer = await env.DB.prepare(
      `SELECT gmail_refresh_token, gmail_connected_email FROM customers WHERE id = ?`
    ).bind(order.customer_id).first<{ gmail_refresh_token: string | null, gmail_connected_email: string | null }>()

    const useCustomerGmail = !!(roofer?.gmail_refresh_token && clientId && clientSecret)
    const refreshToken = useCustomerGmail ? roofer!.gmail_refresh_token! : platformRefresh
    const senderEmail = useCustomerGmail ? roofer!.gmail_connected_email : platformSender
    const gmailSource = useCustomerGmail ? 'customer' : (platformRefresh ? 'platform' : 'none')

    if (!clientId || !clientSecret || !refreshToken) {
      emailError = 'gmail_not_configured'
    } else if (measurementMissing) {
      emailError = 'measurement_missing_skipped_send'
    } else {
      try {
        const origin = (env as any).PUBLIC_ORIGIN || 'https://www.roofmanager.ca'
        const viewUrl = `${origin}/proposal/view/${shareToken}`
        const itemsHtml = `<table style="width:100%;border-collapse:collapse;margin:16px 0"><thead><tr style="background:#f8fafc"><th style="text-align:left;padding:8px;border-bottom:2px solid #e2e8f0;font-size:13px;color:#64748b">Item</th><th style="text-align:center;padding:8px;border-bottom:2px solid #e2e8f0;font-size:13px;color:#64748b">Qty</th><th style="text-align:right;padding:8px;border-bottom:2px solid #e2e8f0;font-size:13px;color:#64748b">Amount</th></tr></thead><tbody><tr><td style="padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px">${escHtml(lineDescription)}</td><td style="text-align:center;padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px">${quantity}</td><td style="text-align:right;padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:600">$${subtotal.toFixed(2)}</td></tr></tbody></table>`
        const emailHtml = `
<div style="max-width:600px;margin:0 auto;font-family:Inter,system-ui,sans-serif">
  <div style="background:linear-gradient(135deg,#0ea5e9,#2563eb);padding:32px;border-radius:16px 16px 0 0;text-align:center">
    <h1 style="color:white;font-size:22px;margin:0">Roof Manager</h1>
    <p style="color:#bfdbfe;font-size:13px;margin:4px 0 0">Professional Roof Measurement Reports</p>
  </div>
  <div style="background:white;padding:32px;border:1px solid #e2e8f0;border-top:none">
    <h2 style="color:#1e293b;font-size:18px;margin:0 0 8px">Proposal ${escHtml(proposalNumber)}</h2>
    <p style="color:#64748b;font-size:14px;margin:0 0 24px">Hi ${escHtml(recipientName)},</p>
    <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 16px">Please find your proposal below. Click the link to view it online and accept.</p>
    ${itemsHtml}
    <div style="background:#f8fafc;border-radius:12px;padding:16px;margin:16px 0">
      <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:800;color:#0f172a"><span>Total</span><span>$${total.toFixed(2)} CAD</span></div>
    </div>
    <div style="text-align:center;margin:24px 0"><a href="${viewUrl}" style="display:inline-block;background:#0ea5e9;color:white;padding:14px 32px;border-radius:12px;text-decoration:none;font-size:16px;font-weight:700">View Proposal</a></div>
    <p style="color:#64748b;font-size:12px;text-align:center">Valid until: ${validUntil}</p>
  </div>
  <div style="background:#f8fafc;padding:16px;border-radius:0 0 16px 16px;text-align:center;border:1px solid #e2e8f0;border-top:none">
    <p style="color:#94a3b8;font-size:11px;margin:0">Powered by Roof Manager — Canada's AI Roof Measurement Platform</p>
  </div>
</div>`
        await sendGmailOAuth2(
          clientId, clientSecret, refreshToken,
          recipientEmail,
          `Proposal ${proposalNumber} — $${total.toFixed(2)}`,
          emailHtml,
          senderEmail
        )
        emailSent = true
      } catch (e: any) {
        emailError = (e?.message || String(e)).slice(0, 500)
        console.error('[auto-invoice] Gmail send failed:', emailError)
      }
    }

    if (emailSent) {
      await env.DB.prepare(
        `UPDATE invoices SET status = 'sent', sent_date = date('now'), updated_at = datetime('now') WHERE id = ?`
      ).bind(invoiceId).run()
      await logAutoInvoiceStep(env, {
        order_id: orderId, invoice_id: invoiceId, step: 'proposal_emailed',
        reason: `sent to ${recipientEmail} via ${gmailSource}-gmail${senderEmail ? ' as ' + senderEmail : ''}`
      })
    } else {
      await logAutoInvoiceStep(env, {
        order_id: orderId, invoice_id: invoiceId, step: 'proposal_email_skipped',
        reason: `${emailError} (gmail_source=${gmailSource})`
      })
    }

    return { status: 'created', invoice_id: invoiceId }
  } catch (e: any) {
    await logAutoInvoiceStep(env, {
      order_id: orderId, step: 'error',
      reason: (e?.message || String(e)).slice(0, 500)
    })
    return { status: 'error', reason: e?.message || 'unknown' }
  }
}

