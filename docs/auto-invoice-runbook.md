# Auto-Invoice / Auto-Proposal Runbook

The auto-invoice feature creates a **DRAFT PROPOSAL** in the Proposal Dashboard
when a report completes, for any roofer who has:

1. Enabled the Auto-Invoice toggle in Certificate Automations, and
2. Provided a homeowner name + email on the order form.

Nothing is emailed automatically. The roofer reviews the draft in the Proposal
Dashboard and sends it from there.

## Product flow

1. Roofer toggles Auto-Invoice ON in `/certificate-automations` (stored in `customers.auto_invoice_enabled`).
2. Roofer places an order via the customer order form, filling the optional homeowner section (name + email + phone). The homeowner contact is persisted on the order (`orders.invoice_customer_{name,email,phone}`).
3. Report generation runs. When `reports.status` transitions to `completed`, the hook in `saveCompletedReport` callers (`src/routes/reports.ts:1752` and `:3093`) calls `createAutoInvoiceForOrder(env, orderId)`.
4. The service creates a row in `invoices` with `document_type='proposal'`, `status='draft'`, `created_by='auto-invoice'`, `invoice_number` prefix `PROP-…`. The proposal appears in the Proposal Dashboard (`/proposal-builder.js` queries `?document_type=proposal`).
5. Every outcome is logged to `invoice_audit_log` with `action='auto_invoice_<step>'`.

A cron fallback in `src/cron-worker.ts` sweeps every 10 minutes for completed reports missing an auto-invoice — catches races where the inline hook didn't fire.

## Verify the pipeline

### Health endpoint

```bash
curl -H "Authorization: Bearer <ADMIN_JWT>" https://www.roofmanager.ca/api/admin/health/auto-invoice
```

Returns:

```json
{
  "gmail_oauth_ready": true,
  "customers_with_automation": 4,
  "last_run": { "action": "auto_invoice_proposal_drafted", "order_id": 123, ... },
  "last_failure": null,
  "last_7d_breakdown": [{ "action": "auto_invoice_proposal_drafted", "n": 9 }, ...]
}
```

### Audit log

```bash
wrangler d1 execute roofing-production --command \
  "SELECT action, order_id, invoice_id, new_value, created_at
   FROM invoice_audit_log
   WHERE action LIKE 'auto_invoice_%'
   ORDER BY created_at DESC LIMIT 20"
```

### Investigation query set (for a specific test order)

```sql
-- Is the roofer's toggle actually on?
SELECT id, email, auto_invoice_enabled, invoice_pricing_mode,
       invoice_price_per_square, invoice_price_per_bundle
FROM customers WHERE email = '<roofer-email>';

-- Did the homeowner contact persist on the order?
SELECT id, order_number, invoice_customer_name, invoice_customer_email,
       invoice_customer_phone, needs_admin_trace, created_at
FROM orders WHERE id = <ORDER_ID>;

-- Did the report complete?
SELECT o.order_number, r.status AS report_status, r.updated_at
FROM orders o LEFT JOIN reports r ON r.order_id = o.id
WHERE o.id = <ORDER_ID>;

-- Was a proposal drafted?
SELECT id, invoice_number, document_type, status, created_by, total, created_at
FROM invoices WHERE order_id = <ORDER_ID>;

-- Audit trail for that order
SELECT action, new_value, created_at
FROM invoice_audit_log WHERE order_id = <ORDER_ID> ORDER BY created_at DESC;
```

## Common failure modes (and what the audit log will show)

| Audit action | Meaning | Fix |
|---|---|---|
| `auto_invoice_skipped_not_enabled` | Roofer's `auto_invoice_enabled=0` | Toggle it on in Certificate Automations |
| `auto_invoice_skipped_no_recipient` | Order has no `invoice_customer_email` | Roofer didn't fill the homeowner section on the order form |
| `auto_invoice_skipped_no_report` | Hook fired before report reached `completed` | Usually transient — the cron sweep catches it within 10 min |
| `auto_invoice_skipped_already_exists` | Idempotency: proposal already drafted | No action — this is expected on retries |
| `auto_invoice_quantity_zero_drafted` | Report completed but no usable measurement data | Draft still created with a "review" note; roofer fixes quantity |
| `auto_invoice_proposal_drafted` | Success | — |
| `auto_invoice_error` | Unexpected exception | Read `new_value` for the message |

## Gmail OAuth (only matters if/when the roofer clicks Send on a proposal)

The automation itself never sends email. Sending is done from the Proposal UI.
If send fails, check the three secrets are set on Cloudflare Pages:

```bash
npx wrangler pages secret list --project-name roofing-measurement-tool
# Expect: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
```

If missing, run the one-time consent flow at `/api/auth/gmail` and set the three secrets via `wrangler pages secret put`.

## Files that implement this feature

- `migrations/0154_invoicing_automation.sql` — roofer toggle + pricing columns
- `migrations/0157_invoice_audit_log.sql` — audit table
- `migrations/0159_invoice_audit_log_order_id.sql` — adds `order_id` column + homeowner contact columns on `orders`
- `src/services/auto-invoice.ts` — `createAutoInvoiceForOrder`, `sweepAutoInvoices`
- `src/services/auto-invoice-audit.ts` — `logAutoInvoiceStep`
- `src/routes/square.ts` — persists homeowner contact on order, writes audit entry
- `src/routes/reports.ts` — fires the hook after `saveCompletedReport`
- `src/cron-worker.ts` — sweep fallback every 10 minutes
- `src/routes/admin.ts` — `GET /api/admin/health/auto-invoice`
- `public/static/customer-order.js` — always-visible homeowner fields + toggle badge + inline validation
