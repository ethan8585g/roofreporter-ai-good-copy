# Invoicing Automation — Deep Debug & Fix Prompt (Claude Code)

> Paste this entire document into Claude Code at the repo root. It is code-anchored to file paths and line numbers from the current codebase. Do the work in the order given. Do not skip the verification steps.

---

## Context

Repo: `roofreporter-ai-good-copy` (Hono + Cloudflare Pages/Workers, D1 binding `roofing-production`, JSX routes in `src/routes/`, services in `src/services/`, migrations in `migrations/`).

The invoicing automation ("auto-invoice") is the pipeline that, after a report transitions to `status='completed'`, creates a draft proposal in the `invoices` table (`document_type='proposal'`, `created_by='auto-invoice'`) and optionally emails the homeowner via Gmail OAuth2. A 10-minute cron (`wrangler-cron.jsonc`) sweeps as a fallback.

A prior pass (see `INVOICING-AUTOMATION-FIX-PROMPT.md`) addressed 7 root causes. Most are fixed, but a deep rescan surfaced **two blockers, one likely-bug, and several smells** that are the probable reason the automation still "doesn't work" from the user's point of view.

The goal of this prompt: **find and fix every remaining failure mode, add tests, and verify end-to-end.**

---

## Ground truth files to read first

Read these before touching anything — they are the existing surface area:

1. `src/services/auto-invoice.ts` — `createAutoInvoiceForOrder()` (L57–283) and `sweepAutoInvoices()` (L290–314).
2. `src/services/auto-invoice-audit.ts` — `logAutoInvoiceStep()` (L27–42) and the `AutoInvoiceStep` union.
3. `src/routes/reports.ts` — auto-invoice hook at **L1761** (wrapped in `waitUntil`) and **L3106** (NOT wrapped — see Fix #2).
4. `src/routes/admin.ts` — manual trace submit at **L3518–3590** (missing auto-invoice call — see Fix #1) and health endpoint at **L104–144**.
5. `src/routes/square.ts` — order creation at **L435–704**, homeowner persistence L515–518, premature audit at L652–671.
6. `src/routes/crm.ts` — automation settings CRUD at **L740–770**.
7. `src/routes/invoices.ts` — proposal list query at **L170–197** (`document_type='proposal'` filter).
8. `migrations/0154_invoicing_automation.sql`, `migrations/0157_invoice_audit_log.sql`, `migrations/0159_invoice_audit_log_order_id.sql`.
9. `wrangler-cron.jsonc` and `src/cron-worker.ts` (the `sweepAutoInvoices` call at **L223–231**).
10. `INVOICING-AUTOMATION-FIX-PROMPT.md` — the previous remediation doc (do NOT re-do its work; only close what it missed).

Do not edit anything until you have confirmed my line numbers still match HEAD. If they drifted, re-locate by symbol name.

---

## Findings the analysis surfaced (the job list)

### BLOCKER 1 — Admin-traced orders never fire the inline auto-invoice hook

**Where:** `src/routes/admin.ts`, handler for `POST /superadmin/orders/:id/submit-trace` (L3518–3590). At L3568 it calls `generateReportForOrder(orderId, c.env)` and returns. There is **no** call to `createAutoInvoiceForOrder` after the report completes.

**Why it breaks the automation:** For any order with `needs_admin_trace=1` (i.e. anything that required manual tracing — a common case in production), the proposal only gets created when the 10-minute cron sweep runs. From the roofer's perspective, the automation looks broken for up to 10 minutes.

**Fix:**

1. Add the import near the top of `src/routes/admin.ts`:
   ```ts
   import { createAutoInvoiceForOrder } from '../services/auto-invoice'
   ```
2. Immediately after the `generateReportForOrder(...)` call at ~L3568, add a fire-and-forget hook using `waitUntil` when available:
   ```ts
   const ctx = (c as any).executionCtx
   const autoInvP = createAutoInvoiceForOrder(c.env, Number(orderId))
     .catch((e) => console.warn('[auto-invoice] admin-trace hook error:', e?.message))
   if (ctx?.waitUntil) ctx.waitUntil(autoInvP)
   ```
3. Do **not** `await` it — the admin endpoint should return promptly.

### BLOCKER 2 — `generateReportForOrder` hook is not wrapped in `waitUntil`

**Where:** `src/routes/reports.ts` L3106. Current code:
```ts
createAutoInvoiceForOrder(env, Number(orderId)).catch((e) => console.warn('[auto-invoice] hook error:', e?.message))
```
No `waitUntil`, so when this path runs inside a request handler that has already returned, the Promise is abandoned and the worker can terminate before the hook finishes. Compare to the good pattern at L1761 which does wrap it.

**Why it breaks the automation:** Gmail OAuth refresh + SMTP send can take hundreds of ms. On Cloudflare Workers, any async work not passed to `waitUntil` is killed once the response is sent. Intermittent missing proposals. Hard to debug because the audit row never gets written either.

**Fix:** Replace L3106 with:
```ts
const ctx = (env as any).executionCtx
const p = createAutoInvoiceForOrder(env, Number(orderId))
  .catch((e) => console.warn('[auto-invoice] hook error:', e?.message))
if (ctx?.waitUntil) ctx.waitUntil(p)
```
Note: `generateReportForOrder` takes `env` (not `c`) — the execution context must be threaded in. If `env.executionCtx` isn't populated in every caller, add an optional `ctx?: ExecutionContext` parameter to `generateReportForOrder` and pass `c.executionCtx` from each call site (`src/routes/reports.ts`, `src/routes/admin.ts`, anywhere else that invokes it — grep for `generateReportForOrder(`).

### LIKELY-BUG 3 — Premature `entered` audit row in `square.ts`

**Where:** `src/routes/square.ts` L652–671. On order creation, the code calls `logAutoInvoiceStep({ step: 'entered', reason: 'awaiting report completion; recipient=…' })` **even if automation is disabled on the customer**. This makes the `/api/admin/health/auto-invoice` last-run/last-failure counters misleading and pollutes `invoice_audit_log` with rows that have `invoice_id=0` and no actual decision.

**Fix:** Gate the `entered` log behind the customer's `auto_invoice_enabled` flag. Look up `customers.auto_invoice_enabled` for the owning roofer (via `orders.customer_id`) before writing the row. If disabled, either skip entirely or write a `skipped_not_enabled` row so dashboards are accurate.

### SMELL 4 — No dedicated tests for `auto-invoice.ts`

**Where:** `src/services/auto-invoice.test.ts` does not exist. The other invoice suites (`invoices.smoke.test.ts`, `invoices.math.test.ts`, `invoices.auth.test.ts`, `proposals.unified.test.ts`) cover everything **except** the automation.

**Fix:** Create `src/services/auto-invoice.test.ts` using Vitest + miniflare-style D1 mock (or the existing test harness — check `src/routes/invoices.smoke.test.ts` for the pattern used here). Cover these cases:

1. Report completes, automation enabled, homeowner email present → proposal row created with `document_type='proposal'`, `status='draft'`, `created_by='auto-invoice'`, and `invoice_audit_log` contains `proposal_drafted`.
2. Automation disabled on the customer → no proposal row, audit row = `skipped_not_enabled`.
3. `orders.invoice_customer_email` is NULL or empty → no proposal, audit row = `skipped_no_recipient`.
4. Report status not `completed` → no proposal, audit row = `skipped_no_report`.
5. Idempotency — calling `createAutoInvoiceForOrder` twice for the same order creates exactly one invoice and the second call yields `skipped_already_exists`.
6. Measurements missing / zero → draft is created with quantity 0 and audit row = `quantity_zero_drafted`; email is **not** sent.
7. Gmail env vars missing → proposal stays `draft`, audit row = `proposal_email_skipped`.
8. Gmail env vars present and `sendGmailOAuth2` resolves → proposal updated to `status='sent'`, audit row = `proposal_emailed`.
9. `sendGmailOAuth2` throws → proposal stays `draft`, audit row = `error` with the error message.

### SMELL 5 — Measurement field resolution is string-indexed

**Where:** `src/services/auto-invoice.ts` L123–134, the `pickNumber()` helper walking `gross_squares`, `true_area_squares`, `measurements.*`, `full_report.measurements.*`, `bom.*`, `full_report.bom.*`. This was widened in the previous pass (RC-5), but the paths are untyped strings and any schema drift in the `reports` JSON blob silently falls through to 0.

**Fix:** Add an explicit log when **all** paths return null/zero, including the list of top-level keys actually present on the report payload. Something like:
```ts
if (squares == null) {
  console.warn('[auto-invoice] no squares resolved; report keys =', Object.keys(reportObj))
}
```
This lets ops diagnose field-name drift quickly from Cloudflare tail logs instead of poking the DB.

### SMELL 6 — Health endpoint does not surface "orders ready but not yet invoiced"

**Where:** `src/routes/admin.ts` L104–144 (`GET /api/admin/health/auto-invoice`). It reports Gmail readiness, counts, last-run, last-failure, and 7-day breakdown, but not the **current backlog** — i.e. the same query `sweepAutoInvoices` uses.

**Fix:** Add a `backlog` field to the response:
```ts
const backlog = await env.DB.prepare(`
  SELECT COUNT(*) AS n
  FROM reports r
  JOIN orders o ON o.id = r.order_id
  JOIN customers c ON c.id = o.customer_id
  WHERE r.status = 'completed'
    AND c.auto_invoice_enabled = 1
    AND o.invoice_customer_email IS NOT NULL AND o.invoice_customer_email != ''
    AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = r.order_id AND i.created_by = 'auto-invoice')
`).first<{ n: number }>()
```
Return `backlog.n`. If this is ever non-zero for more than ~15 minutes in prod, the cron is broken.

### SMELL 7 — `invoice_audit_log.invoice_id NOT NULL` sentinel of 0

**Where:** migration `0157_invoice_audit_log.sql` makes `invoice_id` NOT NULL, and `logAutoInvoiceStep` writes `0` when no invoice exists yet. It works but means foreign-key-style queries (`JOIN invoices ON invoices.id = log.invoice_id`) accidentally match nothing and look innocuous. Low priority — document or migrate to nullable in a follow-up.

---

## Execution plan (do these in order)

1. **Re-verify line numbers** for every file listed in "Ground truth files to read first". If any have drifted more than ~20 lines, re-locate by symbol and note the new coordinates inline in a comment you leave in your PR description.
2. **Implement BLOCKER 1** (`src/routes/admin.ts` submit-trace handler).
3. **Implement BLOCKER 2** (`src/routes/reports.ts` L3106 + thread `executionCtx` through `generateReportForOrder` if needed). After this, grep for every other call site of `createAutoInvoiceForOrder(` and confirm each uses `waitUntil`.
4. **Implement LIKELY-BUG 3** (`src/routes/square.ts` L652–671 — gate the `entered` log on `auto_invoice_enabled`).
5. **Implement SMELL 5** (diagnostic log in `pickNumber` fallback in `src/services/auto-invoice.ts`).
6. **Implement SMELL 6** (`backlog` field in `/api/admin/health/auto-invoice`).
7. **Write the test suite** described in SMELL 4 at `src/services/auto-invoice.test.ts`. Run `npx vitest run src/services/auto-invoice.test.ts` and iterate until green.
8. **Run the full test suite** with `npx vitest run` to confirm no regressions in the other invoice tests.
9. **Local end-to-end verification** using `npm run dev:sandbox`:
   - Seed a roofer customer with `auto_invoice_enabled=1`, `invoice_pricing_mode='per_square'`, `invoice_price_per_square=350`.
   - Place an order via the customer order form with homeowner name/email/phone populated.
   - Force-complete the report (either the natural path or admin submit-trace, test both).
   - Confirm within a second or two:
     - A row appears in `invoices` with `document_type='proposal'`, `created_by='auto-invoice'`, `status` either `draft` or `sent`.
     - `invoice_audit_log` has `entered` (from square.ts, now gated) and `proposal_drafted` (and `proposal_emailed` if Gmail configured locally).
     - `/api/admin/health/auto-invoice` shows `backlog: 0`.
10. **Production secret check** (do not modify prod; only report):
    ```bash
    wrangler pages secret list --project-name=roofmanager-web
    ```
    Expected: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, plus the Google/Gemini/Stripe/Square/JWT secrets listed in `CLAUDE.md`. Report any missing.

---

## Verification checklist (do not close the task until all are true)

- [ ] `src/routes/admin.ts` submit-trace handler calls `createAutoInvoiceForOrder` via `waitUntil`.
- [ ] Every call to `createAutoInvoiceForOrder(` in the repo is either inside `waitUntil(...)` or is intentionally awaited with a documented reason.
- [ ] `src/routes/square.ts` only emits `entered` audit rows when the owning customer has `auto_invoice_enabled=1`.
- [ ] `src/services/auto-invoice.ts` logs a warn with the report-object keys when measurements resolve to null.
- [ ] `GET /api/admin/health/auto-invoice` returns a `backlog` integer matching the sweep query.
- [ ] `src/services/auto-invoice.test.ts` exists and covers all 9 cases in SMELL 4. `npx vitest run src/services/auto-invoice.test.ts` is green.
- [ ] `npx vitest run` is green overall.
- [ ] Local E2E (step 9 above) produces a proposal row within 2 seconds of report completion for both the natural path and the admin-trace path.
- [ ] Production Gmail OAuth secrets are confirmed present (or a separate follow-up issue is opened if missing).

---

## Out of scope (do NOT do in this pass)

- Do not refactor the `invoices` table schema or split `document_type` into a separate `proposals` table.
- Do not change the `invoice_audit_log.invoice_id` nullability (tracked as SMELL 7 for a later migration).
- Do not touch the customer-facing proposal viewer or the PDF template.
- Do not change pricing defaults (`350/square`, `125/bundle`).
- Do not migrate from Gmail OAuth to Resend even if it seems cleaner — that's a separate decision.

---

## Deliverables to hand back

1. One PR (or clearly separated commits) containing the code changes above.
2. The new test file `src/services/auto-invoice.test.ts` with green output.
3. A short written summary in the PR description listing which of BLOCKER 1, BLOCKER 2, LIKELY-BUG 3, SMELL 4, SMELL 5, SMELL 6 landed in this PR, and which (if any) are deferred and why.
4. The output of the production secret check (step 10), redacted, with a yes/no per expected secret.
