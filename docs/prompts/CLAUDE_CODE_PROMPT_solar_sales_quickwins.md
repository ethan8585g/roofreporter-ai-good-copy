# Claude Code Prompt — Solar Sales Company Module: 1–2 Sprint Quick Wins

> Paste the block below into Claude Code in the root of this repo. It is self-contained: competitive analysis, current-state map, gap list, and an implementation-ready task list with file paths, DB migrations, route signatures, and acceptance criteria.

---

## Context (do not re-research — start here)

You are working on **Roof Manager** — a Hono + Cloudflare Workers + D1 monolith (`src/index.tsx`) that already ships a solar-sales module for solar installers/sales orgs. Our goal in the next 1–2 sprints is to close the conversion gap against Aurora Solar, OpenSolar, SolarGraf (Enphase), and Solo/Enerflo/Sighten — without rewriting the stack.

### What we already have (verified 2026-04-20)

**Routes:** `src/routes/solar-pipeline.ts`, `solar-presentation.ts`, `solar-documents.ts`, `solar-permits.ts`
**Services:** `src/services/solar-datalayers.ts` (Google Solar API + GeoTIFF DSM/mask/flux → area, pitch, irradiance), `solar-geometry.ts` (deterministic polygon→pixel), `solar-api.ts` (9-tile satellite imagery), `solar-panel-layout.ts` (grid-packed panels with NFPA/IRC setbacks, Liu-Jordan kWh estimate)
**Frontend:** `public/static/solar-design.js` (canvas panel-placement), `solar-pipeline.js` (kanban), `solar-presentation.js`, `solar-documents.js`, `solar-permits.js`, `solar-calculator.js`
**Templates:** `src/templates/solar-proposal.ts` (HTML/PDF branded report — generator exists, **no public share URL, no UI button**)
**D1 tables:** `customers` (company_type enum), `solar_deals` (8-stage pipeline + commissions), `solar_presentation_slides`, `solar_proposal_documents`, `solar_permits`, `reports.solar_panel_layout` JSON
**Other infra we can reuse:** `share_token` pattern already used on `reports`, `customer_portal`, `invoices` (see `src/index.tsx:2739, 2810, 3681`); Resend email via `src/services/email.ts`; Gemini vision via `src/services/gemini.ts`; R2 for file storage; Stripe for payments.

### Competitive gap (the 4 biggest deltas)

| Competitor | Killer feature we don't have |
|---|---|
| **Aurora Solar** | Interactive web proposal with e-sign, NPV/IRR/LCOE financial modeling, 8,760-hr shading, Sungage/loan integrations on-the-spot |
| **OpenSolar** | "Sales Machine" — lifestyle-oriented shareable web proposal, live pricing, cash/loan/lease/PPA side-by-side, Zapier + QuickBooks hooks |
| **SolarGraf (Enphase)** | **AI-powered DIY permit plan generation** (16,000+ AHJs, 95% time reduction), single-line/three-line diagram auto-gen, NEM 3.0 battery modeling |
| **Solo / Enerflo / Sighten** | In-home "proposal in minutes" flow, title check, soft credit pull, savings forecaster, DocuSign round-trip |

**The through-line:** every competitor monetizes one moment — the homeowner sees a live, shareable, mobile proposal with production, savings, financing, and a "Sign" button. We currently stop at a PDF the rep has to email manually. **Fix that first.**

### Our unique advantages to preserve

1. Satellite-first roof measurement (DSM + mask + flux GeoTIFFs, <5s fast mode) — competitors rely on LIDAR/drone or simpler satellite
2. Deterministic polygon→pixel geometry (no LLM in the hot path)
3. Tight integration with the roof measurement engine (same geometry powers solar and roofing)
4. Cloudflare edge (D1 + Workers) gives us sub-100ms proposal loads globally

---

## Scope — 1–2 sprint quick wins

### Sprint 1: Close the proposal/close conversion gap (week 1–2)

#### 1. Public interactive web proposal — `/p/solar/:token`

**Why:** This is the single highest-leverage feature. Every competitor has it. We already have the PDF generator and the `share_token` pattern.

**DB migration** — new file `migrations/0176_solar_web_proposals.sql`:

```sql
CREATE TABLE IF NOT EXISTS solar_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  deal_id INTEGER REFERENCES solar_deals(id),
  report_id INTEGER REFERENCES reports(id),
  share_token TEXT UNIQUE NOT NULL,
  -- Snapshot (immutable once sent) so pricing/layout don't drift:
  system_kw REAL NOT NULL,
  panel_count INTEGER NOT NULL,
  annual_kwh REAL NOT NULL,
  panel_layout_json TEXT,          -- copy of reports.solar_panel_layout at send time
  equipment_json TEXT,             -- inverter, battery, panel model/wattage
  pricing_json TEXT,               -- gross, rebates, net, $/W
  financing_scenarios_json TEXT,   -- [{type:'cash'|'loan'|'lease', ...}]
  utility_rate_per_kwh REAL,
  annual_consumption_kwh REAL,
  offset_pct REAL,                 -- computed: annual_kwh / annual_consumption_kwh
  savings_25yr_cad REAL,
  -- Homeowner interaction:
  status TEXT NOT NULL DEFAULT 'draft',   -- draft|sent|viewed|signed|rejected|expired
  sent_at TEXT,
  first_viewed_at TEXT,
  view_count INTEGER DEFAULT 0,
  signed_at TEXT,
  signature_image_r2_key TEXT,
  signer_name TEXT,
  signer_ip TEXT,
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_solar_proposals_customer ON solar_proposals(customer_id);
CREATE INDEX idx_solar_proposals_deal ON solar_proposals(deal_id);
CREATE UNIQUE INDEX idx_solar_proposals_token ON solar_proposals(share_token);
```

**New file:** `src/routes/solar-proposals.ts` with:

- `POST /api/customer/solar-proposals` — create proposal from `{deal_id, report_id}`; snapshot current panel layout + pricing; return `{id, share_token, public_url}`
- `GET /api/customer/solar-proposals` — list for the authenticated customer (filter by deal_id, status)
- `GET /api/customer/solar-proposals/:id` — owner view
- `PATCH /api/customer/solar-proposals/:id` — edit pricing/financing before send
- `POST /api/customer/solar-proposals/:id/send` — mark `sent`, stamp `sent_at`, trigger email via `src/services/email.ts` (Resend), advance the linked `solar_deals` row to `proposal_sent` stage
- `POST /api/customer/solar-proposals/:id/void` — revoke token

**Public routes (no auth, token-gated) — mount in `src/index.tsx` near the existing `share_token` routes around line 2739:**

- `GET /p/solar/:token` — returns homeowner HTML (mobile-first; see template below); increments `view_count`, stamps `first_viewed_at`
- `POST /p/solar/:token/sign` — accepts `{signer_name, signature_png_base64}`; writes to R2, stamps `signed_at`, advances deal stage to `signed`, auto-stamps `solar_deals.signed_at`
- `POST /p/solar/:token/event` — optional: track scroll-depth, CTA clicks for sales analytics

**New template:** `src/templates/solar-web-proposal.ts` (mobile-first HTML, inline CSS, no framework — match the style of `src/templates/solar-proposal.ts` but optimized for phones). Required sections, top to bottom:

1. Hero: homeowner name + address + satellite image with panel overlay (re-use panel drawing logic from `solar-proposal.ts`)
2. "Your system" card: `system_kw`, panel count + model, inverter, battery (if any)
3. "Your production": annual kWh, month-by-month bar chart (SVG), offset% vs consumption
4. "Your savings": 25-year savings, payback period, cumulative chart
5. **Financing toggle** — tab UI for Cash / Loan / Lease / PPA with monthly payment + net cost
6. What's included checklist + warranty callouts
7. Next steps: "Sign to move forward" (HTML5 `<canvas>` signature pad) + "Request changes" (mailto rep)
8. Footer: company logo, rep photo/name/phone (from `customers` table), Roof Manager "Powered by" (small)

Frontend signature pad: vanilla JS, no library. Base64-encode the PNG on submit.

**Acceptance:**
- Rep clicks "Generate Proposal" from `solar-pipeline.js` deal card → POST creates proposal, returns URL, copies to clipboard
- Homeowner opens link on phone, scrolls through, signs → `solar_deals.stage` auto-advances to `signed`, rep receives Resend notification email
- Re-opening after `signed_at` shows a read-only signed version
- End-to-end passes a new vitest spec at `src/routes/solar-proposals.test.ts`

---

#### 2. Real production simulation — NREL PVWatts V8 integration

**Why:** Our Liu-Jordan estimate in `src/services/solar-panel-layout.ts:~estimateAnnualKwhForPanel` is a toy. Every competitor uses 8,760-hour hourly simulation. NREL's PVWatts V8 is free, REST, 30 req/hr unauth + higher with an API key (we already manage secrets, so add `NREL_API_KEY`).

**New service:** `src/services/pvwatts.ts`:

```ts
export interface PVWattsInput {
  lat: number; lng: number;
  system_capacity_kw: number;   // DC
  tilt_deg: number;             // per-segment pitch
  azimuth_deg: number;          // 180 = south (Northern hemisphere)
  module_type?: 0 | 1 | 2;      // 0=standard, 1=premium, 2=thin-film
  losses_pct?: number;          // default 14 (NREL)
  array_type?: 0 | 1 | 2 | 3 | 4; // 1=fixed roof mount
}
export interface PVWattsResult {
  annual_kwh: number;
  monthly_kwh: number[];        // length 12
  capacity_factor: number;
  source: 'pvwatts_v8';
}
export async function runPVWatts(env: Env, input: PVWattsInput): Promise<PVWattsResult>
```

Endpoint: `https://developer.nrel.gov/api/pvwatts/v8.json?api_key=...&lat=..&lon=..&system_capacity=..&azimuth=..&tilt=..&array_type=1&module_type=1&losses=14`

**Wire-in:** In `src/services/solar-panel-layout.ts`, after `generatePanelLayout(...)` computes panel positions grouped by segment, call `runPVWatts` **once per segment** (parallel via `Promise.all`), sum results, and return `annual_kwh_pvwatts`. Keep the old Liu-Jordan as a fallback when NREL errors or rate-limits (catch + log). Cache results in a new column on `reports`:

```sql
-- migrations/0177_reports_production_simulation.sql
ALTER TABLE reports ADD COLUMN production_simulation_json TEXT;
```

**Acceptance:** for a test fixture in `src/services/pvwatts.test.ts`, PVWatts returns ≥ Liu-Jordan × 0.85 and ≤ × 1.25 (sanity bounds), and the per-segment sum matches a whole-system NREL call within 2%.

---

#### 3. Financing scenarios — cash / loan / lease / PPA

**Why:** "What's my monthly payment" is the #1 homeowner question. Every competitor shows all options side-by-side.

**New service:** `src/services/solar-financing.ts`:

```ts
export interface FinancingInputs {
  gross_cost_cad: number;
  rebates_cad: number;
  net_cost_cad: number;
  annual_production_kwh: number;
  utility_rate_per_kwh: number;
  utility_escalator_pct: number;    // default 3%
  discount_rate_pct: number;         // default 5%
  system_degradation_pct: number;    // default 0.5%/yr
  analysis_years: number;            // default 25
}
export interface CashScenario { type:'cash'; net_cost_cad:number; payback_years:number; npv_cad:number; irr_pct:number; lcoe_cad_per_kwh:number; savings_25yr_cad:number; }
export interface LoanScenario { type:'loan'; apr_pct:number; term_years:number; dealer_fee_pct:number; monthly_payment_cad:number; total_interest_cad:number; ... }
export interface LeaseScenario { type:'lease'; monthly_payment_cad:number; escalator_pct:number; term_years:number; ... }
export interface PPAScenario { type:'ppa'; rate_per_kwh_cad:number; escalator_pct:number; term_years:number; ... }
export function computeAllScenarios(inputs: FinancingInputs, loan_terms: LoanTerms[], lease_terms: LeaseTerms[]): Scenario[]
```

Financial formulas (pure TS, vitest'able):
- **Cash NPV:** `Σ (yr_savings / (1+r)^t) - net_cost`
- **Cash IRR:** Newton-Raphson on NPV=0
- **Payback:** first year cumulative savings ≥ net cost
- **LCOE:** net_cost / Σ(production_kwh)
- **Loan monthly:** standard amortization `P*r / (1 - (1+r)^-n)`

**DB:** Store default rate cards per customer so a rep can pick them in the UI:

```sql
-- migrations/0178_solar_financing_templates.sql
CREATE TABLE IF NOT EXISTS solar_financing_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  label TEXT NOT NULL,               -- "GoodLeap 25yr 7.99%"
  type TEXT NOT NULL,                -- cash|loan|lease|ppa
  config_json TEXT NOT NULL,
  is_default INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**Routes (add to `src/routes/solar-proposals.ts`):**

- `GET /api/customer/solar-financing-templates`
- `POST /api/customer/solar-financing-templates`
- `PATCH /api/customer/solar-financing-templates/:id`
- `DELETE /api/customer/solar-financing-templates/:id`

Proposal creation snapshots the *resolved scenarios* into `solar_proposals.financing_scenarios_json` so edits to templates don't mutate sent proposals.

**Acceptance:** `src/services/solar-financing.test.ts` with NPV/IRR/payback cross-checked against hand-computed fixtures (e.g. $30k system, 10k kWh/yr, $0.18/kWh, 3% escalator → expected payback ≈ 9.8 yrs).

---

#### 4. Utility-bill sizing inputs on deals

**Why:** Every competitor sizes the system from actual consumption, not guesswork.

**DB:**

```sql
-- migrations/0179_solar_deals_utility_inputs.sql
ALTER TABLE solar_deals ADD COLUMN annual_consumption_kwh REAL;
ALTER TABLE solar_deals ADD COLUMN utility_rate_per_kwh REAL;
ALTER TABLE solar_deals ADD COLUMN utility_escalator_pct REAL DEFAULT 3.0;
ALTER TABLE solar_deals ADD COLUMN utility_provider TEXT;
ALTER TABLE solar_deals ADD COLUMN utility_bill_r2_key TEXT;  -- uploaded image
```

Update `solar-pipeline.js` deal modal: new collapsible "Utility info" section with these four fields + drag-drop file upload.

**Stretch (move to Sprint 2 if tight):** hook `src/services/gemini.ts` to OCR the uploaded bill — extract kWh/month and $/kWh, auto-populate the fields. Prompt template in `src/services/utility-bill-ocr.ts`.

---

#### 5. Deal-stage email automations (Resend)

**Why:** Solar's #1 CRM complaint is "my rep forgot to follow up." OpenSolar and Aurora fire triggered emails on stage change. We already have Resend wired for roof reports.

**New service:** `src/services/solar-automations.ts` — single function `onDealStageChange(env, deal, old_stage, new_stage)` that:
- `proposal_sent` → email homeowner the proposal link (if `solar_proposals.status='sent'` doesn't already exist for this deal, create + send)
- `signed` → email rep + CC operations inbox with "Sign ceremony complete"
- `install_scheduled` → email homeowner "Your install is on {date}"
- `installed` → email homeowner "Welcome-to-solar" email + request review
- `paid` → mark commission events (already handled by pipeline)

Call it from the existing `PATCH /api/customer/solar-pipeline/:id` handler in `src/routes/solar-pipeline.ts` whenever `stage` changes.

**Email templates:** extend `src/services/email.ts` with `buildSolarProposalEmail(proposal, homeowner, rep)`, `buildSolarSignedEmail`, etc. Re-use the existing `sendEmail` / Resend fallback path.

**Acceptance:** `src/services/solar-automations.test.ts` mocks the Resend client and asserts the correct template fires for each transition.

---

### Sprint 2: Differentiator features (week 3–4)

#### 6. AI-powered permit plan draft generator

**Why:** SolarGraf's AI permit is their moat — "95% faster permit plans." We have Gemini already wired and 16,000 AHJs of public data. We won't beat them on coverage in one sprint, but we can ship a **first-pass plan draft** that auto-fills the 3 most common artifacts for any residential permit: site plan, single-line diagram, equipment spec sheet bundle.

**New service:** `src/services/solar-permit-ai.ts`:
- Input: `deal_id` → pulls property address, roof measurement (from `reports`), panel layout (from `solar_panel_layout`), equipment list, AHJ jurisdiction
- Uses Gemini 2.5 Pro with structured output to emit:
  - Site plan specs (property outline, panel array bounding boxes, setback annotations) → rendered server-side as SVG → PDF via `pdf-lib`
  - Single-line diagram: panel strings → inverter → main panel → utility (template SVG, Gemini picks the right topology for the inverter type)
  - Equipment cut-sheets: fetch manufacturer datasheet URLs for the selected inverter/panel/battery (hardcoded map in `src/services/equipment-catalog.ts`), merge via `pdf-lib`
- Output: single merged PDF uploaded to R2, row in `solar_proposal_documents` with `doc_type='permit_plan_draft'`

**Route:** `POST /api/customer/solar-permits/:id/generate-plan` in `src/routes/solar-permits.ts` → returns `{r2_key, url}`.

**Guardrails:** watermark the PDF "DRAFT — REQUIRES PROFESSIONAL REVIEW" and require the customer to acknowledge a disclaimer once before first use (new `customers.permit_ai_ack_at` column).

**Acceptance:** for a seeded test deal, calling the endpoint produces a non-empty PDF with all 3 sections; a vitest spec asserts the PDF has ≥3 pages and includes the panel count in its text content (via `pdf-parse`).

---

#### 7. Equipment pricing catalog + gross-margin calc

**Why:** We currently hardcode equipment; reps can't manage $/W pricing. This is plumbing for the financing and proposal modules.

**DB:**

```sql
-- migrations/0180_solar_equipment_pricing.sql
CREATE TABLE IF NOT EXISTS solar_equipment_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  category TEXT NOT NULL,           -- panel|inverter|battery|racking|other
  manufacturer TEXT,
  model TEXT NOT NULL,
  wattage_w INTEGER,                -- for panels
  cost_cad REAL NOT NULL,           -- installer cost
  price_cad REAL NOT NULL,          -- sold price
  unit TEXT NOT NULL DEFAULT 'each', -- each|per_watt|per_kwh
  spec_sheet_url TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_solar_eqp_customer ON solar_equipment_catalog(customer_id, category, is_active);
```

**Route module:** `src/routes/solar-equipment.ts` — full CRUD + bulk import via CSV.

**UI:** new `/customer/solar-equipment` page with a catalog grid; integrate selection into `solar-design.js` (replace hardcoded Enphase/SolarEdge list).

Proposal snapshot now includes cost-of-goods so we can show rep-facing margin in `solar-pipeline.js` (never in `/p/solar/:token`).

---

#### 8. Proposal variants + homeowner A/B

**Why:** Enerflo and Solo let reps present "Good/Better/Best" — conversion jumps materially when homeowners pick rather than accept/reject.

**DB:** Already mostly supported. Add `parent_proposal_id INTEGER REFERENCES solar_proposals(id)` on `solar_proposals` so variants group. Homeowner page renders a tab-switcher across sibling variants.

**Route:** `POST /api/customer/solar-proposals/:id/duplicate` returns new variant with same `share_token` group but separate `id`.

**Acceptance:** homeowner opening `/p/solar/:token` for any variant in the group sees all siblings in a tab strip.

---

## Cross-cutting rules

1. **All new code in TS, Hono route handlers, D1 queries via `c.env.DB`.** No new frameworks. No Next.js. No React — plain HTML/CSS/vanilla JS for `/p/solar/:token`.
2. **Migrations are additive.** Never rewrite existing tables. Use `ALTER TABLE` and new tables. Number sequentially starting at `0176`.
3. **Reuse `share_token` pattern** (32-char hex, generated with `crypto.getRandomValues`) — see existing `src/index.tsx:2739` for prior art.
4. **Mobile-first for `/p/solar/:token`.** Homeowners open proposals on phones. Target 60fps scroll on iPhone SE, <200ms TTFB from any North American edge.
5. **Snapshot-on-send.** Never render a sent proposal from live data. Freeze into `solar_proposals.*_json` at `send` time.
6. **Tests.** Every new service gets a `*.test.ts` sibling with at least 3 cases: happy path, edge case, failure path. Run with `npx vitest run`.
7. **Env vars to add:** `NREL_API_KEY` (PVWatts), already-existing `GEMINI_API_KEY`, `RESEND_API_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Document in `README.md` + `wrangler.jsonc`.
8. **Telemetry.** Log `proposal_sent`, `proposal_viewed`, `proposal_signed`, `proposal_financing_tab_clicked` to a new `solar_proposal_events` table (append-only) for funnel analytics. This is our "we're better than Aurora" proof source.
9. **Don't break the roofing module.** Share code with roofing where natural (measurement, satellite imagery) but gate all solar-only UI behind `customers.company_type = 'solar'`.

---

## Delivery order & definition of done

Work in this order. Do not start a task before the prior one is merged and passing `npx vitest run`:

1. `0176` migration + `src/routes/solar-proposals.ts` CRUD + auth (no UI yet)
2. `src/services/solar-financing.ts` + tests (pure functions, easiest to verify first)
3. `src/services/pvwatts.ts` + `0177` migration + wire into `solar-panel-layout.ts`
4. `0178` financing templates + CRUD routes
5. `0179` utility inputs + `solar-pipeline.js` deal modal update
6. `src/templates/solar-web-proposal.ts` + public `/p/solar/:token` routes
7. Signature pad + sign flow + deal auto-advance
8. `src/services/solar-automations.ts` + Resend templates
9. "Generate Proposal" button wired in `solar-pipeline.js`
10. End-to-end smoke test: create deal → generate proposal → open public link in incognito → sign → verify deal stage = `signed`
11. (Sprint 2) Items 6–8 above

**Sprint 1 DoD:** a rep can click one button on a deal, paste the resulting URL into a text to the homeowner, and the homeowner can review production, savings, 4 financing options, and e-sign from their phone — all from our platform with no external tool. This is parity with OpenSolar's "Sales Machine" core flow and beats our current state (PDF-over-email) decisively.

**Sprint 2 DoD:** the rep can additionally auto-generate a draft permit plan PDF, manage a live pricing catalog with gross-margin visibility, and offer the homeowner a Good/Better/Best variant comparison. At this point we are roughly at feature parity with OpenSolar, Sighten, and Solo on the proposal flow, behind Aurora and SolarGraf on 3D/shading/permit-AI breadth, but with a differentiated edge-native architecture and tighter integration to our roof-measurement engine.

---

## What NOT to build this cycle (explicit out-of-scope)

- 3D roof modeling (Aurora's moat — 3–6 month effort on its own)
- Sub-module 8,760-hr shading analysis (needs LIDAR or multi-angle satellite; Sprint 3+)
- Native mobile apps (web is fine for phones; revisit in Q3)
- CRM webhooks / Zapier (nice to have, not a conversion blocker)
- Credit soft-pull / title check (requires partner contracts — start legal process now in parallel)
- NEM 3.0 battery economic model (US-CA only; our traffic is mostly Canada)

When you hit ambiguity, prefer the choice that ships the conversion-critical flow faster. When you hit a DB schema question, err toward additive columns and JSON blobs over wide new tables.

Begin with task 1 (`migrations/0176_solar_web_proposals.sql` + `src/routes/solar-proposals.ts`). Pause after each numbered delivery item and report what's done + what's next.
