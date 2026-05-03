# Super Admin Simplification Plan

**Author:** Claude analysis for Ethan
**Date:** 2026-04-18
**Scope:** `/super-admin`, `/admin`, `/admin/super` (BI Hub), and all related route files
**Problem statement (from user):** *"Super admin is way too complex. It's so hard to find new chats from people with the front end, analytics, BI analytics etc. Significantly simplify the super admin module and reduce the amount of different modules to access certain things."*

---

## 1. Why it feels this complex (diagnosis)

The admin area grew feature-by-feature. Each new capability got its own sidebar item or its own page instead of joining an existing home. The result is three parallel admin UIs and ~22 sidebar entries that overlap.

### 1.1 Three separate admin surfaces that all overlap

| URL | Name | Nav style | Items | File |
|---|---|---|---|---|
| `/super-admin` | Command Center | Left sidebar | **22 items** | `src/index.tsx` L4854–4957, `public/static/super-admin-dashboard.js` |
| `/admin` | Operations Panel | Top tabs | **13 tabs** | `public/static/admin.js` |
| `/admin/super` | BI Analytics Hub | Separate page | 7 widgets | `src/routes/super-admin-bi.ts` |

These three pages don't share navigation, don't share URLs, and don't share styling. Moving between them requires a full page reload. The sidebar has two links at the bottom that drop you into the other two pages (`BI Analytics Hub`, `Operations Panel`) — that's the giveaway that they were never really integrated.

### 1.2 The "where are my new chats" problem — 7 entry points

Right now an incoming *person-who-wants-to-talk-to-you* can land in any of these:

1. **Rover chat widget** on website → `/api/rover/admin/conversations` → surfaced as the "Rover Chat" tab on `/admin`
2. **Secretary phone call** → `/api/secretary/calls` → surfaced under `Roofer Secretary AI` on `/super-admin`
3. **Secretary SMS** → `/api/secretary/messages` → same place, different subtab
4. **Secretary voicemail/callback request** → `/api/secretary/callbacks` → same place, different subtab
5. **Superadmin cross-customer call feed** → `/api/admin/superadmin/secretary/calls` (admin.ts L1405) — a **second view** of the same call data
6. **Cold-call / call-center inbound** → `/api/call-center/*` → "AI Call Center" sidebar item
7. **Job messages** (CRM) → `/api/crm/jobs/:jobId/messages` — only reachable by opening a specific job
8. **Lead capture form submissions** → `/api/lead-capture/*` — **no admin list view exists at all**

There is no unified inbox, no unread count, no single place that says "3 new". The data exists; the UI doesn't.

### 1.3 Analytics is split across four surfaces

| Surface | What it shows | Route |
|---|---|---|
| Site Analytics (sidebar item #9) | Internal pageviews, clicks, live visitors | `/api/analytics/dashboard`, `/live`, `/clicks` |
| Google Analytics (sidebar item #11) | GA4 reports and realtime | `/api/analytics/ga4/*` |
| BI Analytics Hub (bottom sidebar link) | MRR, ARR, funnel, customer health, anomalies | `/api/admin/bi/*` |
| Platform analytics | Call dispositions, API cost by customer | `/api/admin/platform/analytics/*` |

A superadmin who wants to answer "how is the business doing?" has to visit all four. None of them link to each other.

### 1.4 AI agents are split across five surfaces

`Agent Hub`, `AI Agent`, `Gemini AI Command`, `HeyGen`, `AI admin chat`, plus `admin-agent` threads. These are all doing variations of "configure / monitor / talk to an AI agent" and are four separate sidebar entries plus a `capabilities` API.

### 1.5 Customers / users / prospects are split three ways

`All Active Users` (platform customers), Admin-panel `Users` tab (same data, different UI), CRM customers (homeowners owned by platform customers), Call-Center prospects (cold-call leads). It's not obvious which list is which.

### 1.6 The scoreboard

- **3** parallel admin pages with independent navigation
- **22** sidebar items on `/super-admin` + 13 tabs on `/admin` + separate BI page = **38+ top-level destinations**
- **7** places incoming communications surface, **0** unified inboxes
- **4** distinct analytics surfaces
- **5** AI-agent surfaces
- **~79** admin API endpoints across 6 route files
- `src/routes/admin.ts` is **3,140 lines**, `public/static/super-admin-dashboard.js` is **627 KB**

That is the complexity. Now the plan.

---

## 2. The plan — collapse 38 destinations into 6

Target: one admin URL (`/super-admin`), one sidebar, **6 top-level sections**, each with a small number of tabs. Everything else becomes a tab, subtab, or gets deleted.

### 2.1 The new sidebar (6 items, not 22)

```
/super-admin
 ├── Inbox              (NEW — unified communications)
 ├── Customers          (users + CRM + prospects, unified)
 ├── Revenue            (orders, sales, pricing, invoices)
 ├── Growth             (analytics, marketing, SEO, blog)
 ├── AI Operations      (secretary, call center, agents)
 └── Platform           (phones, onboarding, system health, API, settings)
```

That's it. Six clicks away from everything.

Each section is a tabbed page inside a single SPA shell. No more hopping between `/admin`, `/super-admin`, `/admin/super`.

### 2.2 Section-by-section consolidation

#### A) Inbox — the biggest win

**One page, one unread count, one timeline.** Collapses Rover chat + secretary calls/SMS/voicemails + lead capture submissions + CRM job messages into a single "Conversations" list.

- Unified data model: a `conversation` has a `channel` ∈ {web_chat, voice, sms, voicemail, form, job_message} and a `status` ∈ {new, open, replied, closed}.
- Single list view with filters: channel, status, unread, assigned, date range.
- Detail pane on the right with the full transcript/history and a reply box that writes back to the correct channel.
- Global unread badge shown in the top header of every page.

**Backend changes required:**
- New unified endpoint: `GET /api/admin/inbox` returning conversations across all channels, with a single `last_activity_at`, `unread_count`, `channel`, `contact` shape.
- Adapters that pull from: `rover_conversations`, `secretary_calls`, `secretary_messages`, `secretary_callbacks`, `lead_capture_submissions`, `crm_job_messages`.
- A simple `inbox_read_state` table keyed by (conversation_id, admin_user_id) so "unread" means something.

**Frontend changes required:**
- New `inbox.js` view (or section in `super-admin-dashboard.js`).
- Delete the standalone `Rover Chat` tab on `/admin` — it moves here.
- The `Secretary` calls/messages/callbacks subtabs become filters inside Inbox, not separate pages. The *business data* about the secretary product (subscribers, revenue, deployment status) moves to AI Operations.

**Kill:** `Rover Chat` (`/admin` tab), `Secretary Admin` subtabs for calls/messages/callbacks as separate views, the superadmin-only duplicate `/superadmin/secretary/calls` page.

#### B) Customers — merge three lists into one

**Single "people" directory** with a type filter: `Platform User`, `CRM Customer (homeowner)`, `Prospect (cold-call)`.

- Top-level search bar: "Search for anyone" — emails, phones, names, addresses across all three tables.
- Row click opens a unified profile: who they are, their orders, their conversations (pulled from Inbox), their jobs, their billing state.
- Tabs inside a person's profile: Overview, Orders, Conversations, Jobs, Billing, Activity.

**Kill:** `All Active Users` sidebar item, `Users` tab on `/admin`, separate `Prospects` screen in call-center. Keep one page.

#### C) Revenue — one money page

Tabs: `Orders` · `Report Requests` · `Credit Sales` · `Pricing & Tiers` · `Invoices` · `Service Invoices`.

- "Orders" and "Report Requests" become filtered views of the same table (status = needs-trace vs. completed). Both currently exist as separate sidebar items — they're the same underlying data with different filters.
- `Pricing & Billing` + `Pricing tiers` (platform-admin) merge — they are the same thing.

**Kill:** `Credit Pack Sales`, `Report Requests`, `Order History`, `Pricing & Billing` as separate sidebar items. All tabs under Revenue.

#### D) Growth — one analytics hub

Tabs: `Overview` · `Traffic` · `Funnel & Health` · `Marketing` · `SEO & Blog`.

- `Overview` = the useful widgets from the current BI Hub (MRR, ARR, funnel, anomalies) + the KPIs from `/admin/dashboard`. This is what the superadmin sees on login.
- `Traffic` = Site Analytics + GA4 stitched together (toggle between internal tracker and GA4). No reason these are separate pages.
- `Funnel & Health` = the rest of BI (customer health, revenue waterfall, API performance).
- `Marketing` = Sales & Marketing + Email Outreach + Email Setup + Meta Connect, grouped by "outbound". Email Setup is a cog icon behind a settings link, not a top-level nav item.
- `SEO & Blog` = Blog Manager + SEO page meta + backlinks.

**Kill:** `Site Analytics`, `Google Analytics`, `BI Analytics Hub`, `Sales & Marketing`, `Email Outreach`, `Email Setup`, `Blog Manager`, `Meta Connect` as separate sidebar items. All tabs under Growth.

This alone removes **8 sidebar items**.

#### E) AI Operations — one AI page

Tabs: `Overview` · `Secretary` · `Call Center` · `Agents` · `Voice & Avatars`.

- `Overview` = live dashboard (who is on a call right now, what agents are active, today's stats). Pulls from `/api/admin/platform/live-dashboard` + `/api/admin/superadmin/secretary/monitor` (currently two separate pages showing similar things).
- `Secretary` = subscribers, revenue, deployment status, config — the *business/admin* side of the product. (The *conversations* moved to Inbox.)
- `Call Center` = campaigns, prospects, call logs, agent stats.
- `Agents` = merges `Agent Hub`, `AI Agent`, `Gemini AI Command`, and the `admin-agent` threads UI. These are all "configure and monitor an AI agent" — they should be one page with a list of agents on the left.
- `Voice & Avatars` = HeyGen + voice config + TTS variants.

**Kill:** `Roofer Secretary AI`, `AI Call Center`, `HeyGen`, `Gemini AI Command`, `Agent Hub`, `AI Agent` as separate sidebar items. All tabs under AI Operations. That's another **6 sidebar items gone**.

#### F) Platform — infrastructure & settings

Tabs: `Phone Numbers` · `Onboarding` · `API & Developers` · `System Health` · `Settings`.

- Phone marketplace + LiveKit phone pool + telephony status merge under Phone Numbers.
- Customer Onboarding keeps its own tab (it's a real workflow).
- API Users + API Queue + API Stats + API Accounts + Developer Portal merge into API & Developers.
- System Health + Paywall Status + Deployment Status merge into System Health.
- Settings = material preferences, SIP mapping, transcript flags, feature toggles.

**Kill:** `Customer Onboarding`, `Phone Pool / Numbers`, `API Users` as separate sidebar items.

### 2.3 Global patterns that make all of this feel simpler

1. **One top-bar badge cluster** showing unread Inbox count, orders-needing-trace count, anomaly count. These are the three things a superadmin actually needs to glance at on login.
2. **One keyboard shortcut palette** (`⌘K`) — "go to customer", "find order #", "open inbox conversation by name". With 38 destinations today this is basically mandatory; with 6 it becomes a power-user speedup.
3. **No more cross-page links at the bottom of the sidebar.** `/admin` and `/admin/super` redirect into `/super-admin` sections.
4. **Consistent URL scheme** — `/super-admin/<section>/<tab>` so the whole UI is linkable and back-button works.
5. **Role-gated sections, not role-gated pages.** "Admin vs superadmin" becomes "admin sees Inbox + Customers + Revenue; superadmin also sees Growth + AI Ops + Platform."

---

## 3. What this kills vs. keeps

### Sidebar items eliminated (16 of 22)

Credit Pack Sales, Report Requests, Order History, Sales & Marketing, Email Outreach, Email Setup, Site Analytics, Blog Manager, Google Analytics, AI Call Center, Meta Connect, Customer Onboarding, Phone Pool / Numbers, Roofer Secretary AI, HeyGen, Gemini AI Command, Pricing & Billing, API Users, Agent Hub, AI Agent → all become **tabs or subtabs** inside the 6 new sections.

Kept as top-level: All Active Users (→ Customers), Orders (→ Revenue), Signups (→ Customers), and the new Inbox.

### Admin.ts tabs eliminated

Overview + Users + Earnings + Sales & Orders + Invoicing + Marketing + Rover Chat + New Order + Blog + Activity Log + SIP Bridge + Report Search + Claims → all fold into the new sections on `/super-admin`. Delete `/admin` as a separate page; redirect to `/super-admin`.

### Pages kept essentially unchanged

- Dispatch Board (`/admin/dispatch`) — it's a real operational tool with its own UX, keep it linked from AI Ops → Call Center or Revenue → Orders.
- The actual API routes under `/api/admin/*`, `/api/analytics/*`, `/api/admin/bi/*` stay — this plan is mostly UI reorganization plus one new Inbox endpoint. No migrations needed.

---

## 4. Implementation phases

Phased so the user gets value fast without a big-bang rewrite.

### Phase 1 — Unified Inbox (the user's actual complaint)
Scope: new `GET /api/admin/inbox` that fans out to rover + secretary + lead-capture + CRM messages, plus one new Inbox view in `super-admin-dashboard.js`. Add unread badge to the top header. Leaves existing pages intact.
**Effort:** ~3–5 days. **Unblocks the biggest pain immediately.**

### Phase 2 — Merge analytics surfaces into Growth
Scope: new `Growth` section with tabs that embed the existing Site Analytics, GA4, BI Hub widgets. Keep their API endpoints. Remove the four sidebar entries; add one. No backend work.
**Effort:** ~2–3 days.

### Phase 3 — Merge AI surfaces into AI Operations
Scope: consolidate Secretary + Call Center + Agent Hub + AI Agent + Gemini Command + HeyGen into one section with tabs. Mostly frontend.
**Effort:** ~3–4 days.

### Phase 4 — Merge /admin into /super-admin
Scope: rebuild the Admin Control Panel tabs as sections under `/super-admin`. Redirect `/admin` → `/super-admin/revenue` (or whatever the most-used tab is). Delete `admin.js`.
**Effort:** ~4–6 days. This is the biggest pure-frontend refactor.

### Phase 5 — Unified Customers view + command palette
Scope: the single people directory, cross-table search, ⌘K palette. Requires a little DB work (indexed view across users/crm_customers/prospects).
**Effort:** ~3–5 days.

### Phase 6 — Cleanup
Delete dead code in `admin.ts`, split what's left into smaller modules. `admin.ts` should drop from 3,140 lines to under 800 after Phases 1–4.

**Total:** ~3–5 weeks of focused work, but Phase 1 alone addresses the chat-discovery problem in under a week.

---

## 5. Concrete files to touch

| Change | File |
|---|---|
| New Inbox endpoint | `src/routes/admin.ts` (new handler) or a new `src/routes/inbox.ts` |
| Inbox adapters | `src/services/inbox-aggregator.ts` (new) pulling from existing repositories |
| New sidebar + section shell | `src/index.tsx` L4854–4957 (replace the 22-item sidebar with 6) |
| Inbox / Customers / Revenue / Growth / AI Ops / Platform views | `public/static/super-admin-dashboard.js` (split into section files or keep monolithic, up to you) |
| Delete | `public/static/admin.js` (after Phase 4), and dead sections of `super-admin-dashboard.js` |
| Redirect old routes | `src/index.tsx` — `/admin` and `/admin/super` → `/super-admin/<section>` |
| Read-state table | new migration for `inbox_read_state` |

---

## 6. What success looks like

Before: 22 sidebar items + 13 tabs + a separate BI page, and 7 places to check for new conversations.

After: 6 sidebar items, one Inbox with an unread badge, one URL (`/super-admin`), one sidebar, one search. A new admin can look at the left edge of the screen and understand what the product does in ~5 seconds.

The user's specific complaint — *"so hard to find new chats from people with the front end, analytics, BI analytics etc."* — resolves to a single click on "Inbox" (Phase 1) and a single click on "Growth" (Phase 2).
