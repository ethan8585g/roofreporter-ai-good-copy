# Invoicing Automation — Deep Debug & Fix Prompt

> **Paste this entire file into Claude Code in the `roofreporter-ai-good-copy` repo.** It contains the full bug analysis, confirmed root causes (with file paths + line numbers), and a step-by-step fix plan. Do **not** guess — read each referenced file before editing.

---

## Symptoms the user saw

1. Turned on the **Auto-Invoice** toggle in Certificate Automations (Roof Manager admin/roofer portal) and set pricing.
2. Placed a report order via the customer order form, filled in the optional homeowner name + email + phone section ("Invoicing Automation Customer Details").
3. **Result:** Nothing appeared in the **Proposal Dashboard**. The homeowner never received an email.

Conclusion: the automation is **not firing end-to-end**, *and* even when the underlying DB insert succeeds it ends up in the wrong dashboard.

---

## Where the flow actually lives (map before you touch anything)

Read these in order; do not skim:

| # | File | Purpose |
|---|------|---------|
| 1 | `migrations/0154_invoicing_automation.sql` | Adds `auto_invoice_enabled`, `invoice_pricing_mode`, `invoice_price_per_square`, `invoice_price_per_bundle` to `customers`. |
| 2 | `migrations/0143_deprecate_legacy_proposal_tables.sql` | Canonical doc table = `invoices` with `document_type IN ('invoice','proposal','estimate')`. `crm_proposals` / `crm_invoices` have ABORT triggers on INSERT. |
| 3 | `migrations/0157_invoice_audit_log.sql` | `invoice_audit_log` table exists — we should be writing to it but currently aren't for auto-invoices. |
| 4 | `src/routes/crm.ts` ~L735–765 | `GET/PATCH /api/crm/invoicing-automation/settings` — reads/writes the 4 toggle fields on `customers`. |
| 5 | `public/static/certificate-automations.js` ~L37–228, L800–870 | UI for the Auto-Invoice toggle + pricing mode. |
| 6 | `public/static/customer-order.js` ~L43–48, L96–103, L516–555, L1796–1823, L1946–1952 | Customer order form. Loads `invoicingAutoEnabled`, conditionally renders homeowner name/phone/email inputs, sends payload to `/api/square/use-credit`. |
| 7 | `src/routes/square.ts` ~L400–773 | `POST /api/square/use-credit` — creates the order, polls for report completion, then creates the auto-invoice + emails it. **This is where the automation actually fires.** |
| 8 | `src/services/email.ts` ~L294–382 | `sendGmailOAuth2()` — the sender used by the auto-invoice block. Requires `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` secrets. |
| 9 | `src/routes/invoices.ts` ~L137–208 | `GET /api/invoices` — the list endpoint the dashboards query. Filter: `document_type=proposal` ➜ only rows with `document_type='proposal'`. |
| 10 | `public/static/proposal-builder.js` ~L328–332, L531–533 | **The "Proposal Dashboard" the user is referring to.** It calls `GET /api/invoices?document_type=proposal`. |
| 11 | `public/static/invoice-manager.js` ~L73–78 | The Invoice Manager. Default (`/api/invoices`) returns only `document_type='invoice'` or NULL. |
| 12 | `public/static/admin.js` ~L48–53 | Admin view — queries invoices, proposals, and estimates separately. |

---

## Root causes — confirmed by reading the code

### RC-1 (the big one): Wrong `document_type` → Proposal Dashboard is blind to auto-invoices

`src/routes/square.ts:686–703` — the auto-invoice block inserts with `document_type='invoice'`:

```ts
INSERT INTO invoices (..., document_type, share_token, share_url)
VALUES (..., ?, ?, ?)
// bound values: ... 'invoice', shareToken, `/proposal/view/${shareToken}`
```

`public/static/proposal-builder.js:330` queries:
```js
fetch('/api/invoices?document_type=proposal', ...)
```

`src/routes/invoices.ts:170–171` then filters SQL with:
```sql
AND i.document_type = 'proposal'
```

So the row **exists** in the DB but is filtered out of the Proposal Dashboard. It would only appear in Invoice Manager. The UI even hints at this confusion — the `share_url` is `/proposal/view/…` while `document_type` is `'invoice'`.

**Decision to make before editing:** what is the product intent?
- If the automation is supposed to generate a **proposal** (quote the roofer sends to the homeowner), `document_type` must be `'proposal'` and the subject line / email copy should say "Proposal" not "Invoice".
- If it really is meant to be an **invoice** (after work is done), the Proposal Dashboard is the wrong place to look and the user needs guidance — plus the Invoice Manager UI should surface it clearly.

Based on the toggle copy in `certificate-automations.js:816` ("When enabled, invoices are sent automatically after each report you order"), the product intent is an **invoice**. But the user calls it the "proposal dashboard" because that's where they looked. **Recommendation:** keep `document_type='invoice'`, but also:
- Add a visible "Auto-invoices" tab/section in the Proposal/Invoice module that queries `document_type='invoice' AND created_by='auto-invoice'`, so there is an obvious place for it to show up.
- OR flip the default to `document_type='proposal'` (a draft quote the roofer reviews before sending) — this is actually safer legally, because auto-billing a homeowner $X before the roofer confirms is risky.

**Default the fix to: create as a DRAFT PROPOSAL with `document_type='proposal'` and `status='draft'` so the roofer reviews → approves → sends. Only send the email once the roofer hits "Send".** This is the safer product behavior and will make the item show up in the Proposal Dashboard immediately. Confirm with the user before changing the subject line / email copy.

### RC-2: 120s poll times out for `needs_admin_trace=1` orders and for any slow report

`src/routes/square.ts:624–636`:

```ts
for (let i = 0; i < 24; i++) {
  await new Promise(r => setTimeout(r, 5000))
  report = await c.env.DB.prepare(
    "SELECT * FROM reports WHERE order_id = ? AND status = 'completed'"
  ).bind(newOrderId).first<any>()
  if (report) break
}
if (!report) {
  console.warn(`[Auto-Invoice] Report not ready after 120s for order ${newOrderId} — skipping`)
  return
}
```

Problems:
- If the order has `needs_admin_trace=1` (L574–589), the report stays `status='pending'` until a human traces it — **forever**. The poll times out; the invoice is never created.
- Cloudflare Workers `waitUntil` gives you roughly 30 s of background work. 24 × 5 s = 120 s wall-clock — this will very likely be killed early in production, silently, with no DB trace.
- `setTimeout` in CF Workers counts against CPU time, not just wall time. This is a deeply fragile design.

**Fix:** replace polling with an **event-driven trigger**. The auto-invoice should fire when the report transitions to `completed`, not from inside the same request. Two acceptable approaches:

  **(A) Inline hook in the report completion code.** Find every place that writes `UPDATE reports SET status='completed'` (grep: `status\s*=\s*['\"]completed['\"]` on `reports`), and after the update call a new helper `maybeCreateAutoInvoice(env, orderId)`. This helper re-reads the order + customer settings and does the insert. Idempotent: check `SELECT 1 FROM invoices WHERE order_id = ? AND created_by = 'auto-invoice'` before inserting.

  **(B) Scheduled task / cron.** Add a cron worker that polls every 60 s for `reports.status='completed'` where no auto-invoice exists and `customers.auto_invoice_enabled=1` and the order has pending homeowner contact. `wrangler-cron.jsonc` already exists — use it.

**Recommendation: do (A).** Simpler, immediate, and keeps the logic co-located with the existing report-generation success path.

### RC-3: Silent failures — no audit row, no UI feedback, no retry

Every failure branch in `square.ts:610–773` is a `console.warn`. The user sees "Order placed!" and has no idea the invoice step failed.

**Fix:**
- Add a `INSERT INTO invoice_audit_log(...)` row at each decision point: `skipped_not_enabled`, `skipped_no_measurement`, `skipped_no_report`, `created`, `email_failed`, `email_sent`. Use `action`, `old_value`, `new_value` per migration 0157. Use a special sentinel `invoice_id=-1` (or add a nullable `order_id` column via a new migration) when the invoice itself wasn't created — otherwise you can't write audit rows for the "never created" cases.
- Surface the most recent auto-invoice status in the order detail view and on the order-success confirmation page.
- Add a `GET /api/orders/:id/auto-invoice-status` that returns `{ state: 'pending'|'created'|'emailed'|'failed'|'skipped', reason, invoice_id }` so the UI can poll.

### RC-4: The homeowner input fields are gated on `invoicingAutoEnabled` at *initial page load*

`public/static/customer-order.js:96–103, 519`:

```js
const invRes = await fetch('/api/crm/invoicing-automation/settings', ...);
orderState.invoicingAutoEnabled = !!invData.auto_invoice_enabled;
...
${orderState.invoicingAutoEnabled ? `<div>...Customer Full Name...</div>` : ''}
```

If the `GET /api/crm/invoicing-automation/settings` call fails (network, auth, 404), or the user turned on automation in a different tab *after* this tab loaded, the homeowner name/email/phone fields never render. The user thinks they "filled out the customer form" but the inputs they filled may have been the property/order fields — not the invoicing section. Then the payload omits `invoice_customer_name` + `invoice_customer_email`, and `square.ts:610` skips the entire auto-invoice block.

**Fix:**
- **Always render** the homeowner customer section if the user is logged in as a roofer. Remove the `invoicingAutoEnabled` gate on rendering — keep it only for the decision of "should we auto-send an invoice after the report completes".
- Add a visible badge on the section: "Auto-Invoice ENABLED — a draft proposal will be created" / "Auto-Invoice OFF — enable in Certificate Automations to send automatically".
- On the server (`square.ts:610`) log **explicitly** when the block is skipped and why. Never silently drop.
- Add client-side validation: if automation is enabled but homeowner email is blank, show an inline warning "Auto-invoice won't send — homeowner email required".

### RC-5: No invoice created when `grossSquares` and `bundles` are both 0

`src/routes/square.ts:659–662`:

```ts
if (quantity <= 0) {
  console.warn(`[Auto-Invoice] No measurable quantity for order ${newOrderId} — skipping`)
  return
}
```

If the report completes but `report_data` is missing `gross_squares` and `total_bundles` (parsing failure, old schema, or the engine output landed in a different field name), the invoice silently doesn't get created.

**Fix:**
- Expand the field lookup: try `gross_squares`, `true_area_squares`, `roofArea_squares`, `measurements.gross_squares`, `full_report.measurements.gross_squares`. Log which field resolved.
- If still zero, create a **draft proposal with quantity=0 and a note** "Measurement data missing — please review" so the roofer at least sees it in the dashboard.

### RC-6: Gmail OAuth secrets may not be configured in production

`src/routes/square.ts:715–721`:

```ts
const clientId = (c.env as any).GMAIL_CLIENT_ID
const clientSecret = (c.env as any).GMAIL_CLIENT_SECRET
const refreshToken = (c.env as any).GMAIL_REFRESH_TOKEN
if (!clientId || !clientSecret || !refreshToken) {
  console.warn(`[Auto-Invoice] Invoice ${invoiceNumber} created (id=${invoiceId}) but Gmail OAuth not configured — email NOT sent`)
  return
}
```

If any of the three secrets is missing in the Cloudflare Pages environment, the invoice is created but no email goes out. `wrangler.jsonc` currently shows no `vars` for these — they must be set as secrets.

**Fix (user-side, not code):**
- Run (locally or in Cloudflare dashboard):
  ```bash
  npx wrangler pages secret list --project-name=<prod-project-name>
  ```
- Confirm `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` are present. If not, run the one-time consent flow at `/api/auth/gmail` and `wrangler pages secret put` each one.
- Add a **server-side health check endpoint** `GET /api/admin/health/auto-invoice` that returns `{ gmail_oauth_ready, customer_with_automation_count, last_auto_invoice_at, last_failure_reason }` so the user can verify the pipeline is wired.

### RC-7: Dashboard query semantics and legacy rows

`src/routes/invoices.ts:170` treats `document_type=invoice` as "invoice OR NULL" (for back-compat), but `document_type=proposal` is strict equality. If anything historically landed as NULL but was conceptually a proposal, it won't show. Less likely the issue here, but note it while you're in the file.

---

## Fix plan (execute in this order)

**Do not batch all of this into one commit.** Each step should be a small, reviewable change with a focused commit message.

### Step 1 — Add visibility first (no behaviour change)
1. Add a helper `logAutoInvoiceStep(env, { order_id, step, reason })` that writes to `invoice_audit_log`. If the existing schema requires `invoice_id NOT NULL`, add migration `0158_invoice_audit_log_nullable_invoice.sql` making it nullable and adding an `order_id` column. Otherwise use `invoice_id=0` as a sentinel and document it.
2. Add calls to that helper at every decision point in `src/routes/square.ts:610–773`: entered, auto_invoice_disabled, report_timeout, quantity_zero, invoice_inserted, email_sent, email_failed, gmail_not_configured.
3. Build `GET /api/admin/health/auto-invoice` in `src/routes/admin.ts` that returns the health summary described in RC-6.
4. Deploy. Ask the user to place another test order. The audit log will tell you exactly which branch is hit in production.

### Step 2 — Fix the Proposal Dashboard visibility issue (RC-1)
Decision required from the user before coding. Default path: make auto-invoice create a **draft proposal**, not a sent invoice.
1. In `src/routes/square.ts:693–703`, change:
   - `document_type` bind value from `'invoice'` to `'proposal'`.
   - `status` from `'sent'` to `'draft'`.
   - `invoice_number` prefix from `INV-` to `PROP-` (`src/routes/square.ts:676`).
2. Do **not** auto-send the email in this path. Instead, set a flag `auto_send_on_approve=1` (new column or `notes` JSON) so when the roofer clicks "Send" in the proposal UI, it picks up the homeowner contact from `crm_customer_email` and sends.
3. Update the email copy (`src/routes/square.ts:726–751`) to read "Proposal …" not "Invoice …" when sending.
4. Verify `src/routes/invoices.ts:170–171` — proposals now show correctly in `proposal-builder.js`.

### Step 3 — Replace polling with event-driven trigger (RC-2)
1. Extract the auto-invoice creation logic from `square.ts` into `src/services/auto-invoice.ts` with signature:
   ```ts
   export async function createAutoInvoiceForOrder(env: Bindings, orderId: number): Promise<{ status: 'created' | 'skipped'; reason?: string; invoice_id?: number }>
   ```
   Implement it idempotently — if an auto-invoice already exists for this order, return `{ status: 'skipped', reason: 'already_exists' }`.
2. Grep for all code paths that set `reports.status = 'completed'`:
   ```
   rg "status\s*=\s*['\"]completed['\"]" src/services/report-engine.ts src/routes/reports.ts src/routes/ai-autopilot.ts src/services/ai-agent.ts
   ```
3. After every such update, invoke `createAutoInvoiceForOrder(env, orderId)` via `executionCtx.waitUntil()`.
4. Delete the 120-second poll in `square.ts:624–636`. The new code path doesn't need it.
5. Add a cron fallback in `wrangler-cron.jsonc`: every 5 minutes, sweep `reports.status='completed'` from the last hour that have no auto-invoice and retry. Catches any races.

### Step 4 — Fix the UI gating (RC-4)
1. In `public/static/customer-order.js:519`, remove the `${orderState.invoicingAutoEnabled ? ... : ''}` wrapper. Always render the homeowner customer section when the user is logged in.
2. Above the section, add a badge that reads `orderState.invoicingAutoEnabled ? 'Auto-proposal enabled — draft will appear in Proposal Dashboard' : 'Auto-proposal off — enable in Certificate Automations'`.
3. In `buildOrderPayload()` (L1796–1823), always send the fields if present — don't condition on both name AND email existing. Let the server decide.
4. Add inline validation: submit is blocked with a toast "Homeowner email required for auto-proposal" if the toggle is on but email is blank.

### Step 5 — Widen measurement field lookup (RC-5)
In `src/routes/square.ts:641–642`, replace:
```ts
const grossSquares = reportData.gross_squares || reportData.true_area_squares || 0
const bundles = reportData.total_bundles || reportData.bom_total_bundles || 0
```
with:
```ts
function pickFirst(obj: any, paths: string[]) { for (const p of paths) { const v = p.split('.').reduce((o, k) => o?.[k], obj); if (typeof v === 'number' && v > 0) return v; } return 0 }
const grossSquares = pickFirst(reportData, [
  'gross_squares','true_area_squares',
  'measurements.gross_squares','measurements.true_area_squares',
  'full_report.measurements.gross_squares'
])
const bundles = pickFirst(reportData, [
  'total_bundles','bom_total_bundles',
  'measurements.total_bundles','bom.total_bundles','full_report.bom.total_bundles'
])
```
If still zero, create the draft proposal with a `notes` flag and a "Measurement data unavailable — review and fill in quantity" line item.

### Step 6 — Tests
Add tests in `src/routes/proposals.unified.test.ts` (or a new `src/services/auto-invoice.test.ts`):
1. Report completes → creates draft proposal with `document_type='proposal'` and `status='draft'`.
2. `auto_invoice_enabled=0` → no proposal created, audit row `skipped_not_enabled`.
3. Homeowner email missing → audit row `skipped_no_recipient`.
4. Measurement data empty → creates draft with note, quantity=0 or best-effort.
5. Idempotency — calling twice creates only one proposal.
6. `needs_admin_trace=1` path — admin completes the trace later → proposal created at that moment (simulate the completion hook).

### Step 7 — Runbook for the user
Document in `docs/auto-invoice-runbook.md`:
- How to verify Gmail OAuth is configured (call `GET /api/auth/gmail/status`).
- How to check `/api/admin/health/auto-invoice`.
- How to query the audit log manually: `npm run db:console:local` then `SELECT * FROM invoice_audit_log WHERE action LIKE 'auto%' ORDER BY created_at DESC LIMIT 20`.

---

## Investigation queries to run BEFORE coding

Run these against prod (via the D1 dashboard or `wrangler d1 execute roofing-production --command "…"`):

```sql
-- Is the customer's toggle actually on?
SELECT id, email, auto_invoice_enabled, invoice_pricing_mode,
       invoice_price_per_square, invoice_price_per_bundle
FROM customers
WHERE email = 'ethan@…';  -- replace with the account used for testing

-- The most recent order from that customer
SELECT id, order_number, status, payment_status, needs_admin_trace,
       created_at
FROM orders
WHERE customer_id = <ID_FROM_ABOVE>
ORDER BY created_at DESC LIMIT 5;

-- Did the report actually complete?
SELECT o.order_number, r.status AS report_status, r.updated_at
FROM orders o LEFT JOIN reports r ON r.order_id = o.id
WHERE o.id = <ORDER_ID>;

-- Was an invoice ever created for it?
SELECT id, invoice_number, document_type, status, customer_id,
       crm_customer_email, created_by, created_at
FROM invoices
WHERE order_id = <ORDER_ID>;

-- Any audit rows?
SELECT * FROM invoice_audit_log ORDER BY created_at DESC LIMIT 20;
```

Paste the results into the Claude Code chat so it has real data before editing.

---

## Acceptance criteria (what "fixed" means)

- [ ] Placing a test order with the Auto-Invoice toggle ON and homeowner email filled results in a **draft proposal** appearing in the Proposal Dashboard within ~30 seconds of the report completing (or within 5 minutes via the cron fallback).
- [ ] If `needs_admin_trace=1`, the proposal is created when the admin finishes the trace — not before.
- [ ] An `invoice_audit_log` row exists for every outcome: created, skipped (with reason), failed.
- [ ] Toggling Auto-Invoice OFF means no proposal is created; the audit row shows `skipped_not_enabled`.
- [ ] Homeowner customer fields render on the order form whether or not the automation toggle is on.
- [ ] `GET /api/admin/health/auto-invoice` returns honest status for Gmail OAuth + recent runs.
- [ ] Unit tests in Step 6 all pass.
- [ ] The homeowner actually receives the email **only when the roofer hits "Send" in the proposal UI** — the automation creates the draft, it does not send unsolicited emails.

---

## Don't do this (traps)

- Don't keep the 120-second inline poll. It will be killed by Cloudflare before it finishes most of the time.
- Don't write directly to `crm_proposals` — migration 0143 has an ABORT trigger that blocks inserts.
- Don't change `document_type` on existing rows in prod without a migration. Any historical auto-invoices are `document_type='invoice'` — leave them alone, or write a one-shot migration that relabels only `created_by='auto-invoice'` rows, and back up first.
- Don't send customer emails on every report completion automatically without the roofer's click — that's a spam and liability risk.
