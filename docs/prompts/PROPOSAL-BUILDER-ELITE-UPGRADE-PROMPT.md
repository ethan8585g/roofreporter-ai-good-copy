# ROOF MANAGER — ELITE PROPOSAL/ESTIMATE BUILDER UPGRADE
## Engineered Implementation Prompt (paste into Claude Code)

---

## 0. ORIENT YOURSELF BEFORE WRITING ANY CODE

You are working inside `/Users/.../roofreporter-ai-good-copy` — a Cloudflare Pages + Workers monorepo (Hono + JSX + D1 SQLite). Read `CLAUDE.md` at the repo root before starting. All routes mount from `src/index.tsx`. Business logic lives in `src/services/`, all SQL in `src/repositories/reports.ts` or inline in route files, and all types in `src/types.ts`. No separate frontend build — HTML is returned from route handlers.

**The module under review:** the proposal / estimate / quote / certificate subsystem. I performed an audit — here is the ground truth you must build on, not replace.

### 0.1 What already exists (DO NOT rebuild)
- **Unified documents table** `invoices` with `document_type IN ('invoice','proposal','estimate')` (migration `0040_invoice_proposals.sql`)
- **Proposal tiers** — Good/Better/Best grouping via `proposal_tier`, `proposal_group_id` (migration `0041_proposal_tiers_pipeline.sql`)
- **Line items, tax flags, discounts** — well-tested in `src/routes/invoices.math.test.ts` (keep these tests green)
- **Share-token public flow** — `/respond/:token` accepts/declines without login; signature stored as base64 image
- **Pricing engine** — `src/services/pricing-engine.ts` (469 lines) with TIER_PRESETS (Good=$110/sq 3-tab, Better=$145/sq architectural, Best=$225/sq designer), steep-roof 25% premium at ≥8:12, progress billing
- **Material BOM** — `src/services/material-estimation-engine.ts` (shingles, underlayment, starter, ridge cap, drip edge, ice&water, valley, nails, caulk, pipe boots, ridge vents, 15% waste factor, 5% GST)
- **Square payment links** — quick_pay + webhook → auto-mark paid
- **Gmail OAuth2 email delivery** with embedded payment + share links
- **Certificate generation** — `src/templates/certificate.ts` (400 lines, letter-size print HTML)
- **Certificate automation** — `auto_send_certificate` flag on `customers` (migration `0135_certificate_automation.sql`); fires when proposal is accepted AND flag is on; `certificate_sent_at` timestamp recorded
- **RBAC** — `invoices` and `view_financials` permissions; `redactFinancials()` blanks $ for restricted team members
- **View tracking schema** — `proposal_view_log(proposal_id, viewed_at, ip, user_agent, referrer)` + `view_count`, `last_viewed_at` (schema only, no API)

### 0.2 Known technical debt you must resolve along the way
1. **Triple document tables** — `invoices`, `crm_proposals`, `crm_invoices` coexist. `invoices` is canonical; the others are legacy. Migrate reads/writes to `invoices` and mark the others `-- DEPRECATED` with a NOT-enforced check constraint blocking new inserts.
2. **Hardcoded pricing constants** — `TIER_PRESETS`, `SHINGLE_COST_PER_BUNDLE_CAD=42.00`, etc. live in TypeScript. Move to DB-backed, admin-editable tables.
3. **Orphaned supplier schema** — `supplier_orders`, `supplier_directory` exist (migration `0067`) with no endpoints. Either wire up or drop.
4. **Signature is not legally binding** — base64 PNG ≠ ESIGN-compliant. This phase adds compliance metadata, not a third-party e-sign integration.
5. **Analytics tables not exposed** — `proposal_view_log` is written but never read by an endpoint.
6. **Certificate automation is hardcoded if/else**, not a rule engine.

### 0.3 Files to read first (in this order) before changing anything
```
CLAUDE.md
src/types.ts
src/index.tsx                         # route mounting
src/routes/invoices.ts                # 1,376 lines — main proposal API
src/routes/crm.ts                     # legacy crm_proposals endpoints
src/routes/invoices.math.test.ts      # money-math contract tests
src/services/pricing-engine.ts
src/services/material-estimation-engine.ts
src/services/email.ts
src/templates/certificate.ts
src/templates/solar-proposal.ts
src/lib/permissions.ts
migrations/0040_invoice_proposals.sql
migrations/0041_proposal_tiers_pipeline.sql
migrations/0050_enhanced_proposals_invoices.sql
migrations/0067_proposal_supplier_enhancement.sql
migrations/0071_crm_proposals_missing_columns.sql
migrations/0135_certificate_automation.sql
```

---

## 1. NORTH-STAR GOAL

Transform the proposal module from "functional backend + thin UI" into a **category-leading roofing/solar proposal builder** competitive with Roofr, Sumo Quote, JobNimbus, AccuLynx, Leap, and iRoofing. The defining features of "elite" in this market are:

1. **Measurement-driven auto-population** — a proposal is built in under 60 seconds from a completed measurement report.
2. **Branded, interactive, mobile-first customer-facing proposal** — not a PDF attachment; a hosted page with video walkthrough slots, tier comparison, financing calculator, and one-tap accept + deposit.
3. **Good/Better/Best tier comparison** with visual swap of shingle/material line items and instant re-pricing.
4. **Real-time view tracking + sales rep notifications** — "customer opened proposal 3 min ago, spent 2:14 on the financing section."
5. **Visual workflow/automation builder** — the certificate auto-send is generalized into a trigger/action rule engine roofers can configure (e.g., *if proposal viewed 3× and not accepted in 48h → send SMS follow-up*).
6. **Legally-defensible e-signature** (consent, IP/UA audit trail, timestamped hash) — and pluggable adapter for DocuSign/HelloSign later.
7. **Financing calculator** (monthly payment / APR) and deposit collection integrated with Square.
8. **Admin-editable pricing + material catalog** (no hardcoded constants).
9. **Versioned proposals** — v1 declined, v2 accepted; side-by-side diff.
10. **Analytics dashboard** — win rate, avg time-to-accept, tier mix, conversion by sales rep.

---

## 2. NON-GOALS (PHASE 1)

Do NOT implement in this pass:
- Xactimate / Symbility insurance export
- EagleView / HOVER direct integrations (Google Solar is enough)
- Third-party e-sign (DocuSign/HelloSign) — build an adapter interface so it can be added later
- Multi-currency — stay CAD/USD; add a `currency` column but default to tenant setting
- Real-time SSE/WebSocket — use polling + email notifications for Phase 1
- Native mobile app — responsive web only

---

## 3. GUARDRAILS (APPLY TO EVERY COMMIT)

1. **Never rename or drop columns** in the `invoices`, `customers`, `crm_customers`, `orders` tables. Add new tables/columns only.
2. **Every migration is additive + idempotent.** Wrap column-adds in `SELECT COUNT(*) FROM pragma_table_info(...)` guards where needed. Use sequential numeric prefixes — next available is `0136_` (verify by `ls migrations | tail`).
3. **Keep `invoices.math.test.ts` green.** If you change `calculateTotals()`, extend the test rather than rewrite it.
4. **All money is integer cents internally** for new tables; convert at the API boundary. (Existing `invoices.total` stays in dollars for back-compat — wrap with a helper.)
5. **All new routes honor `invoices` and `view_financials` permissions.** Apply `redactFinancials()` from `src/lib/permissions.ts` on response.
6. **Every customer-facing HTML page passes `<meta name="viewport" ...>` + works at 375px width** (mobile-first check).
7. **No `console.log` in production paths.** Use the existing logger.
8. **Do not touch the LiveKit Python agent** (`livekit-agent/`) in this pass.
9. **Do NOT deploy.** Run `npm run dev:sandbox` + `npx vitest run` locally. Claude Code stops at a clean `git status` per phase — the human runs `npm run deploy` manually.

---

## 4. PHASED IMPLEMENTATION PLAN

Implement strictly in phase order. Each phase ends with a commit and a manual smoke test checklist. Do not start Phase N+1 until Phase N's checklist passes.

---

### PHASE 1 — UNIFY THE DOCUMENT MODEL (DEBT PAYDOWN)

**Why first:** every later feature is harder if three tables pretend to be "proposals."

**Migration:** `migrations/0136_deprecate_legacy_proposal_tables.sql`

- Copy any non-duplicated rows from `crm_proposals` into `invoices` with `document_type='proposal'`, preserving `share_token`, `customer_signature`, timestamps. Use `INSERT ... WHERE NOT EXISTS`.
- Add trigger `crm_proposals_deprecated_insert` that raises on new inserts (D1 supports `AFTER INSERT ... SELECT RAISE(ABORT, ...)`).
- Add view `v_proposals` = `SELECT * FROM invoices WHERE document_type='proposal'`. All new code reads from the view, not the table, so we can later partition.

**Code changes:**
- In `src/routes/crm.ts`, deprecate `POST /proposals`, `GET /proposals`, etc. — have them forward to `src/routes/invoices.ts` handlers with `document_type='proposal'`. Add `@deprecated` JSDoc + log a warning once per process using a `Set<string>` guard.
- Consolidate type definitions in `src/types.ts` — one `Proposal` type extending `Invoice` with tier-specific fields.

**Tests:** add `src/routes/proposals.unified.test.ts` — assert `POST /api/invoices` with `document_type='proposal'` and the old `POST /api/crm/proposals` return functionally identical rows.

**Smoke test:**
- [ ] Create a proposal from `/api/invoices` — appears in `v_proposals`
- [ ] Legacy `/api/crm/proposals` create still works but logs deprecation
- [ ] `npx vitest run` green
- [ ] `npm run dev:sandbox` loads without 500s

**Commit:** `refactor(proposals): unify on invoices table, deprecate crm_proposals`

---

### PHASE 2 — PRICING & MATERIAL CATALOG (DB-BACKED, ADMIN-EDITABLE)

**Why:** elite CRMs let each company tune their own prices. Today these live in TypeScript and require a redeploy.

**Migration:** `migrations/0137_pricing_catalog.sql`

```sql
CREATE TABLE IF NOT EXISTS material_catalog (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,  -- 'shingle','underlayment','flashing','accessory','labor','disposal'
  unit TEXT NOT NULL,      -- 'sq','bundle','roll','lf','ea','hr'
  default_cost_cents INTEGER NOT NULL,
  default_price_cents INTEGER NOT NULL,
  coverage_per_unit REAL,  -- e.g. 33.3 sqft per bundle
  taxable INTEGER NOT NULL DEFAULT 1,
  waste_factor_pct REAL DEFAULT 0,
  supplier_id TEXT,
  supplier_sku TEXT,
  archived INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(company_id, sku)
);
CREATE INDEX idx_material_catalog_company_category ON material_catalog(company_id, category, archived);

CREATE TABLE IF NOT EXISTS pricing_tier_presets (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  tier TEXT NOT NULL,  -- 'good','better','best'
  label TEXT NOT NULL,
  description TEXT,
  shingle_sku TEXT,
  underlayment_sku TEXT,
  ridge_vent_sku TEXT,
  ice_water_sku TEXT,
  labor_rate_cents_per_sq INTEGER NOT NULL,
  tear_off_rate_cents_per_sq INTEGER NOT NULL,
  steep_pitch_multiplier REAL DEFAULT 1.25,
  steep_pitch_threshold_twelfths INTEGER DEFAULT 8,
  accent_color TEXT DEFAULT '#2563eb',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(company_id, tier)
);

CREATE TABLE IF NOT EXISTS tax_jurisdictions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  region_code TEXT NOT NULL,  -- 'AB-CA', 'ON-CA', 'TX-US'
  label TEXT NOT NULL,
  rate_bps INTEGER NOT NULL,  -- basis points; 500 = 5.00%
  applies_to_materials INTEGER DEFAULT 1,
  applies_to_labor INTEGER DEFAULT 0
);

-- Seed each existing master_companies row with current TIER_PRESETS values
-- (write a one-off INSERT based on pricing-engine.ts constants)
```

**Code:**
- `src/repositories/catalog.ts` (new) — CRUD for `material_catalog`, `pricing_tier_presets`, `tax_jurisdictions`, scoped by `company_id`.
- `src/routes/catalog.ts` (new) — `GET/POST/PUT/DELETE /api/catalog/materials`, `.../tiers`, `.../tax`. Require `invoices` permission; require `view_financials` to read cost fields.
- Refactor `src/services/pricing-engine.ts`:
  - Remove TIER_PRESETS constant.
  - Add `async function loadTierPresets(db, companyId): Promise<TierPresets>` that reads the DB with a 5-minute in-memory LRU cache (use `Map` + TTL — no external dep).
  - Same pattern for material costs.
  - Keep the hardcoded values as a `FALLBACK_PRESETS` const used when a company has no rows seeded.
- Same for `src/services/material-estimation-engine.ts`.

**UI (admin):** `src/templates/catalog-admin.tsx` — Hono JSX page at `/admin/catalog` with tabs (Materials / Tiers / Tax), inline-editable rows, import/export CSV. Use Alpine.js (already in project, see `public/`) — not React.

**Tests:**
- `src/services/pricing-engine.test.ts` — seeds a test company with custom prices, asserts proposal uses them.
- `src/repositories/catalog.test.ts` — CRUD happy/sad paths.

**Smoke test:**
- [ ] Seed a company, edit a shingle cost in the admin UI, create a new proposal — line item reflects new price
- [ ] Another company's prices are unchanged (tenant isolation)
- [ ] Old proposals are NOT retroactively re-priced

**Commit:** `feat(pricing): move tier presets and material catalog to D1 tables with admin UI`

---

### PHASE 3 — MEASUREMENT-TO-PROPOSAL AUTOPILOT

**Why:** the single biggest speed win. Today a roofer rekeys square footage, pitch, eaves, ridges from the measurement report into the proposal. Elite CRMs do this in one click.

**Route:** `POST /api/invoices/from-report/:orderId`

Handler logic in `src/services/proposal-autofill.ts` (new):
1. Load the order + its measurement report (existing `roof-measurement-engine.ts` output).
2. Extract `projectedArea`, `slopedArea`, `predominantPitch`, `ridgeLength`, `valleyLength`, `eaveLength`, `hipLength`.
3. Call `material-estimation-engine.ts` → BOM per tier.
4. Call `pricing-engine.ts` → totals per tier.
5. Create 3 `invoices` rows (document_type='proposal') sharing a `proposal_group_id`, one per tier, each with populated `line_items` (new JSON column if not present — check migration 0050).
6. Link `attached_report_id = order.report_id`, copy `accent_color` from `pricing_tier_presets`.
7. Return `{ proposalGroupId, proposals: [...] }`.

**UI:** on the report detail page, add a "Generate Proposal" CTA that calls this endpoint and redirects to the new builder (Phase 4).

**Edge cases to handle:**
- Report with no valleys / hips (flat roof) — skip those line items; do not zero-divide.
- Steep pitch (≥8:12) — pricing engine already handles via multiplier. Verify via test.
- Multi-building lots — if report has `multiple_structures=true`, warn the user and fall back to per-structure UI (out of scope; emit TODO).

**Test:** `src/services/proposal-autofill.test.ts` — fixture order with known report → assert 3 proposals created, totals within ±$0.02 of expected, line items match BOM.

**Smoke test:**
- [ ] Open a completed report, click "Generate Proposal", see three tiered drafts in < 2s
- [ ] Edit Better tier, change a line item — totals recompute
- [ ] Delete a tier — group still valid; `proposal_group_id` intact

**Commit:** `feat(proposals): one-click tiered proposal generation from measurement report`

---

### PHASE 4 — THE BUILDER UI (the centerpiece)

**Why:** today there is essentially no builder UI — just form fields. This is what distinguishes "has a proposal feature" from "elite proposal builder."

**Route:** `GET /app/proposals/:id/edit` renders `src/templates/proposal-builder.tsx`.

**Layout (three-pane, responsive):**

```
┌───────────────┬──────────────────────────┬──────────────┐
│ Left sidebar  │ Center canvas (live pre- │ Right inspect│
│ - Blocks lib  │ view of customer-facing  │ - Block props│
│ - Sections    │ proposal — edit inline)  │ - Tier swap  │
│ - Tier toggle │                          │ - Pricing    │
│ - Ver history │                          │              │
└───────────────┴──────────────────────────┴──────────────┘
```

**Block library (draggable):**
- Cover page (logo, property photo, customer name, proposal #, date, valid-until)
- Scope of work (rich text)
- Tier comparison table (Good/Better/Best — auto-populated from `proposal_group_id` siblings)
- Line items table (editable inline)
- Measurement summary (pulls from attached report — sqft, pitch, edges)
- Satellite / drone photo gallery
- Video embed (YouTube/Vimeo — tenant's walkthrough)
- Financing calculator (Phase 7)
- Warranty (rich text, company boilerplate)
- Payment terms & deposit
- Reviews / testimonials (pulled from company settings)
- Signature block
- Footer / contact card

**Persistence model:**
- New column: `invoices.builder_blocks JSON` — array of `{ id, type, props, order }`.
- On save, recompute `scope_of_work` (from rich-text block) and `line_items` (from line-items block) for back-compat; builder_blocks is the source of truth going forward.

**Live preview iframe:**
- Route `GET /p/preview/:id` renders the same template as the public customer page, read from the draft's `builder_blocks`. Iframe this into the builder.

**Tech constraint:**
- No React. Use the existing Alpine.js + Hono JSX stack.
- Drag-drop via `sortablejs` (single CDN include, 13kb gzipped). Add to the page's `<head>`.
- Rich text: TipTap is overkill — use `contenteditable` with a minimal toolbar (bold, italic, list, link). Save as sanitized HTML (use `sanitize-html` or a 20-line whitelist).

**Keyboard shortcuts:** `⌘S` save, `⌘D` duplicate block, `⌘Z` undo (keep last 10 states in-memory — no server-side undo).

**Autosave:** every 3s if dirty, via `PATCH /api/invoices/:id/builder`. Show a "Saved 3s ago" pill.

**Tests:**
- Integration: Playwright (add `@playwright/test`) — open builder, drag a block, type text, refresh page, content persists.
- Unit: `src/lib/builder-blocks.test.ts` — each block renders without throwing given valid/invalid props.

**Smoke test:**
- [ ] Drag a new block, edit its text, refresh — content persists
- [ ] Switch to Better tier in inspector — canvas updates without page reload
- [ ] Works at 375px width on iPhone SE simulator
- [ ] Back button / browser history doesn't lose unsaved state (use `beforeunload`)

**Commit:** `feat(proposals): drag-drop builder with live preview and autosave`

---

### PHASE 5 — CUSTOMER-FACING PROPOSAL PAGE (the "wow")

**Why:** this is what the homeowner actually sees — and what converts.

**Route:** `GET /p/:shareToken` (already exists as `/respond/:token`; rename to `/p/:token` and alias the old one for back-compat).

**Requirements:**
- Full-bleed hero with property photo (pull from Google Street View / Solar API imagery if available — fallback to gradient + logo).
- Sticky top bar with tenant logo, proposal #, "Accept" CTA that stays visible on scroll.
- Tier comparison card — toggle Good/Better/Best updates the whole page with a soft fade transition (client-side, no reload). Use the sibling proposals in `proposal_group_id`.
- Line items table collapsible by default, one-tap to expand.
- Financing calculator (Phase 7) — if enabled.
- Video embed auto-plays muted.
- "Save for later" button → emails a copy of the link to themselves.
- Accept flow:
  1. Tap Accept → modal with e-signature pad (existing), printed name, email confirmation checkbox "By signing, I agree to the scope and payment terms…"
  2. Capture `ip`, `user_agent`, `geolocation` (navigator.geolocation, optional), timestamp.
  3. Hash `(signature_png + name + email + tenant_id + proposal_id + total + timestamp)` with SHA-256; store `acceptance_hash`.
  4. On success, show deposit collection step (Phase 7) or a "Thank you — we'll be in touch" confirmation.
- Decline flow: prompt for reason (dropdown: Price / Timing / Chose another / Other + textarea). Store in `decline_reason`.

**Migration:** `migrations/0138_proposal_acceptance_audit.sql` — add columns to `invoices`: `acceptance_hash TEXT`, `acceptance_ip TEXT`, `acceptance_user_agent TEXT`, `acceptance_geolocation TEXT`, `consent_language_version TEXT`, `decline_reason TEXT`. Create table `proposal_consent_versions` (id, text, effective_from) so the exact legal wording at time of signing is captured.

**Tracking:**
- Every section scroll past 50% fires `POST /api/track/proposal-view` with `proposal_id`, `section_id`, `time_on_section_ms`.
- Expose `GET /api/proposals/:id/analytics` returning: `view_count`, `last_viewed_at`, `total_time_ms`, `section_engagement: [{section, time_ms}]`, `accept_funnel: viewed→opened_pricing→opened_financing→accepted`.

**Tests:**
- Playwright: full accept flow end-to-end.
- Unit: hash reproducibility — same inputs always produce same hash.

**Smoke test:**
- [ ] Share a proposal link in an incognito window, accept, confirm audit row has IP/UA/hash
- [ ] Switch tier on mobile, accept the Best tier — correct total captured
- [ ] Decline with reason "Price" — shows in dashboard
- [ ] Lighthouse mobile score ≥90

**Commit:** `feat(proposals): premium customer-facing page with legal-grade acceptance audit`

---

### PHASE 6 — AUTOMATION / WORKFLOW ENGINE (generalize the certificate trigger)

**Why:** the certificate auto-send you just built is a specific instance of a general pattern. Elite CRMs let roofers configure any such rule without code.

**Design:** trigger/action rule engine with declarative JSON rules stored per company.

**Migration:** `migrations/0139_automation_rules.sql`

```sql
CREATE TABLE IF NOT EXISTS automation_rules (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER DEFAULT 1,
  trigger_event TEXT NOT NULL,   -- 'proposal.sent','proposal.viewed','proposal.accepted','proposal.declined','job.completed','payment.received','proposal.expired','proposal.unviewed_hours'
  trigger_conditions TEXT,       -- JSON: { view_count: { gte: 3 }, hours_since_sent: { gte: 48 } }
  actions TEXT NOT NULL,         -- JSON array: [{type:'email', template:'...', to:'customer'},{type:'sms',...},{type:'generate_certificate'},{type:'notify_rep'},{type:'wait', hours:24},{type:'create_task'}]
  created_at TEXT DEFAULT (datetime('now')),
  last_fired_at TEXT
);

CREATE TABLE IF NOT EXISTS automation_rule_runs (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  target_id TEXT NOT NULL,       -- proposal_id, order_id, etc.
  target_type TEXT NOT NULL,
  status TEXT NOT NULL,          -- 'queued','running','succeeded','failed','skipped'
  error TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_rule_runs_target ON automation_rule_runs(target_type, target_id);

CREATE TABLE IF NOT EXISTS automation_event_bus (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,         -- JSON
  processed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**Engine:** `src/services/automation-engine.ts`
- `publishEvent(eventType, payload)` — append to `automation_event_bus`.
- `runDueRules()` — worker function invoked by Cloudflare Cron Trigger every 5 min (`wrangler-cron.jsonc` exists). Scans unprocessed events, matches rules by `trigger_event + trigger_conditions`, enqueues runs.
- `executeAction(run, action)` — switch on `action.type`: `email` (call `src/services/email.ts`), `sms` (placeholder — log + TODO), `generate_certificate` (call existing certificate code), `notify_rep` (internal email), `wait` (re-enqueue with `not_before`), `create_task` (insert into existing task/pipeline table).

**Refactor existing certificate automation:**
- On app boot (or via one-off migration 0139), insert a seed rule for every company with `auto_send_certificate=true`: `{ trigger: 'proposal.accepted', actions: [{type:'generate_certificate'},{type:'email_certificate'}] }`.
- Remove the hardcoded if/else from `src/routes/invoices.ts`; publish a `proposal.accepted` event instead. Keep `certificate_sent_at` written by the action.

**UI:** `src/templates/automation-builder.tsx` at `/app/automations`
- List of rules with on/off toggles, last-fired-at, success rate.
- Rule editor: form for trigger dropdown, condition chips, ordered action list.
- Template library: 8 prebuilt rules a roofer can one-click-enable:
  1. Send certificate of install when proposal accepted ✓ (default on, for back-compat)
  2. Send thank-you email 1 hour after acceptance
  3. Send follow-up email 48h after proposal sent if unviewed
  4. Notify sales rep when customer has viewed proposal 3+ times
  5. Auto-expire proposals after 30 days
  6. Send referral request 14 days after job completion
  7. Request Google review 3 days after certificate sent
  8. Alert manager on any proposal > $50,000

**Tests:**
- `src/services/automation-engine.test.ts` — publish event, register rule, run engine, assert action fired.
- `src/routes/automation.routes.test.ts` — CRUD + permission boundaries.

**Smoke test:**
- [ ] Existing "auto send certificate" still works — accept a proposal, certificate arrives
- [ ] Enable the 48h unviewed follow-up, fast-forward by mocking `hours_since_sent`, verify email sent
- [ ] Disable a rule — next matching event is a no-op; `automation_rule_runs` shows `status='skipped'`

**Commit:** `feat(automations): generalize trigger/action workflow engine, migrate certificate automation`

---

### PHASE 7 — FINANCING CALCULATOR + DEPOSIT COLLECTION

**Why:** roofers win bigger deals when homeowners see monthly payment, not total price.

**Route:** `POST /api/finance/quote` — server-side so APR logic is centralized.

Input: `{ principalCents, termMonths, aprBps, downPaymentCents }` → output: `{ monthlyCents, totalInterestCents, totalPaidCents, amortization: [...] }`. Use the standard `M = P * r(1+r)^n / ((1+r)^n - 1)` formula. All amounts in cents; no floats until rendering.

**Migration:** `migrations/0140_financing.sql` — `financing_products` table per company (name, min/max term, apr_bps, min/max principal), and `invoices.financing_product_id`.

**Builder block:** "Financing Calculator" — roofer chooses which products to show; customer sees a slider (12–240 months) and live monthly payment.

**Deposit collection:**
- Builder block "Deposit & Payment Terms" — fields: deposit % or $, progress %, final %.
- On acceptance, if deposit configured, the customer is redirected to a Square checkout link for the deposit amount. Existing Square code in `src/routes/invoices.ts` handles the rest.
- New column `invoices.deposit_cents`, `invoices.deposit_collected_cents`, `invoices.deposit_collected_at`.

**Adapter interface:** create `src/services/financing/index.ts` with a `FinancingProvider` interface (`quote()`, `prequalify()`, `applyLink()`). Ship a `ManualFinancingProvider` (uses the company's own products) now; stub `GreenSkyProvider`, `ServiceFinanceProvider`, `SunlightProvider` with `throw new Error('Not implemented — see docs/financing-integration.md')`. Add that doc file as a stub.

**Tests:**
- `src/services/finance-quote.test.ts` — known amortization schedule matches hand-calculated values.
- `src/routes/finance.routes.test.ts` — prevents negative principal, cap rate at reasonable bounds.

**Smoke test:**
- [ ] Slider on customer page updates monthly payment live
- [ ] Acceptance with deposit redirects to Square; webhook marks `deposit_collected_at`
- [ ] Acceptance without deposit skips payment step

**Commit:** `feat(financing): calculator, adapter interface, deposit collection on acceptance`

---

### PHASE 8 — VERSIONING, AUDIT TRAIL, E-SIGNATURE COMPLIANCE

**Why:** elite CRMs let reps send v2 when v1 is declined and maintain a defensible paper trail.

**Migration:** `migrations/0141_proposal_versioning.sql`

```sql
CREATE TABLE IF NOT EXISTS proposal_versions (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,   -- full invoice row + builder_blocks at save time
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(proposal_id, version_number)
);
CREATE INDEX idx_proposal_versions_proposal ON proposal_versions(proposal_id);
```

**Code:**
- `src/services/proposal-versioning.ts` — on every `POST /api/invoices/:id/send` or `PATCH .../accept`, write a snapshot.
- Endpoint `GET /api/invoices/:id/versions` → list. `GET /api/invoices/:id/versions/:n` → snapshot.
- Endpoint `GET /api/invoices/:id/versions/diff?a=1&b=2` → field-level diff. Use a 100-line `diffObjects()` helper — no external dep.

**UI:** builder's left sidebar adds a "History" tab showing version list with timestamps + user; click to open a side-by-side diff modal.

**E-sign compliance helpers** (`src/lib/esignature.ts`):
- `consentStatement(companyId): { version, html }` — pulls from `proposal_consent_versions`.
- `captureAcceptance(req, proposalId)` — canonicalizes inputs and produces the SHA-256 hash (was introduced in Phase 5; formalize here).
- `buildAcceptanceCertificate(proposalId): Buffer` — generates a PDF with: consent language shown, signature image, printed name, IP, UA, timestamp, hash. Stored in R2 (or D1 blob for now) and linkable from the certificate of install.

**Tests:**
- `src/services/proposal-versioning.test.ts` — edit → send → edit → send produces 2 versions.
- `src/lib/esignature.test.ts` — hash reproducibility, consent version pinning.

**Smoke test:**
- [ ] Decline v1, duplicate-as-new-version, customer accepts v2, both versions visible in history
- [ ] Acceptance certificate PDF downloadable by the company admin

**Commit:** `feat(proposals): versioning, diff, legally-defensible acceptance certificate`

---

### PHASE 9 — ANALYTICS DASHBOARD

**Why:** you cannot improve win rate without measuring it.

**Route:** `GET /app/analytics/proposals` renders `src/templates/proposal-analytics.tsx`.

**Metrics (scoped to `company_id` + date range):**
- Total proposals sent / viewed / accepted / declined / expired
- Win rate (accepted / (accepted + declined + expired))
- Avg time-to-accept (sent_date → accepted_at)
- Avg contract value by tier
- Tier mix (% Good / Better / Best accepted)
- Decline reasons breakdown
- Sales-rep leaderboard (sent, won, rate, $ won)
- Conversion funnel: sent → opened → viewed-pricing → viewed-financing → accepted
- Engagement heatmap per block (avg time-on-section)

**Queries:** add `src/repositories/analytics.ts`. All queries parameterize `company_id`, `from`, `to`. Use D1 with CTEs — no client-side aggregation.

**Rendering:** Chart.js (already used elsewhere — verify) via CDN. Server renders initial HTML; client hydrates charts.

**Export:** "Download CSV" button per table.

**Smoke test:**
- [ ] Dashboard renders with zero data (no divide-by-zero)
- [ ] With seeded fixtures, all charts populated
- [ ] Permission check: `view_financials` required to see $ values

**Commit:** `feat(analytics): proposal performance dashboard with funnels and rep leaderboard`

---

### PHASE 10 — POLISH, PERFORMANCE, ACCESSIBILITY, DOCS

- Run Lighthouse CI against `/p/:token` — target 90+ mobile performance, 100 accessibility.
- Add `aria-*` to all builder controls; builder must be keyboard-navigable.
- Add `/docs/proposal-builder.md` with screenshots + data model ERD (Mermaid in markdown).
- Add a `docs/api/openapi-proposals.yaml` spec covering all new endpoints.
- Add `CHANGELOG.md` entry under `## Unreleased` for every phase.
- Verify `npm run build` succeeds with no TS warnings.

**Commit:** `docs + chore: proposal builder documentation, OpenAPI spec, a11y pass`

---

## 5. ACCEPTANCE CRITERIA (whole project)

- [ ] A roofer can open a completed measurement report, click "Generate Proposal," and get a ready-to-send tiered draft in under 5 seconds of human time.
- [ ] The proposal builder is drag-drop, live-preview, autosaves, works on a phone.
- [ ] The customer-facing page has a Lighthouse mobile performance score ≥90 and accessibility score ≥95.
- [ ] Acceptance produces an SHA-256 hashed audit row with IP/UA/timestamp/consent-version-pinned, plus a downloadable acceptance PDF.
- [ ] Certificate automation still works (regression) and is now one rule of N in a generic engine.
- [ ] At least 5 automation rule templates ship enabled/disabled out of the box.
- [ ] Pricing is admin-editable; no pricing constants remain in TypeScript.
- [ ] Proposals are versioned with diff view.
- [ ] Analytics dashboard shows win rate, tier mix, funnel, engagement heatmap.
- [ ] All new code covered by tests; `npx vitest run` all green.
- [ ] `npm run build` succeeds with zero TS errors.

---

## 6. HOW TO EXECUTE THIS PROMPT

Paste this file into Claude Code and instruct it:

> Read `PROPOSAL-BUILDER-ELITE-UPGRADE-PROMPT.md`, then execute Phase 1 end-to-end: read the listed files, create the migration, refactor the routes, add tests, run `npx vitest run` and `npm run dev:sandbox`, show me the diff, and stop. Do NOT start Phase 2 until I confirm Phase 1's smoke test passes. Do NOT deploy. Do NOT touch the LiveKit agent. Ask me before adding any new npm dependency.

Then iterate phase-by-phase. Review each commit. Deploy manually only after Phase 10.

---

## 7. APPENDIX — QUICK WINS IF YOU WANT PROOF-OF-VALUE FIRST

If you want to demo improvements before committing to the full 10 phases, do these in order, each ~1–2 hour of Claude Code work:

1. **Expose `proposal_view_log` via `GET /api/proposals/:id/analytics`** — immediate "the customer opened it 3 times" win. ~60 LOC.
2. **Add a "Duplicate Proposal" button** — snapshot current proposal as v2. ~80 LOC.
3. **Seed 5 automation rule templates** into `automation_rules` (requires Phase 6's migration but not the full UI) — lets you trigger follow-ups today.
4. **Add a "Copy customer link" button** on the proposal list page — reduces a 4-click workflow to 1.
5. **Replace hardcoded `TIER_PRESETS` with an `env.PRICING` JSON binding** (not full Phase 2 catalog, just make them editable without a redeploy).

Each of these is shippable in an afternoon and proves the direction before you invest in the bigger phases.
