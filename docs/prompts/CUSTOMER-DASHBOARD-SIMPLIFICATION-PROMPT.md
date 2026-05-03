# Claude Code Prompt — Customer/User Dashboard Simplification

**Paste this entire prompt into your Claude Code terminal.** Do not make any code changes during the first two phases — the deliverable of this task is a written plan (`CUSTOMER-DASHBOARD-SIMPLIFICATION-PLAN.md`), exactly mirroring how `SUPER-ADMIN-SIMPLIFICATION-PLAN.md` was produced. Only the third phase may propose concrete file edits — as a separate companion doc, not as applied changes.

---

## Context you must load before doing anything else

1. Read `SUPER-ADMIN-SIMPLIFICATION-PLAN.md` in full. That document is the **template** and **house style** for the output you will produce. Match its tone (terse, specific, scoreboard tables, "kill vs. keep", phased rollout), its structure (Diagnosis → Plan → What it kills → Phases → Files to touch → Success criteria), and its level of file/line-number specificity.
2. Read `CLAUDE.md` to understand the architecture: Hono monolith on Cloudflare Workers + D1; routes in `src/routes/`; frontend JS strings in `public/static/`; main router is `src/index.tsx`; D1 binding is `roofing-production`; customer auth lives in `src/routes/customer-auth.ts`; the customer portal is at `/customer`.
3. Skim `README.md` only if something in the customer flow is unclear after reading the code.

You are **not** writing code. You are producing a markdown plan. The only files you should create are:
- `CUSTOMER-DASHBOARD-SIMPLIFICATION-PLAN.md` (the main deliverable)
- `CUSTOMER-DASHBOARD-FILE-MAP.md` (companion — produced in Phase 3, optional)

Do not touch any `.ts`, `.tsx`, `.js`, `.sql`, `.jsonc`, or `.json` file in the repo. Do not run migrations. Do not run `npm run deploy`. Do not delete anything. If you catch yourself about to edit a source file, stop.

---

## Phase 1 — Deep Analysis (the "Diagnosis" section)

**Goal:** reproduce the rigor of Section 1 of `SUPER-ADMIN-SIMPLIFICATION-PLAN.md`, but for the **logged-in customer experience** (everything behind `/customer/*`, NOT `/admin` or `/super-admin`).

Produce Section 1 of the plan doc: "Why it feels this complex (diagnosis)". Include the following subsections, each with tables where appropriate and exact file paths + line numbers:

### 1.1 Count every shell the customer has to move between
The customer portal currently uses **at least three page shells**:

- The main dashboard shell (`/customer/dashboard` → `public/static/customer-dashboard.js`), left sidebar
- The CRM sub-page shell (`getCrmSubPageHTML()` in `src/index.tsx` around line 13423, loading `crm-module.js`), header-only
- Standalone pages with their own headers (`secretary.js`, `team-dashboard.js`, `virtual-tryon.js`, `proposal-builder.js`, etc.)

List every shell. For each, give the route-mount location in `src/index.tsx` (line numbers), the frontend file, and its size in KB.

### 1.2 Enumerate the sidebar
The sidebar is defined in `public/static/customer-dashboard.js` around lines 274–351. List **every** sidebar item verbatim, grouped by section (REPORTS, CRM, TEAM, STORM SCOUT, SERVICES, TOOLS, footer). Count them. Note which items are gated by `company_type === 'solar'` vs. always shown. Note which items have a mobile tab equivalent in the mobile bottom-nav block (around lines 355–370) and which are desktop-only.

Expected count to confirm: ~26 desktop sidebar items + ~12 mobile tabs + 2 footer links.

### 1.3 The "where are my new leads / messages / jobs" problem
This is the direct parallel to Section 1.2 of the super-admin plan. Enumerate every place an inbound communication or new lead can land for a customer. For each, give:
- Source (what generated it)
- Backend endpoint / route file
- Where it currently surfaces in the UI (which sidebar item, which subtab)
- Whether there is any unread/new badge

At minimum cover: Rover chat widget on the customer's own site, Storm Scout alerts, D2D appointments, Secretary inbound calls, Secretary SMS, Secretary voicemail/callbacks, lead-capture form submissions (`src/routes/lead-capture.ts`), widget submissions (`src/routes/widget.ts`), CRM job messages, Email Outreach replies (`src/routes/email-outreach.ts`), push notifications (`src/routes/push.ts`), CRM manual customer entries, cold-call / call-center inbound that gets forwarded to the customer.

Conclude with a one-line verdict: **N entry points, 0 unified inboxes.**

### 1.4 Duplicate / overlapping destinations — build a table for each of these clusters

- **Orders / reports** (dashboard badge vs. Report History vs. Order New Report form vs. mobile Reports tab)
- **Invoices / billing** (dashboard badge vs. CRM Invoices sub-page vs. `/customer/invoice/:id` vs. any settings billing panel vs. `invoice-manager.js`)
- **Proposals / designs / visualizers** (Proposals list in CRM vs. `proposal-builder.js` standalone vs. `design-builder.js` vs. `solar-design.js` vs. `material-calculator.js` vs. `virtual-tryon.js` vs. `home-designer.js`)
- **Dashboards / overview surfaces** (`/customer/dashboard` main hub vs. `/customer/team-dashboard` vs. CRM Pipeline analytics vs. Email Outreach analytics)
- **Settings** (`/customer/profile` vs. theme toggle on dashboard vs. Suppliers/Catalog/Referrals inside CRM vs. tool-specific settings embedded in Website Builder / Google Ads / Google Business / Meta Connect / Secretary)
- **Marketing / integrations** (Email Outreach, Website Builder, Google Ads, Google Business, Meta Connect, Storm Scout as outbound lead-gen) — why are these six separate sidebar items?
- **Team** (`/customer/team-dashboard` vs. `/customer/team` vs. `/customer/team-management` vs. team settings inside `/customer/profile` vs. `/customer/join-team` public invite accept)
- **AI agent surfaces** (`secretary.js` for inbound phone/SMS vs. `virtual-tryon.js` for material visualization vs. any customer-facing `rover-assistant.js` or chat surface)
- **CRM monolith** (`crm-module.js` is ~366 KB / ~5,055 lines and renders 10+ feature sub-pages — treat this as a special case and describe which sub-pages it contains and which are genuinely distinct vs. artificially split)

For each cluster, the table should have columns: **Location | What you see | Frontend file | Entry point URL**.

### 1.5 Routes with no sidebar entry (orphans)
Using `src/index.tsx` route registrations (grep for `app.get('/customer/`), list every customer page route that is registered but **not** linked from the sidebar. Candidates include `/customer/3d-viewer`, `/customer/property-imagery`, `/customer/solar-design`, `/customer/design-builder`, `/customer/virtual-tryon`, `/customer/secretary`, `/customer/storm-scout`, `/customer/d2d`, `/customer/team`, `/customer/team-management`. For each, say how it's actually reached (deep link from another page? Never?) and whether it should be kept or deleted.

### 1.6 File-size scoreboard
One table, sorted descending by size, of every customer-facing frontend file in `public/static/`. Columns: **File | Size (KB) | Line count | Purpose | Is it reachable from the sidebar?** Flag files >100 KB. Explicitly call out `crm-module.js` as the monolith and discuss whether it should be split or kept.

### 1.7 The scoreboard (summary bullet list, parallel to Section 1.6 of the super-admin plan)
End the Diagnosis with a compact scoreboard exactly in this style:
- **N** page shells the customer moves between
- **N** sidebar items (+ N mobile tabs + N footer links)
- **N** distinct places to view orders, **N** for invoices, **N** for proposals
- **N** places new communications / leads can arrive, **0** unified inbox
- **N** separate marketing / integration tools
- **N** settings surfaces
- `crm-module.js` is **N lines / N KB** — the second-biggest customer file after `proposal-builder.js` at **N KB**
- **N** total customer JS in `public/static/` across **N** files

Numbers come from actual reads of the codebase, not estimates.

---

## Phase 2 — The Plan (the "Plan" section)

**Goal:** Section 2 of the doc. Mirror Section 2 of the super-admin plan exactly in format.

### 2.1 Propose a new sidebar
Target **5–6 top-level sections** (not 26). The strongest candidate grouping to start from — validate against your diagnosis and adjust if a better split falls out of the data:

```
/customer
 ├── Home            (at-a-glance overview + unread inbox badge + quick actions)
 ├── Leads           (unified inbox: widget, D2D, Storm Scout, secretary, lead-capture, email replies)
 ├── Jobs            (customers, pipeline, jobs, invoices, proposals, commissions — the CRM)
 ├── Tools           (order report, design/visualize, material calc, material catalog, suppliers)
 ├── Marketing       (website builder, email outreach, Google Ads, Google Business, Meta, storm alerts, referrals)
 └── Settings        (profile, team, billing/credits, secretary config, integrations, branding)
```

If your diagnosis surfaces a better grouping, propose that instead and defend it in one paragraph. Section names must be nouns, plural or abstract, ≤12 chars each.

### 2.2 Section-by-section consolidation (A through F)
One H4 per section. For each section:
- **What goes in it** (as tabs/subtabs, mapped 1:1 to current sidebar items)
- **The unified-inbox / unified-view argument**, if the section consolidates multiple surfaces (e.g., Leads is the customer-side equivalent of the super-admin Inbox — and it's the biggest win here too)
- **Backend changes required** (new aggregator endpoints, new tables for read-state, etc.)
- **Frontend changes required** (new views or splits of `crm-module.js`)
- **Kill list** — the sidebar items and files this section obsoletes

The "Leads" section (the customer's unified inbox) should be the marquee section and should get the same level of detail as the super-admin "Inbox" section. Define the `lead` / `conversation` union type: `channel ∈ {web_chat, voice_call, sms, voicemail, d2d_appointment, storm_alert, form_submission, email_reply, crm_job_message}`, `status ∈ {new, contacted, qualified, won, lost}`, backed by a new `GET /api/customer/leads` aggregator endpoint and a `customer_lead_read_state` table. Spell out the adapter functions that pull from each existing table.

The "Jobs" section should address the `crm-module.js` monolith explicitly: propose whether to keep it as one file with cleaner internal routing, or split it into `customers.js`, `pipeline.js`, `jobs.js`, `invoices.js`, `proposals.js`. Justify the choice by bundle size and load-time implications on Cloudflare Workers / customer devices (some customers are on iOS via Capacitor).

The "Tools" section should resolve the proposal/design UX fracture. Propose one of two options and pick one: (a) a single "Create" surface with sub-tools, or (b) contextual tools that live inside a Job record so a customer never clicks "Proposal Builder" standalone — they always start from a job.

The "Marketing" section should group all outbound/integration tools and explicitly propose that each integration (Google Ads, Google Business, Meta Connect) collapses to one page with a "Connected" / "Not connected" state card rather than a full sidebar entry each.

The "Settings" section should collapse `/customer/profile` + `/customer/team-management` + supplier/catalog/referrals + tool-specific settings + secretary config + branding + billing into one tabbed page. Call out that the solar-vs-roofing toggle should become a real setting stored server-side, not a render-time branch.

### 2.3 Global patterns (parallel to Section 2.3 of the super-admin plan)
List the cross-cutting UX improvements:
1. Global unread badge cluster in the top bar (new leads, unpaid invoices, pending approvals).
2. `⌘K` command palette for jumping to a customer / job / report / invoice / proposal. Mandatory given the number of destinations.
3. No more cross-shell reloads. All six sections live inside the same SPA shell; `/customer/secretary`, `/customer/team-dashboard`, `/customer/virtual-tryon`, etc. either redirect to a tab within the new shell or get deleted.
4. Consistent URL scheme: `/customer/<section>/<tab>[/<id>]` so back-button and linkability work.
5. Solar-vs-roofing is a server-side `company_type` that reshapes sections, not a sprinkling of `if (solar)` in the sidebar render.
6. Team role gating happens at the section level, not the per-page level — a "Crew" role sees Home + Jobs, an "Owner" sees all six.

---

## Phase 3 — Deep Analysis of the Plan Against the Codebase (the "Implementation" sections)

Now go back to the code one more time and produce the last three sections of the doc. This is where you verify the plan is actually buildable.

### 3.1 What this kills vs. keeps
Mirror Section 3 of the super-admin plan. Two subsections:
- **Sidebar items eliminated** — list every one of the ~26 current sidebar items and exactly which new section / tab it becomes. A bulleted list that reads like a migration map.
- **Files eliminated or merged** — for every frontend JS file >10 KB, state: keep as-is / merge into X / split into X+Y / delete entirely. Same for every route file in `src/routes/` that is purely customer-facing.

### 3.2 Implementation phases
Mirror Section 4 of the super-admin plan. Produce 5–6 phases, each with **Scope / Effort / Unblocks**:

- **Phase 1 — Unified Leads Inbox.** The `GET /api/customer/leads` aggregator + new Leads view + unread badge. Biggest pain killed fastest. 3–5 days.
- **Phase 2 — Split `crm-module.js`.** Purely mechanical refactor, no UX change, unblocks all subsequent work. 2–3 days.
- **Phase 3 — Merge Marketing surfaces.** One Marketing section with integration cards. 2–3 days.
- **Phase 4 — Merge Tools / Design / Visualizer surfaces.** The proposal-builder UX resolution. 3–5 days.
- **Phase 5 — Settings consolidation + Team rework.** One settings page, team role gating. 3–4 days.
- **Phase 6 — Delete old routes, redirect orphans, rename URLs to `/customer/<section>/<tab>`. Cleanup of dead code. 2–3 days.

Explicitly state: **Phase 1 alone delivers the user's actual complaint** — i.e., "my customers can't find leads / messages in the dashboard" — in under a week.

### 3.3 Concrete files to touch
Mirror Section 5 of the super-admin plan as a table: **Change | File (with line numbers if the change is local)**. Cover:
- New leads aggregator endpoint (route file + line range to add after)
- New `src/services/customer-lead-aggregator.ts`
- New migration for `customer_lead_read_state`
- Sidebar rewrite in `public/static/customer-dashboard.js` lines 274–351
- Split points for `public/static/crm-module.js`
- Files to delete (e.g., redundant duplicates — but ONLY list; do not delete)
- Router redirects in `src/index.tsx` for orphaned `/customer/*` routes

### 3.4 What success looks like
Mirror Section 6 of the super-admin plan. One paragraph: before vs. after, in the same "6 items, one inbox, one URL" style. End with the single sentence: *"The customer's actual complaint — 'I can't find my leads / messages / jobs' — resolves to a single click on 'Leads' (Phase 1)."*

---

## Rules of engagement

1. **No source-code edits.** The only writes allowed during this task are to `CUSTOMER-DASHBOARD-SIMPLIFICATION-PLAN.md` (and optionally `CUSTOMER-DASHBOARD-FILE-MAP.md` as a companion index). If you need to read a file to verify a line number or count, use Read — do not Edit.
2. **Exact line numbers.** Every file citation must include a line range. If a line range is not feasible (whole-file reference), give the file size in KB and line count.
3. **Match the template voice.** Short declarative sentences. Tables where a list would be longer than 4 items. Scoreboard bullets at the end of the diagnosis. No fluff. No marketing language. Read `SUPER-ADMIN-SIMPLIFICATION-PLAN.md` as a style guide before writing.
4. **Use actual counts, not ranges or approximations.** If the sidebar has 26 items, say 26, not "about 25". If `crm-module.js` is 366 KB, say 366 KB. Grep and `wc -l` liberally.
5. **Front-load the pain.** The diagnosis section exists to make the reader (Ethan, the user) feel the problem in the first 30 seconds. Don't bury the scoreboard.
6. **Phase 1 must be shippable standalone.** Do not design a plan that requires Phases 2–6 before a single user benefit lands. The unified Leads inbox must be deployable on its own.
7. **Stop and ask** if something in the code contradicts an assumption in this prompt (for example, if there's no `crm-module.js` monolith, or if the sidebar has dramatically more or fewer items than expected). Do not paper over disagreements between this prompt and the codebase.

## Deliverable

One file: `CUSTOMER-DASHBOARD-SIMPLIFICATION-PLAN.md` in the repo root, sibling to `SUPER-ADMIN-SIMPLIFICATION-PLAN.md`, ~5,000–8,000 words, same structure as the super-admin plan, ready for Ethan to read top-to-bottom and approve a phase.

Begin now with Phase 1 — Deep Analysis.
