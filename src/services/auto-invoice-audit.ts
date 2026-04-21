import type { Bindings } from '../types'

export type AutoInvoiceStep =
  | 'entered'
  | 'skipped_not_enabled'
  | 'skipped_no_recipient'
  | 'skipped_no_report'
  | 'skipped_already_exists'
  | 'quantity_zero_drafted'
  | 'report_timeout'
  | 'invoice_inserted'
  | 'proposal_drafted'
  | 'proposal_emailed'
  | 'proposal_email_skipped'
  | 'email_sent'
  | 'email_failed'
  | 'gmail_not_configured'
  | 'error'

export interface AutoInvoiceAuditInput {
  order_id: number | null
  step: AutoInvoiceStep
  reason?: string
  invoice_id?: number | null
  old_value?: string
  new_value?: string
}

export async function logAutoInvoiceStep(env: Bindings, input: AutoInvoiceAuditInput) {
  try {
    await env.DB.prepare(`
      INSERT INTO invoice_audit_log (invoice_id, order_id, action, old_value, new_value, changed_by, created_at)
      VALUES (?, ?, ?, ?, ?, 'auto-invoice', datetime('now'))
    `).bind(
      input.invoice_id ?? 0,
      input.order_id ?? null,
      'auto_invoice_' + input.step,
      input.old_value ?? '',
      input.reason || input.new_value || ''
    ).run()
  } catch (e: any) {
    console.warn('[auto-invoice-audit] failed to write audit row:', e?.message || e)
  }
}
