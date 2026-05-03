# Auto-Send Customer Proposal On Report Complete — Engineered Execution Prompt

> Paste this entire file as the first message in a fresh Claude Code session at the repo root (`roofreporter-ai-good-copy/`). Do NOT skip the "Current state findings" section — that section contains ground-truth file:line references that prevent you from re-discovering what is already built. Read every line before proposing changes.

---

## 1. The feature, in one paragraph

When a roofer orders a measurement report and (a) has **proposal automation enabled** on their account AND (b) **filled in the homeowner contact form** on the order (name + email + optional phone), the system must, as soon as the report transitions to `status='completed'`, automatically (1) generate a customer-facing proposal seeded from the report's material calculations and the roofer's pricing settings, and (2) email that proposal to the homeowner via the roofer's Gmail OAuth identity. No manual button press. No "go to the dashboard and send." End-to-end, hands-off.

This capability has been partially built. **Most of the code already exists.** Your job is to verify, fix the last-mile gaps, and make the entire path observable and testable. You are NOT greenfielding this feature — you are finishing and hardening it.

---

## 2. Non-negotiable ground rules

1. **Do not rewrite working code.** `src/services/auto-invoice.ts` is production-tested. Extend it; don't replace it.
2. **Idempotency is sacred.** The same order must never produce two proposals. The existing `created_by='auto-invoice'` guard at `auto-invoice.ts:65-74` is the canonical check — preserve it.
3. **Silent failures are the enemy.** Every failure mode must land a row in `invoice_audit_log` via `logAutoInvoiceStep()`. Do not add `catch {}` blocks without a log write.
4. **All async work on a completion path must be wrapped in `executionCtx.waitUntil()`.** Cloudflare Workers kill the isolate the moment the HTTP response returns — any un-awaited Promise is dead.
5. **No destructive migrations.** If you need a new column, `ALTER TABLE ... ADD COLUMN` with a safe default. Append a new numbered migration — do not edit existing ones.
6. **Do not change the proposal's `document_type='proposal'` identity.** Downstream routes (`/proposal/view/:token`, Proposal Dashboard, commission calc) read this field.
7. **Run `npx vitest run` before you report done.** Specifically `src/services/auto-invoice.test.ts` must pass and be expanded, not replaced.

---

## 3. Current state findings — read before touching anything

These are verified against the codebase as of this prompt. Line numbers are exact.

### 3.1 The happy-path pipeline that ALREADY exists

1. **Order creation** — `src/routes/square.ts:470-553`, handler for `POST /api/square/use-credit`
   - Accepts optional `invoice_customer_name` / `invoice_customer_email` / `invoice_customer_phone` in the JSON body (line 473).
   - Normalizes and validates them (lines 515-518).
   - Persists them to `orders.invoice_customer_name` / `.invoice_customer_email` / `.invoice_customer_phone` columns in the INSERT at line 531.
   - Fires `notifyNewReportRequest()` to `sales@roofmanager.ca` at line 550. This does NOT email the customer — don't confuse it with the proposal send.

2. **Order form UI** — `public/static/customer-order.js`
   - State fields: `invoiceCustomerName` / `invoiceCustomerEmail` / `invoiceCustomerPhone` (lines 45-47).
   - Rendered inputs: lines 518-557 inside the "Homeowner Details for Auto-Proposal" card.
   - Payload assembly: `buildOrderPayload()` at lines 1797-1825 — the three fields are attached to the POST body if present.
   - **Validation already present** at lines 1949-1953 blocks order submit if name is filled but email is missing or malformed.

3. **Report generation** — `src/routes/reports.ts`
   - Main entry: `generateReportForOrder()` at line 2571; inner impl at `_generateReportForOrderInner` from line 2601.
   - Completion write + auto-invoice hook: lines 3101-3112. The hook is wrapped in `ctx.waitUntil()` correctly here.
   - **Secondary hook** at line 1761 in the inline-enhancement path — **NOT wrapped in waitUntil** (just a bare `.catch()`). This is a known silent-drop risk.

4. **Auto-invoice service** — `src/services/auto-invoice.ts`
   - `createAutoInvoiceForOrder(env, orderId)` at line 57.
   - Idempotency check: lines 64-74.
   - Order fetch: lines 76-84.
   - **Recipient gate (line 87):** skips with reason `no_recipient` if `invoice_customer_name` is falsy OR `invoice_customer_email` fails regex.
   - **Settings gate (line 101):** skips with reason `automation_disabled` if `customers.auto_invoice_enabled != 1`.
   - **Report gate (line 112):** skips with reason `report_not_completed` if `reports.status != 'completed'`.
   - Material extraction from `report_data` JSON: lines 120-151. Reads `gross_squares` / `bundles` from many possible paths — robust to report schema drift.
   - Proposal row INSERT: lines 196-212. Creates `invoices` row with `document_type='proposal'`, `created_by='auto-invoice'`, `status='draft'`, shareable `/proposal/view/:token` URL.
   - Line item INSERT: lines 216-219.
   - **Email send block:** lines 227-290. Calls `sendGmailOAuth2()` at line 264. On success flips invoice `status='sent'` at line 279. On fail, stays `draft`.
   - Exhaustive audit log via `logAutoInvoiceStep()` at every branch.

5. **Cron safety net** — `src/services/auto-invoice.ts:307-335` (`sweepAutoInvoices`) invoked by `src/cron-worker.ts:226` on a `*/10 * * * *` schedule defined in `wrangler-cron.jsonc`. This is a SEPARATE worker deployment.

6. **Email transport** — `src/services/email.ts`, function `sendGmailOAuth2`. Requires env vars `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`. Throws on failure (caller catches).

7. **Migration that introduces the toggle** — `migrations/0154_invoicing_automation.sql` — `ALTER TABLE customers ADD COLUMN auto_invoice_enabled INTEGER DEFAULT 0`.

### 3.2 The actual gaps causing "it still doesn't work at all"

Ranked by likelihood of being the user-visible cause, highest first:

1. **`auto_invoice_enabled` defaults to 0.** Every new customer — including the one who just tested — is opted OUT by default. The gate at `auto-invoice.ts:101` short-circuits before any email logic runs. The audit log row `skipped_not_enabled` is written and nobody sees it.

2. **UI copy contradicts the backend behavior.** `public/static/customer-order.js:529` says literally *"Fill these in so a draft proposal is created for you when the report finishes. You review and send the proposal from the Proposal Dashboard — **nothing is emailed automatically**."* But `auto-invoice.ts:227-290` DOES email automatically when Gmail is configured. Either the user is confused because the UI lied to them, OR the Gmail send isn't reaching them and they've been told not to expect it anyway. Both are bugs.

3. **Gmail OAuth secrets may not be set in Cloudflare.** If `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` are missing in the prod Worker's env, `auto-invoice.ts:234` records `emailError='gmail_not_configured'`, proposal stays `draft`, no mail sent, no user-facing signal. Verify via `wrangler secret list`.

4. **Cron worker may not be deployed.** `wrangler-cron.jsonc` defines a separate Worker. If the team only runs `npm run deploy` (main worker), the cron never fires → `sweepAutoInvoices()` never picks up orders the inline hook missed. Verify in Cloudflare dashboard → Workers.

5. **Inline-enhancement hook at `reports.ts:1761` is not `waitUntil`-wrapped.** If the report completes via the inline enhancement path (not `generateReportForOrder`), the Promise can be killed mid-Gmail-send.

6. **No user-visible confirmation in the UI.** Even when everything works, there is no toast, badge, or Proposal Dashboard indicator that says "proposal auto-sent to homeowner@example.com at 10:42am." The user thinks nothing happened.

7. **Gmail refresh token can silently expire/revoke.** Token health is never reported. A revoked token returns a 400 from Google's endpoint, gets logged, and drops on the floor.

### 3.3 What is explicitly NOT a gap — do not "fix" these

- `src/routes/square.ts:550` — `notifyNewReportRequest()`. That's the internal sales alert. Leave it alone.
- `src/services/email.ts` — already has both Gmail OAuth and Resend fallback logic. No change needed unless you add a second recipient path.
- `src/services/auto-invoice.ts` material extraction logic — handles schema drift across `measurements.*`, `bom.*`, `full_report.*`. Do not simplify.

---

## 4. Acceptance criteria (this is the definition of done)

Copy these into a checklist and verify each one before reporting done.

**Functional:**
- [ ] Given a customer with `auto_invoice_enabled = 1`, who orders a measurement report and fills in homeowner name + email, THEN within 30 seconds of `reports.status` becoming `completed`, an email arrives at the homeowner's inbox containing the proposal total, line item, and a `/proposal/view/:token` link.
- [ ] The same order triggered twice (e.g. manual re-generate) produces exactly one proposal and exactly one email. No duplicates.
- [ ] If the homeowner email is missing, a clear row `skipped_no_recipient` appears in `invoice_audit_log` and NO proposal row is written.
- [ ] If `auto_invoice_enabled = 0`, a row `skipped_not_enabled` appears and no proposal is written.
- [ ] If Gmail send fails, the proposal row persists with `status='draft'`, the audit log records the exact error (truncated to 500 chars), and the Proposal Dashboard shows a "Send failed — retry" affordance.
- [ ] The cron sweeper, on its next run, does NOT re-create a proposal for orders that already have one (idempotency under the sweeper).

**Operational:**
- [ ] `wrangler secret list` on the main Worker shows all of: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`. If any are missing, document which and stop — do not invent values.
- [ ] The cron Worker (`wrangler-cron.jsonc`) is confirmed deployed in the Cloudflare dashboard with an active trigger `*/10 * * * *`.
- [ ] A new health endpoint `GET /api/admin/auto-proposal/health` returns JSON with: gmail_configured (bool), last_successful_send_at (ISO), pending_drafts_count (int), last_10_audit_log_entries (array). Authed to super-admin only.

**UX:**
- [ ] The "Homeowner Details for Auto-Proposal" card's subtitle on the order page is updated to reflect actual behavior: "When the report completes, we draft and email this proposal to the homeowner automatically using your Gmail. You can still edit or revoke it from the Proposal Dashboard before they open it." (Or similar — match the tone of the rest of the form.)
- [ ] When auto-invoice is OFF, the card's warning banner reads: "Auto-Proposal OFF — proposals will be drafted but NOT emailed. Turn on Auto-Proposal in Certificate Automations to auto-email." (Or similar — accurate.)
- [ ] The Proposal Dashboard list shows an `auto-sent` badge on rows where `created_by='auto-invoice' AND status='sent'`, plus the sent timestamp.
- [ ] On the order confirmation screen, if auto-proposal prerequisites were met, show: "Homeowner will receive their proposal at [email] as soon as your report finishes (usually under 60 seconds)."

**Tests:**
- [ ] `src/services/auto-invoice.test.ts` has new cases: (a) successful send with Gmail mock, (b) Gmail failure keeps proposal as draft, (c) second call is a no-op, (d) missing homeowner email is skipped_no_recipient, (e) disabled automation is skipped_not_enabled.
- [ ] `npx vitest run` exits 0 with zero skipped auto-invoice tests.
- [ ] A new integration test `src/routes/proposals.auto-send.e2e.test.ts` exercises the full `generateReportForOrder` → auto-invoice → mock-email path against the in-memory D1.

**Observability:**
- [ ] Every code path in `createAutoInvoiceForOrder()` writes exactly one terminal `invoice_audit_log` step.
- [ ] The audit-log viewer route (check `src/routes/admin.ts` for an existing one, or add `GET /api/admin/auto-proposal/audit?order_id=X`) returns chronologically ordered entries for a given order.

---

## 5. Work plan — execute in this order

### Phase 0 — Investigate, don't code (30 min)

Before writing anything, run these in order and paste the output back as a comment on the PR:

```bash
# 1. Confirm Gmail secrets exist in prod
wrangler secret list

# 2. Confirm cron worker is deployed
wrangler deployments list --config wrangler-cron.jsonc | head -20

# 3. Look for recently-skipped proposals to see which gate is tripping
wrangler d1 execute roofing-production --remote --command "
  SELECT step, reason, COUNT(*) as n
  FROM invoice_audit_log
  WHERE created_at >= datetime('now', '-7 days')
  GROUP BY step, reason
  ORDER BY n DESC;
"

# 4. Confirm schema
wrangler d1 execute roofing-production --remote --command "
  SELECT name FROM sqlite_master WHERE type='table' AND name IN ('invoices','invoice_items','invoice_audit_log','orders','customers');
"

# 5. Confirm at least one customer has auto_invoice_enabled = 1
wrangler d1 execute roofing-production --remote --command "
  SELECT COUNT(*) FILTER (WHERE auto_invoice_enabled = 1) as enabled,
         COUNT(*) as total FROM customers;
"
```

If `auto_invoice_enabled=1` count is 0, the feature has literally never been exercised. Lead with fixing that.

### Phase 1 — Hook hygiene (code)

1. **`src/routes/reports.ts:1761`** — wrap the hook in `waitUntil`. Match the pattern at line 3109-3112:
   ```ts
   ;(c as any).executionCtx?.waitUntil?.(
     createAutoInvoiceForOrder(c.env, Number(orderId)).catch((e) =>
       console.warn('[auto-invoice] hook error:', e?.message))
   )
   ```
2. **Grep for every other `status = 'completed'` write on the `reports` table** (use Grep — I found writes at reports.ts:1795, 2421, 2474, 2619 that are NOT followed by an auto-invoice hook). Decide for each whether it is a "terminal completion" that should fire the hook, or a "staying completed" re-write that should not. Document the decision inline with a comment.

### Phase 2 — Defaults & toggle surface (code + migration)

1. **Add migration `migrations/0170_auto_invoice_default_on.sql`** (or whatever the next number is — run `ls migrations/ | tail -3` first):
   ```sql
   -- Opt-in new customers by default. Existing rows untouched so we don't
   -- surprise anyone who already opted out.
   UPDATE customers SET auto_invoice_enabled = 1
   WHERE auto_invoice_enabled IS NULL;

   -- New customers from here forward default to enabled.
   -- (SQLite can't ALTER COLUMN DEFAULT; the application-level default in
   -- the INSERT path is where we enforce this going forward.)
   ```
2. **Find the customer-creation INSERT paths** — search for `INSERT INTO customers` and ensure each one explicitly sets `auto_invoice_enabled = 1` at creation time. Minimum: `src/routes/customer-auth.ts` register handler, any admin-create-customer handler, and the auto-create on first login at `src/routes/square.ts:206-216` (verify this location).
3. **Admin UI toggle** — confirm there is a Settings → Certificate Automations toggle that writes to `customers.auto_invoice_enabled`. If not, add it. The column already exists; this is a UI wiring task.

### Phase 3 — UI truth-telling (code)

1. **`public/static/customer-order.js:527-529`** — rewrite the banners so they accurately describe what the system does. Per acceptance criteria. Keep the styling.
2. **Order confirmation screen** — after the order POST succeeds, if `invoice_customer_email` was sent AND the logged-in customer's `auto_invoice_enabled=1`, show a line: `Homeowner will receive their proposal at {email} as soon as your report finishes.` The customer's `auto_invoice_enabled` flag is already returned by the auth/me endpoint — verify this or add it.
3. **Proposal Dashboard row** — wherever the Proposal Dashboard renders rows (grep for `document_type='proposal'` in route responses / template strings), add an `auto-sent` badge and sent timestamp for `created_by='auto-invoice' AND status='sent'`.

### Phase 4 — Observability (code)

1. **New route** `GET /api/admin/auto-proposal/health` in `src/routes/admin.ts` (super-admin auth). Returns:
   ```json
   {
     "gmail_configured": true|false,
     "last_successful_send_at": "2026-04-20T15:22:01Z" | null,
     "pending_drafts_count": 3,
     "audit_last_10": [ { order_id, step, reason, created_at }, ... ]
   }
   ```
2. **New route** `GET /api/admin/auto-proposal/audit?order_id=N` — returns full audit trail for one order, chronological.
3. **Counter metrics** — already have audit_log; no new infra. Just expose them.

### Phase 5 — Tests

1. Expand `src/services/auto-invoice.test.ts` with the five cases in acceptance criteria. Mock `sendGmailOAuth2` via a swappable module boundary — the current test file already has an env mock pattern; follow it.
2. New file `src/routes/proposals.auto-send.e2e.test.ts` — exercise full report-complete to proposal-sent path through `generateReportForOrder`. Use the in-memory D1 pattern from the existing smoke tests (`src/routes/invoices.smoke.test.ts`).

### Phase 6 — Deploy sequence

```bash
npm run db:migrate:local           # Test migration locally
npx vitest run                      # All tests green
npm run build                       # Compile
npm run deploy                      # Main worker
wrangler deploy --config wrangler-cron.jsonc   # Cron worker — DO NOT FORGET
wrangler d1 migrations apply roofing-production --remote   # Prod migration
```

Then manually verify against prod:
1. Log in as a test roofer account.
2. Ensure `auto_invoice_enabled=1` on that customer.
3. Place an order with a homeowner email you control.
4. Wait up to 90 seconds.
5. Check inbox + check `/api/admin/auto-proposal/audit?order_id=N` + check Proposal Dashboard.

---

## 6. Things to explicitly verify, not assume

- That `orders.invoice_customer_email`, `.invoice_customer_name`, `.invoice_customer_phone` columns exist in PROD (not just local). Run migration-status check.
- That the `invoices` table in prod has `document_type`, `share_token`, `share_url`, `valid_until`, `created_by` columns.
- That `invoice_audit_log` table exists in prod.
- That `customers.auto_invoice_enabled`, `.invoice_pricing_mode`, `.invoice_price_per_square`, `.invoice_price_per_bundle` all exist.
- That the cron worker's D1 binding points at the same database as the main worker (both should reference `e64c0cf3-43fa-4f41-ac75-ed12694a26c5` per `wrangler.jsonc` / `wrangler-cron.jsonc`).

If any is missing, create a migration. Do not bypass.

---

## 7. Out of scope — do not do these

- Do not add a new email provider. Gmail OAuth2 + Resend already work.
- Do not change the proposal HTML template beyond what is necessary for clarity. The current template at `auto-invoice.ts:243-263` is acceptable.
- Do not add SMS or any non-email channel.
- Do not redesign the Proposal Dashboard beyond adding the `auto-sent` badge.
- Do not refactor `generateReportForOrder` — it's large but working.
- Do not touch the LiveKit voice agent, Rover, the cold-call system, or anything else in the repo that doesn't sit on the order → report → proposal path.

---

## 8. Reporting format when you're done

Reply in this exact structure:

1. **Phase 0 findings** — paste the five SQL / CLI outputs.
2. **What I changed** — list of file paths with a one-line rationale each.
3. **What I did NOT change and why** — especially if you skipped any acceptance-criteria checkbox, explain.
4. **Test evidence** — `npx vitest run` output tail, plus the manual E2E verification steps you ran.
5. **Deployment evidence** — output of `wrangler deployments list` for both workers, and `wrangler d1 migrations list ... --remote`.
6. **Known risks / remaining work** — anything you punted.

If you hit a genuine blocker (e.g. a secret you can't set, a prod migration you're not authorized to run), STOP and report, don't work around it.
