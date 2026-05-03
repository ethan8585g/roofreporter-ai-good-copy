# Customer Dashboard Simplification Plan

**Author:** Claude analysis for Ethan
**Date:** 2026-04-19
**Scope:** `/customer/*` — everything behind the logged-in customer portal
**Problem statement:** *"Customers can't find their leads, messages, jobs, or invoices. The dashboard has too many sidebar items, too many standalone pages with different navigation, and no unified inbox. CRM module is a 366 KB monolith."*

---

## 1. Why it feels this complex (diagnosis)

The customer portal grew feature-by-feature. Each new capability got its own sidebar item or its own standalone page with a different header. The result is 3 page shells, 22 sidebar items, 12 mobile tabs, and zero unified inboxes.

### 1.1 Three page shells the customer moves between

| Shell | Nav style | Routes using it | Frontend file | Size |
|---|---|---|---|---|
| **Main Dashboard** (`/customer/dashboard`) | Left sidebar + mobile horizontal tabs | 1 route | `customer-dashboard.js` | 84 KB / 1,356 lines |
| **CRM Sub-Page** (`getCrmSubPageHTML()` in `src/index.tsx` L13423–13476) | Header-only (logo + "Dashboard" + "Logout") | 10 routes: reports, customers, invoices, proposals, jobs, pipeline, commissions, email-outreach, suppliers, catalog, referrals | `crm-module.js` | 366 KB / 5,055 lines |
| **Standalone Pages** (each has its own `getXxxPageHTML()` function) | Unique header per page, no sidebar | 23+ routes | 23+ separate JS files | ~1,409 KB combined |

Moving from the dashboard to any CRM page (e.g. `/customer/invoices`) does a full page reload into a completely different shell — no sidebar, different header, different nav. Moving from there to `/customer/secretary` is another full reload into a third shell. There is no shared navigation spine.

### 1.2 The sidebar — 22 items + 12 mobile tabs + 2 footer links

The sidebar is defined in `public/static/customer-dashboard.js` L274–351. The mobile horizontal nav is at L354–370.

**Desktop sidebar items (22):**

| # | Section | Label | Route | Solar-only? |
|---|---|---|---|---|
| 1 | REPORTS | Order New Report / Order New Solar Proposal | `/customer/order` | Label varies |
| 2 | REPORTS | Design Builder | `/customer/design-builder` | Yes |
| 3 | REPORTS | Report History | `/customer/reports` | No |
| 4 | CRM | Customers | `/customer/customers` | No |
| 5 | CRM | Invoices | `/customer/invoices` | No |
| 6 | CRM | Proposals | `/customer/proposals` | No |
| 7 | CRM | Job & Crew Hub | `/customer/jobs` | No |
| 8 | CRM | Certificate Automations | `/customer/certificate-automations` | No |
| 9 | CRM | Pipeline | `/customer/pipeline` | No |
| 10 | CRM | Commissions | `/customer/commissions` | No |
| 11 | CRM | Solar Sales Pipeline | `/customer/solar-pipeline` | Yes |
| 12 | TEAM | Sales Team | `/customer/team` | No |
| 13 | TEAM | D2D Manager | `/customer/d2d` | No |
| 14 | STORM SCOUT | Storm Scout | `/customer/storm-scout` | No |
| 15 | SERVICES | Roofer Secretary / Solar Sales Secretary | `/customer/secretary` | Label varies |
| 16 | TOOLS | Material Calculator | `/customer/material-calculator` | No |
| 17 | TOOLS | Suppliers | `/customer/suppliers` | No |
| 18 | TOOLS | Catalog | `/customer/catalog` | No |
| 19 | TOOLS | Referrals | `/customer/referrals` | No |
| 20 | TOOLS | Email Outreach | `/customer/email-outreach` | No |
| 21 | TOOLS | AI Website Builder | `/customer/website-builder` | No |
| — | Footer | Buy Credits / Subscribe | `/pricing` or inline | No |
| — | Footer | Account Settings | `/customer/profile` | No |

**Total: 21 nav items + 1 solar-only item (22 max) + 2 footer links = 24 clickable destinations.**

**Mobile horizontal tabs (12):** Order, Reports, Customers, Invoices, Proposals, Jobs, Team, D2D, Storm, Secretary, Materials, Visualizer. Six desktop sidebar items have no mobile tab equivalent: Certificate Automations, Pipeline, Commissions, Solar Sales Pipeline, Suppliers, Catalog, Referrals, Email Outreach, AI Website Builder. One mobile tab — Visualizer (`/customer/virtual-tryon`) — has no desktop sidebar entry.

### 1.3 The "where are my new leads / messages / jobs" problem

An inbound communication or new lead for a customer can land in any of these places:

| # | Source | Backend endpoint / route file | Where it surfaces in UI | Unread badge? |
|---|---|---|---|---|
| 1 | Rover chat widget on customer's website | `POST /api/rover/chat` → `src/routes/rover.ts` | Rover assistant floating bubble — no list view | No |
| 2 | Secretary inbound phone call | `GET /api/secretary/calls` → `src/routes/secretary.ts` | `/customer/secretary` standalone page, "Call Log" section | Badge shows call count |
| 3 | Secretary SMS | Secretary config in same page | `/customer/secretary` standalone page | No distinct badge |
| 4 | Secretary voicemail / callback | Secretary callbacks | `/customer/secretary` standalone page | No |
| 5 | D2D door-knock appointment | `POST /api/d2d/appointments` → `src/routes/d2d.ts` | `/customer/d2d` standalone page, appointments tab | No |
| 6 | Storm Scout hail alert | `GET /api/storm-scout/alerts` → `src/routes/storm-scout.ts` | `/customer/storm-scout` standalone page | Static "New" badge |
| 7 | Lead-capture form (asset report) | `POST /api/asset-report/lead` → `src/routes/lead-capture.ts` L48 | **No customer-facing list view** | No |
| 8 | Lead-capture form (contact) | `POST /api/contact/lead` → `src/routes/lead-capture.ts` L90 | **No customer-facing list view** | No |
| 9 | Lead-capture form (condo) | `POST /api/condo-lead` → `src/routes/lead-capture.ts` L135 | **No customer-facing list view** | No |
| 10 | Widget estimate submissions | `POST /public/estimate` → `src/routes/widget.ts` L91 | `/customer/widget-leads` standalone page | No |
| 11 | CRM job messages / crew chat | `GET /api/crm/jobs/:jobId/messages` → `src/routes/crm.ts` L1799 | Only visible inside a specific job detail in `/customer/jobs` | No |
| 12 | Email Outreach replies / bounces | `src/routes/email-outreach.ts` | `/customer/email-outreach` CRM sub-page, analytics view | No |
| 13 | Push notifications | `src/routes/push.ts` | Browser push — no in-app list | No |

**Verdict: 13 entry points, 0 unified inboxes, 1 unread badge (secretary call count).**

A customer who wants to answer "do I have any new leads?" must check 6 different pages. Three lead sources (lead-capture forms) have **no customer-facing list view at all**.

### 1.4 Duplicate / overlapping destinations

#### Orders / Reports

| Location | What you see | Frontend file | Entry point |
|---|---|---|---|
| Dashboard main hub | Order badges (pending/completed counts) | `customer-dashboard.js` L385 | `/customer/dashboard` |
| Order New Report (sidebar) | Full order form | `customer-order.js` (104 KB) | `/customer/order` |
| Report History (sidebar → CRM shell) | Completed report list | `crm-module.js` L193–237 | `/customer/reports` |
| Mobile "Reports" tab | Same as Report History | `crm-module.js` | `/customer/reports` |
| Mobile "Order" tab | Same as order form | `customer-order.js` | `/customer/order` |

3 distinct surfaces for orders/reports (dashboard badge, order form, report list).

#### Invoices / Billing

| Location | What you see | Frontend file | Entry point |
|---|---|---|---|
| Dashboard main hub | Invoice owing badge `$X` | `customer-dashboard.js` L267 | `/customer/dashboard` |
| Invoices (sidebar → CRM shell) | Full invoice list + create/send | `crm-module.js` L405–782 | `/customer/invoices` |
| Invoice Manager (standalone) | Heavy invoice editor | `invoice-manager.js` (71 KB) | `/customer/invoice-manager` |
| Customer Invoice view | Single invoice viewer | `customer-invoice.js` (9 KB) | `/customer/invoice/:id` |
| CRM Proposals → accepted → "Create Invoice" | Inline invoice creation from proposal | `crm-module.js` L784+ | `/customer/proposals` |

4 distinct surfaces touching invoices.

#### Proposals / Designs / Visualizers

| Location | What you see | Frontend file | Entry point |
|---|---|---|---|
| Proposals (sidebar → CRM shell) | Proposal list | `crm-module.js` L784–1620 | `/customer/proposals` |
| Proposal Builder (standalone) | Full proposal editor | `proposal-builder.js` (182 KB) | `/customer/proposal-builder` |
| Design Builder (sidebar, solar-only) | Roof design tool | `design-builder.js` (8 KB) | `/customer/design-builder` |
| Solar Design (standalone) | Solar panel layout | `solar-design.js` (62 KB) | `/customer/solar-design` |
| Virtual Try-On (mobile tab only) | Material visualizer | `virtual-tryon.js` (48 KB) | `/customer/virtual-tryon` |
| Home Designer (standalone) | AI home visualization | `home-designer.js` (50 KB) | `/customer/home-designer` |
| Material Calculator (sidebar) | Take-off calculator | `material-calculator.js` (64 KB) | `/customer/material-calculator` |
| 3D Viewer (standalone) | 3D roof model | `roof-3d-viewer.js` (12 KB) | `/customer/3d-viewer` |

**8 surfaces** related to proposals, designs, and visualization. A customer building a proposal might touch 4 of these in a single workflow.

#### Dashboards / Overview surfaces

| Location | What you see | Frontend file | Entry point |
|---|---|---|---|
| Main dashboard | Overview hub (calendar, badges, quick actions) | `customer-dashboard.js` | `/customer/dashboard` |
| Team Dashboard | Team performance metrics | `team-dashboard.js` (30 KB) | `/customer/team-dashboard` |
| Pipeline (CRM shell) | Kanban-style pipeline view | `crm-module.js` L4411–4660 | `/customer/pipeline` |
| Commissions (CRM shell) | Sales commission analytics | `crm-module.js` L4669–5053 | `/customer/commissions` |
| Email Outreach (CRM shell) | Campaign analytics | `crm-module.js` L4055–4200 | `/customer/email-outreach` |

5 analytics/overview surfaces.

#### Settings

| Location | What you see | Frontend file | Entry point |
|---|---|---|---|
| Account Settings (footer link) | Profile, password, billing | `customer-profile.js` (28 KB) | `/customer/profile` |
| Theme toggle (dashboard header) | Light/dark toggle | `customer-dashboard.js` L382 | `/customer/dashboard` |
| Suppliers (sidebar → CRM shell) | Supplier management | `crm-module.js` L2748–2980 | `/customer/suppliers` |
| Catalog (sidebar → CRM shell) | Material catalog | `crm-module.js` L3892–4053 | `/customer/catalog` |
| Referrals (sidebar → CRM shell) | Referral program | `crm-module.js` L3783–3890 | `/customer/referrals` |
| Widget config (standalone) | Embed widget settings | Widget inline (15 KB fn) | `/customer/widget` |
| Secretary config (standalone) | Phone number, greeting, etc. | `secretary.js` (151 KB) | `/customer/secretary` |
| Google Ads config (standalone) | Ad account connection | `google-ads.js` (13 KB) | `/customer/google-ads` |
| Google Business config (standalone) | GMB connection | `google-business.js` (17 KB) | `/customer/google-business` |
| Website Builder settings (standalone) | Site config | `website-builder.js` (44 KB) | `/customer/website-builder` |
| Select Company Type (standalone) | Solar vs. roofing toggle | Inline | `/customer/select-type` |

**11 settings surfaces** scattered across sidebar items, standalone pages, and inline toggles. No single "Settings" page.

#### Marketing / Integrations

| Location | What you see | Frontend file | Entry point |
|---|---|---|---|
| Email Outreach | Email campaigns | `crm-module.js` L4055 | `/customer/email-outreach` |
| AI Website Builder | Website editor | `website-builder.js` (44 KB) | `/customer/website-builder` |
| Google Ads | Ad management | `google-ads.js` (13 KB) | `/customer/google-ads` |
| Google Business | GMB profile | `google-business.js` (17 KB) | `/customer/google-business` |
| Storm Scout | Lead-gen alerts | `storm-scout-module.js` (46 KB) | `/customer/storm-scout` |
| Referrals | Referral program | `crm-module.js` L3783 | `/customer/referrals` |

6 separate sidebar/page entries for outbound marketing. Each is its own page shell.

#### Team

| Location | What you see | Frontend file | Entry point |
|---|---|---|---|
| Sales Team (sidebar) | Team members, invite | `team-management.js` (29 KB) | `/customer/team` |
| Team Dashboard (standalone) | Performance metrics | `team-dashboard.js` (30 KB) | `/customer/team-dashboard` |
| Join Team (public) | Accept invite | Inline | `/customer/join-team` |
| Team context banner (dashboard) | Team role indicator | `customer-dashboard.js` L405 | `/customer/dashboard` |
| Commissions (CRM shell) | Team commission tracking | `crm-module.js` L4669 | `/customer/commissions` |

4 surfaces touching team (excluding public join page).

#### CRM monolith — `crm-module.js`

366 KB / 5,055 lines. Contains 13 sub-modules:

| Sub-module | Init function | Line range | Purpose |
|---|---|---|---|
| Reports | `initReports()` | L193–237 | Report history list |
| Customers | `initCustomers()` | L239–403 | Customer list + add/edit |
| Invoices | `initInvoices()` | L405–782 | Invoice CRUD + send |
| Proposals | `initProposals()` | L784–1620 | Proposal list + detail |
| Jobs | `initJobs()` | L1622–2746 | Job board + dispatch + calendar + crew chat |
| Suppliers | `initSuppliers()` | L2748–2980 | Supplier management |
| Crew Manager | `initCrewManager()` | L2982–3781 | Crew dispatch + GPS tracking |
| Referrals | `initReferrals()` | L3783–3890 | Referral program |
| Catalog | `initCatalog()` | L3892–4053 | Material catalog |
| Email Outreach | `initEmailOutreach()` | L4055–4200 | Campaign management |
| Pipeline | `initPipeline()` | L4411–4660 | Sales pipeline kanban |
| D2D | `initD2D()` | L4661–4664 | **Redirect only** — sends to `/customer/d2d` standalone page |
| Commissions | `initCommissions()` | L4669–5053 | Sales & commissions dashboard |

The Jobs sub-module alone is **1,124 lines** (L1622–2746). Proposals is 836 lines. The entire file is loaded on every CRM sub-page even when only one module is rendered. D2D is a 4-line redirect stub — the real D2D page is standalone (`d2d-module.js`, 106 KB).

### 1.5 Routes with no sidebar entry (orphans)

| Route | Registered at | How reached | Verdict |
|---|---|---|---|
| `/customer/3d-viewer` | `src/index.tsx` L2487 | Deep link from report detail | Keep (contextual tool) |
| `/customer/property-imagery` | L2431 | Deep link from report/order | Keep (contextual tool) |
| `/customer/solar-design` | L2469 | Unknown — no sidebar or link found | Delete or merge into Design Builder |
| `/customer/design-builder` | L2472 | Sidebar (solar-only) | Keep |
| `/customer/virtual-tryon` | L2484 | Mobile tab only, no desktop sidebar | Keep — add to sidebar or merge |
| `/customer/home-designer` | Not registered as route (file exists) | Unknown | Investigate — orphaned? |
| `/customer/secretary` | L3556 | Sidebar "Roofer Secretary" | Keep |
| `/customer/storm-scout` | L3550 | Sidebar "Storm Scout" | Keep |
| `/customer/d2d` | L3545 | Sidebar "D2D Manager" | Keep |
| `/customer/team-dashboard` | L2620 | No sidebar entry — deep link from `/customer/team`? | Merge into Team |
| `/customer/team-management` | Not separate from `/customer/team` | Same page | N/A |
| `/customer/proposal-builder` | L2606 | Deep link from proposal detail | Keep (contextual tool) |
| `/customer/invoice-manager` | L2612 | Deep link from invoice detail | Keep (contextual tool) |
| `/customer/widget` | L2455 | No sidebar entry | Merge into Settings |
| `/customer/widget-leads` | L2456 | No sidebar entry | Merge into Leads |
| `/customer/select-type` | L2466 | Shown during onboarding | Keep (onboarding only) |
| `/customer/solar-pipeline` | L2475 | Sidebar (solar-only) | Merge into Pipeline |
| `/customer/solar-presentation` | L2476 | Deep link from solar proposal | Keep (contextual) |
| `/customer/solar-documents` | L2477 | Deep link from solar job | Keep (contextual) |
| `/customer/solar-permits` | L2478 | Deep link from solar job | Keep (contextual) |
| `/customer/google-ads` | L2453 | No sidebar entry | Merge into Marketing |
| `/customer/google-business` | L2454 | No sidebar entry | Merge into Marketing |
| `/customer/certificate-automations` | L2457 | Sidebar "Certificate Automations" | Keep |
| `/customer/join-team` | L2623 | Public invite link | Keep |
| `/customer/branding` | Not registered | N/A | Does not exist |
| `/customer/cold-call` | Not registered | API exists (`customer-cold-call.ts`), no page | Build or skip |

12 routes have no desktop sidebar entry but are registered. 3 lead sources have no customer-facing UI at all.

### 1.6 File-size scoreboard

Customer-facing frontend files in `public/static/`, sorted descending:

| File | Size (KB) | Lines | Purpose | Sidebar entry? |
|---|---|---|---|---|
| **crm-module.js** | **366** | **5,055** | 13 CRM sub-modules (monolith) | Yes (10 sidebar items use it) |
| **proposal-builder.js** | **182** | **2,541** | Proposal editor | No (deep link) |
| **secretary.js** | **151** | **2,226** | AI phone receptionist config + call log | Yes |
| **d2d-module.js** | **105** | **1,995** | Door-to-door manager with maps | Yes |
| **customer-order.js** | **104** | **2,168** | Report order form | Yes |
| customer-dashboard.js | 84 | 1,356 | Main dashboard shell | — (IS the shell) |
| email-outreach.js | 75 | 1,459 | Email campaign manager | Yes (CRM sub-page) |
| invoice-manager.js | 71 | 1,082 | Invoice editor | No (deep link) |
| material-calculator.js | 64 | 1,148 | Material take-off calculator | Yes |
| solar-design.js | 62 | 1,284 | Solar panel layout tool | No (orphan?) |
| customer-cold-call.js | 57 | 934 | Cold-call dialer | No (unregistered) |
| home-designer.js | 50 | 926 | AI home visualization | No (orphan?) |
| virtual-tryon.js | 48 | 864 | Material visualizer | Mobile tab only |
| storm-scout-module.js | 46 | 1,041 | Storm alert map + lead gen | Yes |
| meta-connect.js | 45 | 647 | Meta/Facebook integration | No (super-admin only) |
| website-builder.js | 44 | 776 | AI website builder | Yes |
| certificate-automations.js | 33 | 555 | Certificate generation | Yes |
| onboarding-wizard.js | 33 | 507 | Customer onboarding flow | No (onboarding only) |
| sam3-analyzer.js | 30 | 617 | SAM3 roof analysis | No (embedded) |
| team-dashboard.js | 30 | 522 | Team performance | No (orphan) |
| team-management.js | 29 | 519 | Team member management | Yes |
| customer-profile.js | 28 | 458 | Profile / account settings | Footer link |
| branding.js | 23 | 403 | Branding settings | No (orphan?) |
| rover-assistant.js | 21 | 670 | Chat assistant bubble | Embedded on CRM pages |
| google-business.js | 17 | 399 | Google Business Profile | No sidebar |
| solar-pipeline.js | 16 | 296 | Solar sales pipeline | Yes (solar-only) |
| property-imagery.js | 14 | 342 | Property satellite imagery | No (deep link) |
| google-ads.js | 13 | 275 | Google Ads manager | No sidebar |
| roof-3d-viewer.js | 12 | 326 | 3D roof model viewer | No (deep link) |
| solar-permits.js | 10 | 159 | Solar permit tracker | No (deep link) |
| solar-presentation.js | 10 | 140 | Solar presentation builder | No (deep link) |
| solar-documents.js | 10 | 154 | Solar document manager | No (deep link) |
| customer-invoice.js | 9 | 182 | Single invoice viewer | No (deep link) |
| design-builder.js | 8 | 121 | Design builder launcher | Yes (solar-only) |
| solar-calculator.js | 7 | 147 | Solar savings calculator | No (embedded) |

### 1.7 The scoreboard

- **3** page shells the customer moves between (dashboard sidebar, CRM header-only, standalone pages)
- **22** desktop sidebar items + **12** mobile tabs + **2** footer links = **36** clickable destinations
- **3** distinct surfaces for orders/reports, **4** for invoices, **8** for proposals/designs/visualization
- **13** places new leads or communications can arrive, **0** unified inboxes, **1** unread badge (secretary only)
- **6** separate marketing / integration pages, each with its own shell
- **11** settings surfaces scattered across the portal
- `crm-module.js` is **5,055 lines / 366 KB** — the biggest customer file; `proposal-builder.js` at **182 KB** is second
- **1,859 KB** total customer JS in `public/static/` across **34** files

---

## 2. The plan — collapse 36 destinations into 6

Target: one customer URL root (`/customer`), one sidebar, **6 top-level sections**, each with tabs. Everything else becomes a tab, subtab, contextual tool inside a job, or gets deleted.

### 2.1 The new sidebar (6 items, not 22)

```
/customer
 ├── Home            (overview + unread badge + quick actions + calendar)
 ├── Leads           (unified inbox: widget, D2D, storm, secretary, lead-capture, email replies)
 ├── Jobs            (customers, pipeline, jobs, invoices, proposals, commissions, certificates)
 ├── Tools           (order report, design/visualize, material calc, 3D viewer)
 ├── Marketing       (website builder, email outreach, Google Ads, Google Business, storm alerts, referrals)
 └── Settings        (profile, team, billing/credits, secretary config, widget config, branding)
```

Six clicks away from everything. Each section is a tabbed page inside the same SPA shell. No more cross-shell reloads.

### 2.2 Section-by-section consolidation

#### A) Leads — the biggest win

**One page, one unread count, one timeline.** Collapses widget submissions + D2D appointments + secretary calls/SMS/voicemails + lead-capture form submissions + storm scout alerts + email outreach replies + CRM job messages into a single "Leads" list.

Tabs: `All` · `Calls` · `Messages` · `Forms` · `Appointments` · `Alerts`

Unified data model: a `lead` has a `channel` ∈ {web_widget, voice_call, sms, voicemail, d2d_appointment, storm_alert, form_submission, email_reply, crm_job_message}, a `status` ∈ {new, contacted, qualified, won, lost}, and a `read` flag per customer user.

- Single list view with filters: channel, status, unread, date range, assigned team member.
- Detail pane on the right with the full conversation/history and action buttons (reply, convert to job, assign, archive).
- Global unread badge shown in the top bar of every page.

**Backend changes required:**
- New unified endpoint: `GET /api/customer/leads` returning leads across all channels, with a single `last_activity_at`, `unread`, `channel`, `contact_name`, `contact_info` shape.
- Adapter functions that pull from:
  - `widget_leads` table (via `src/routes/widget.ts` `GET /api/widget/leads`)
  - `d2d_appointments` table (via `src/routes/d2d.ts` `GET /api/d2d/appointments`)
  - Secretary call logs (via `src/routes/secretary.ts` `GET /api/secretary/calls`)
  - `asset_report_leads` + `contact_leads` tables (via `src/routes/lead-capture.ts`)
  - Storm scout alerts (via `src/routes/storm-scout.ts` `GET /api/storm-scout/alerts`)
  - `crew_messages` table (via `src/routes/crm.ts` `GET /api/crm/jobs/:jobId/messages`)
  - Email outreach bounce/reply events (via `src/routes/email-outreach.ts`)
- New `customer_lead_read_state` table: `(lead_id TEXT, lead_channel TEXT, customer_id INTEGER, read_at TEXT, PRIMARY KEY (lead_id, lead_channel, customer_id))`.

**Frontend changes required:**
- New `leads-inbox.js` view (or section within unified shell).
- `/customer/widget-leads` redirects to Leads → Forms tab.
- Secretary call log section in `/customer/secretary` stays for config, but the call list surfaces in Leads → Calls.
- D2D appointment list moves to Leads → Appointments. D2D map + turf management stays as a Tools subtool or standalone.

**Kill:** `/customer/widget-leads` as standalone page. Secretary call log as the primary discovery surface (it remains for config/playback but is no longer where you "check for new calls").

#### B) Jobs — the CRM core

Tabs: `Customers` · `Pipeline` · `Jobs` · `Invoices` · `Proposals` · `Commissions` · `Certificates`

This is the existing `crm-module.js` with a cleaner tab bar and embedded inside the unified shell instead of the separate CRM header shell.

**The crm-module.js monolith question:** Keep it as one file. Splitting 366 KB into 7 files saves nothing on initial load — the customer only navigates to one CRM page at a time, and each sub-module is already gated by the `MODULE` attribute (L10). The real problem is that it loads inside a *different shell* (header-only) instead of the dashboard sidebar shell. Fix the shell, not the file.

If bundle size becomes an issue on Capacitor/iOS, the split points are clean:
- `initReports()` L193 → could be lazy-loaded (it's only 44 lines).
- `initJobs()` + `initCrewManager()` L1622–3781 → the largest chunk (2,159 lines), could be a separate `jobs-core.js`.
- `initCommissions()` L4669–5053 → self-contained 384-line module.

But don't split preemptively. The 366 KB is minifiable to ~120 KB gzipped, well within Cloudflare's edge cache.

**Backend changes:** None for Phase 1. The existing CRM API endpoints in `src/routes/crm.ts` (157 KB / 3,010+ lines) stay as-is.

**Frontend changes:**
- Remove `getCrmSubPageHTML()` shell (L13423–13476). All CRM sub-pages render inside the unified dashboard shell.
- Add tab bar above `crm-root` div.
- Solar Sales Pipeline (`solar-pipeline.js`, 16 KB) merges into the Pipeline tab as a filter/toggle, not a separate page.

**Kill:** `getCrmSubPageHTML()` shell. `/customer/solar-pipeline` as separate page (becomes a toggle within Pipeline). Suppliers, Catalog, Referrals as CRM tabs — these move to Marketing (Referrals) and Tools (Suppliers, Catalog).

#### C) Tools — the build/measure/design surface

Tabs: `Order Report` · `Visualizer` · `Materials` · `Suppliers` · `Catalog`

**The proposal/design UX fracture resolution:** Contextual tools that live inside a Job record. A customer never clicks "Proposal Builder" standalone — they always start from a job or a customer record. The flow:

1. Customer opens Jobs → selects a job → clicks "Create Proposal" → opens proposal-builder in context (URL: `/customer/jobs/<id>/proposal`).
2. From a proposal, they can launch "Visualize" (virtual try-on), "3D View" (3D viewer), or "Design" (design builder) as modal overlays or subtabs within the proposal.
3. The standalone `/customer/proposal-builder`, `/customer/virtual-tryon`, `/customer/3d-viewer`, `/customer/design-builder`, `/customer/solar-design` routes become redirects into the contextual flow or remain as deep-link entry points that auto-open the tool with the right job context.

This resolves the 8-surface fragmentation into 2 surfaces: the Tools tab (for standalone material calculation and ordering) and the Job detail view (for proposal + visualization tools in context).

**Kill:** `/customer/home-designer` (orphaned, 50 KB), `/customer/solar-design` (merge into design-builder), `/customer/virtual-tryon` as sidebar-level destination (becomes a tool within proposals/jobs).

#### D) Marketing — outbound & integrations

Tabs: `Email Outreach` · `Website` · `Google Ads` · `Google Business` · `Storm Alerts` · `Referrals`

Each integration tab is a card with "Connected" / "Not connected" state at the top, then the tool's configuration/dashboard below. This replaces 6 separate sidebar items and standalone pages.

- Email Outreach moves from CRM shell to Marketing tab. Content stays identical (`initEmailOutreach()` in crm-module.js).
- Website Builder, Google Ads, Google Business each collapse from a standalone page to a tab. Their existing JS files load on-demand when the tab is selected.
- Storm Scout moves here because its primary value is lead generation, not inbox. The "new storm alert" notification feeds into Leads → Alerts.
- Referrals moves here from CRM (it's a growth/marketing tool, not a job management tool).

**Kill:** 6 sidebar items (Email Outreach, Website Builder, Google Ads, Google Business, Storm Scout, Referrals). Storm Scout standalone shell. Google Ads standalone shell. Google Business standalone shell.

#### E) Settings — one tabbed page

Tabs: `Profile` · `Team` · `Secretary` · `Widget` · `Billing` · `Branding`

- Profile: name, email, password, company info, notification preferences. Currently `/customer/profile`.
- Team: team members, roles, invites. Currently `/customer/team` + `/customer/team-dashboard` merged.
- Secretary: phone number, greeting, business hours, call routing. Currently embedded in `/customer/secretary` standalone page — the *config* portion moves here, the *call log* moves to Leads.
- Widget: embed code, styling, domain whitelist. Currently `/customer/widget` standalone page.
- Billing: credits, subscription, payment method. Currently bottom of `/customer/profile` + the dashboard footer.
- Branding: logo, colors, company branding. Currently scattered or in `branding.js` (orphaned).

**Critical fix:** The solar-vs-roofing toggle (currently `/customer/select-type`, a whole standalone page) becomes a dropdown in Profile → Company Info, stored server-side in `customer_companies.company_type`. No more render-time `if (company_type === 'solar')` sprinkled across the sidebar — the server includes the type in the session, and sections adapt.

**Team role gating** happens at the section level: a "Crew" role sees Home + Jobs, a "Sales Rep" sees Home + Jobs + Leads + Tools, an "Owner" sees all six. This replaces the current per-page role checks.

**Kill:** `/customer/profile` standalone page, `/customer/team` standalone page, `/customer/team-dashboard` standalone page, `/customer/widget` standalone page, `/customer/select-type` standalone page. All become tabs under Settings.

#### F) Home — the landing pad

The existing dashboard (`customer-dashboard.js`) stays as the Home section but gains:

- **Unread badge cluster** in the top bar: new leads count (from Leads aggregator), unpaid invoices count, jobs in progress count.
- **Quick actions** card: "Order Report", "Create Proposal", "View Leads" — three most common actions.
- **Calendar** stays (it's the most useful widget).
- **Recent activity** feed: last 5 leads + last 5 job updates, sourced from the Leads aggregator.

The dashboard no longer needs its own sidebar definition (L274–351) — the unified shell provides the sidebar for all 6 sections.

### 2.3 Global patterns

1. **Global unread badge cluster** in the top bar: new leads count, unpaid invoices, pending approvals. Visible on every section.
2. **`Cmd+K` command palette** for jumping to a customer / job / report / invoice / proposal by name or ID. With 36 destinations today this is mandatory; with 6 it becomes a power-user speedup.
3. **No more cross-shell reloads.** All six sections live inside the same SPA shell. `/customer/secretary`, `/customer/d2d`, `/customer/storm-scout`, etc. either become tabs within sections or load their content inside the unified shell's main area.
4. **Consistent URL scheme:** `/customer/<section>/<tab>[/<id>]` so back-button and deep-linking work. Examples: `/customer/leads/calls`, `/customer/jobs/pipeline`, `/customer/marketing/email-outreach`, `/customer/settings/team`.
5. **Solar-vs-roofing** is a server-side `company_type` that reshapes section labels and shows/hides solar-specific tabs. Not a sprinkling of `if (isSolar)` in the sidebar render.
6. **Team role gating** happens at the section level, not the per-page level. A "Crew" role sees Home + Jobs. An "Owner" sees all six. Defined in one place, not per-route.

---

## 3. What this kills vs. keeps

### Sidebar items eliminated (16 of 22 become tabs)

| Current sidebar item | New location |
|---|---|
| Order New Report | **Tools → Order Report** tab |
| Design Builder | **Tools → Visualizer** tab (solar) |
| Report History | **Jobs → Reports** subtab or Home → recent |
| Customers | **Jobs → Customers** tab |
| Invoices | **Jobs → Invoices** tab |
| Proposals | **Jobs → Proposals** tab |
| Job & Crew Hub | **Jobs → Jobs** tab |
| Certificate Automations | **Jobs → Certificates** tab |
| Pipeline | **Jobs → Pipeline** tab |
| Commissions | **Jobs → Commissions** tab |
| Solar Sales Pipeline | **Jobs → Pipeline** tab (solar filter) |
| Sales Team | **Settings → Team** tab |
| D2D Manager | **Leads → Appointments** tab + D2D map in Tools |
| Storm Scout | **Marketing → Storm Alerts** tab |
| Roofer Secretary | Config → **Settings → Secretary**; calls → **Leads → Calls** |
| Material Calculator | **Tools → Materials** tab |
| Suppliers | **Tools → Suppliers** tab |
| Catalog | **Tools → Catalog** tab |
| Referrals | **Marketing → Referrals** tab |
| Email Outreach | **Marketing → Email Outreach** tab |
| AI Website Builder | **Marketing → Website** tab |
| Account Settings (footer) | **Settings → Profile** tab |

### Files eliminated or merged

| File | Size | Action |
|---|---|---|
| `crm-module.js` | 366 KB | **Keep as-is** — loads inside unified shell instead of CRM header shell |
| `proposal-builder.js` | 182 KB | **Keep** — loaded on-demand from job detail |
| `secretary.js` | 151 KB | **Keep** — Settings → Secretary tab loads it. Call log portion feeds Leads. |
| `d2d-module.js` | 105 KB | **Keep** — D2D map stays as standalone tool, appointments feed Leads |
| `customer-order.js` | 104 KB | **Keep** — Tools → Order Report tab loads it |
| `customer-dashboard.js` | 84 KB | **Rewrite** — sidebar (L274–351) replaced by unified shell, rest becomes Home section |
| `email-outreach.js` | 75 KB | **Keep** — Marketing → Email Outreach tab loads it |
| `invoice-manager.js` | 71 KB | **Keep** — loaded on-demand from invoice detail |
| `material-calculator.js` | 64 KB | **Keep** — Tools → Materials tab loads it |
| `solar-design.js` | 62 KB | **Merge into design-builder.js** or delete if redundant |
| `customer-cold-call.js` | 57 KB | **Keep** — build page route when ready |
| `home-designer.js` | 50 KB | **Delete** — orphaned, no route, no sidebar, no link found |
| `virtual-tryon.js` | 48 KB | **Keep** — loaded contextually from proposals/jobs |
| `storm-scout-module.js` | 46 KB | **Keep** — Marketing → Storm Alerts tab loads it |
| `website-builder.js` | 44 KB | **Keep** — Marketing → Website tab |
| `certificate-automations.js` | 33 KB | **Keep** — Jobs → Certificates tab |
| `team-dashboard.js` | 30 KB | **Merge into team-management.js** — Settings → Team tab |
| `team-management.js` | 29 KB | **Keep** — Settings → Team tab, absorbs team-dashboard |
| `customer-profile.js` | 28 KB | **Keep** — Settings → Profile tab |
| `branding.js` | 23 KB | **Keep** — Settings → Branding tab |
| `google-business.js` | 17 KB | **Keep** — Marketing → Google Business tab |
| `solar-pipeline.js` | 16 KB | **Merge into crm-module.js Pipeline** — becomes a filter toggle |
| `google-ads.js` | 13 KB | **Keep** — Marketing → Google Ads tab |
| `rover-assistant.js` | 21 KB | **Keep** — embedded chat bubble, no change |

### Route files — no changes

All route files in `src/routes/` stay. This plan is mostly UI reorganization plus one new Leads aggregator endpoint. The API surface doesn't change.

---

## 4. Implementation phases

### Phase 1 — Unified Leads Inbox (the customer's actual complaint)

**Scope:** New `GET /api/customer/leads` aggregator endpoint that fans out to widget_leads + secretary calls + D2D appointments + lead-capture forms + storm alerts + job messages. New Leads view in the dashboard. Add unread badge to the top bar. Leaves existing pages intact — this is purely additive.

**Backend:**
- New `src/services/customer-lead-aggregator.ts` with adapter functions for each source table.
- New migration for `customer_lead_read_state` table.
- New route handler in `src/routes/crm.ts` or a new `src/routes/customer-leads.ts`.

**Frontend:**
- New leads inbox component (can be a new section in `customer-dashboard.js` or a new `leads-inbox.js`).
- Unread badge in the dashboard top bar.

**Effort:** 3–5 days. **Unblocks the biggest pain immediately.**

### Phase 2 — Unified Shell (merge 3 shells into 1)

**Scope:** Replace `getCrmSubPageHTML()` (L13423–13476) with a unified shell that uses the same sidebar as the dashboard. All CRM sub-pages render inside the dashboard layout instead of their own header-only shell. No CRM code changes — just the wrapping HTML.

**Effort:** 2–3 days. **Eliminates the jarring shell-switch on every navigation.**

### Phase 3 — Sidebar Collapse (22 → 6)

**Scope:** Rewrite sidebar in `customer-dashboard.js` L274–351 from 22 items to 6 sections. Each section click loads the appropriate tab view. Mobile nav L354–370 collapses similarly. Implement tab routing within each section.

**Effort:** 3–5 days. **The visual transformation — customers see a clean sidebar.**

### Phase 4 — Merge Marketing Surfaces

**Scope:** One Marketing section with 6 tabs. Each integration (Google Ads, Google Business, Website Builder, Email Outreach, Storm Scout, Referrals) becomes a tab that lazy-loads its existing JS file. Delete their standalone page shells in `src/index.tsx`.

**Effort:** 2–3 days.

### Phase 5 — Settings Consolidation + Team Merge

**Scope:** One Settings page with Profile, Team, Secretary (config only), Widget, Billing, Branding tabs. Merge `team-dashboard.js` into `team-management.js`. Move company-type toggle from `/customer/select-type` into Profile. Implement role-based section gating.

**Effort:** 3–4 days.

### Phase 6 — Cleanup + URL Scheme + Command Palette

**Scope:** Delete orphaned routes. Redirect old URLs (`/customer/reports` → `/customer/jobs/reports`). Implement `/customer/<section>/<tab>` URL scheme. Add `Cmd+K` command palette. Delete `home-designer.js` and other confirmed dead files.

**Effort:** 2–3 days.

**Total: ~3–5 weeks of focused work, but Phase 1 alone delivers the customer's actual complaint resolution in under a week.**

---

## 5. Concrete files to touch

| Change | File | Line range |
|---|---|---|
| New leads aggregator endpoint | New `src/routes/customer-leads.ts` or add to `src/routes/crm.ts` after L3010 | New file or ~50 lines |
| Leads adapter service | New `src/services/customer-lead-aggregator.ts` | New file, ~200 lines |
| `customer_lead_read_state` migration | New `migrations/0146_customer_lead_read_state.sql` | New file |
| Unified shell — replace CRM sub-page shell | `src/index.tsx` L13423–13476 (`getCrmSubPageHTML()`) | Rewrite ~50 lines |
| Sidebar rewrite (22 → 6) | `public/static/customer-dashboard.js` L274–351 | Rewrite ~80 lines |
| Mobile nav rewrite (12 → 6) | `public/static/customer-dashboard.js` L354–370 | Rewrite ~20 lines |
| Unread badge in top bar | `public/static/customer-dashboard.js` L376–387 (welcome header area) | Add ~15 lines |
| Solar Pipeline merge into Pipeline | `public/static/crm-module.js` L4411 (`initPipeline()`) | Add solar toggle, ~20 lines |
| Team dashboard merge | `public/static/team-management.js` | Absorb `team-dashboard.js` content |
| Standalone page routes → redirect to sections | `src/index.tsx` L2452–2478 (website-builder, google-ads, google-business, widget, widget-leads, etc.) | Add redirects |
| Delete orphaned files | `public/static/home-designer.js` (50 KB), `public/static/solar-design.js` (62 KB, if confirmed redundant) | Delete |
| Command palette | `public/static/customer-dashboard.js` | New ~100 lines |

---

## 6. What success looks like

**Before:** 22 sidebar items + 12 mobile tabs + 2 footer links across 3 different page shells, 13 places a new lead can land, 0 unified inboxes, and 8 surfaces to build a proposal.

**After:** 6 sidebar items, one Leads inbox with an unread badge, one SPA shell, one URL scheme (`/customer/<section>/<tab>`), one `Cmd+K` search. A new customer can look at the left edge of the screen and understand what the product does in 5 seconds: Home, Leads, Jobs, Tools, Marketing, Settings.

The customer's actual complaint — "I can't find my leads / messages / jobs" — resolves to a single click on "Leads" (Phase 1).
