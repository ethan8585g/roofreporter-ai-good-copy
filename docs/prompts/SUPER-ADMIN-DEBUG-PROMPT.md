# Super Admin Simplification — Post-Buildout Debug Prompt

**Use:** Paste this entire file into Claude Code (or another coding agent) after you've finished implementing `SUPER-ADMIN-SIMPLIFICATION-PLAN.md`. It will drive the agent through a full verification sweep: data integrity, UI correctness, regressions, performance, role-gating, and dead-code cleanup.

**Project root:** `/Users/<you>/.../roofreporter-ai-good-copy` (the Hono + Cloudflare Pages/Workers app).
**Baseline to compare against:** pre-refactor `git log` — find the last commit before Phase 1 landed and use it as the reference for "what used to work."

---

## Prompt begins below this line

---

You are debugging a completed refactor of the super-admin area of a Hono-based roofing CRM. The refactor collapsed three parallel admin UIs (`/super-admin` with 22 sidebar items, `/admin` with 13 tabs, `/admin/super` BI Hub) into a single `/super-admin` page with 6 sections: **Inbox, Customers, Revenue, Growth, AI Operations, Platform**. A new unified Inbox pulls from 7 different communication channels (Rover web chat, Secretary calls, Secretary SMS, Secretary voicemails/callbacks, lead-capture form submissions, CRM job messages, superadmin cross-customer call feed).

The plan document is at `SUPER-ADMIN-SIMPLIFICATION-PLAN.md` in the repo root. Read it first so you understand the intended shape.

Your job: run the full debug pass described below. Do not skip steps. Do not write new features. When you find a bug, fix it with the smallest possible change, then re-verify. For every step, report: what you checked, what you found, what you changed (if anything), and whether the step passed.

Use `npm run dev:sandbox` for local testing against D1. Use `npx vitest run` for unit tests. Use `wrangler d1 execute roofing-production --local --command "SELECT ..."` to inspect the database directly. Never run `npm run deploy` or `npm run deploy:prod` — production is out of scope.

---

### Phase A — Read and baseline (10 min)

1. Read `SUPER-ADMIN-SIMPLIFICATION-PLAN.md` end-to-end.
2. Read `CLAUDE.md` in the repo root for project conventions.
3. Run `git log --oneline -40` and identify the commit range that implemented Phases 1–6 of the plan. Note the SHA just before Phase 1 ("baseline SHA") — you'll reference it if you need to diff behavior.
4. Run `npm ci` then `npm run db:reset` to get a clean local D1 with seed data.
5. Run `npx vitest run` and record: total tests, pass count, fail count. If any tests fail, stop and fix them before continuing — they are your tripwire.
6. Run `npm run dev:sandbox` in the background. Wait for it to be listening on `http://0.0.0.0:3000`. Log in as a superadmin using the credentials in `seed.sql`.

---

### Phase B — Sidebar & navigation shape (15 min)

**Goal:** confirm the sidebar actually has 6 items, not 22.

1. Open `src/index.tsx` and locate the sidebar block (previously at lines ~4854–4957). Count the `sa-nav-item` entries. There should be **exactly 6** primary items plus a sign-out/settings affordance. Report the list and line numbers.
2. Open `/super-admin` in a browser (or curl the HTML). Confirm the rendered sidebar matches the code. Take a screenshot and save to `debug-artifacts/sidebar.png`.
3. Confirm each sidebar item corresponds to a section: **Inbox, Customers, Revenue, Growth, AI Operations, Platform**. If any of the old items (e.g. "Credit Pack Sales", "Site Analytics", "Roofer Secretary AI", "Agent Hub", "HeyGen", "AI Call Center", "BI Analytics Hub", "Meta Connect", "Blog Manager") still appear at the top level of the sidebar, that is a bug — they should be tabs inside a section.
4. Click into each of the 6 sections. For each, list the tabs that appear. Confirm the tab inventory matches the plan:
   - **Inbox:** filters (channel, status, unread, assigned, date) — no tabs, just filters.
   - **Customers:** single directory + per-person tabs (Overview, Orders, Conversations, Jobs, Billing, Activity).
   - **Revenue:** Orders · Report Requests · Credit Sales · Pricing & Tiers · Invoices · Service Invoices.
   - **Growth:** Overview · Traffic · Funnel & Health · Marketing · SEO & Blog.
   - **AI Operations:** Overview · Secretary · Call Center · Agents · Voice & Avatars.
   - **Platform:** Phone Numbers · Onboarding · API & Developers · System Health · Settings.
5. Verify the URL scheme. Every section and tab should produce a distinct, shareable URL of the form `/super-admin/<section>` or `/super-admin/<section>/<tab>`. Open each in a new tab directly and confirm it loads the right view with the right tab pre-selected. Back-button must work across section changes.
6. Confirm `/admin` and `/admin/super` redirect into `/super-admin/<section>` (plan says `/admin` → Revenue tab, or whatever was chosen). Curl each and confirm a 301 or 302 with a sensible `Location` header.

**Pass criteria:** exactly 6 sidebar items, all URLs shareable, all redirects in place.

---

### Phase C — Inbox: the highest-risk new surface (45 min)

The Inbox is net-new code that fans out to 7 channels. This is where regressions hide.

**C.1 — Endpoint shape**

1. `GET /api/admin/inbox` should return a unified list. Curl it with a superadmin JWT and inspect the JSON. Every row must have at minimum: `id`, `channel`, `status`, `contact` (with name/email/phone if known), `last_activity_at`, `unread_count`, `preview`, and a `deep_link` back to the detail view.
2. Verify the endpoint accepts filters: `?channel=web_chat|voice|sms|voicemail|form|job_message`, `?status=new|open|replied|closed`, `?unread=1`, `?assigned_to=<admin_id>`, `?since=<iso>`, `?until=<iso>`. Test each filter individually and in combination. Unknown filter values must return 400, not 500.
3. Pagination must be present and stable. Request page 1 and page 2 with a small limit (e.g. `?limit=5`) and confirm no duplicates across pages and no missing rows.

**C.2 — Per-channel correctness** — for EACH of the 7 channels:

| # | Channel | Source table/endpoint | Test |
|---|---|---|---|
| 1 | Rover web chat | `rover_conversations` / `/api/rover/admin/conversations` | Create a test conversation via the widget; confirm it appears in `/api/admin/inbox` within 2s with correct preview text and contact info. |
| 2 | Secretary voice calls | `secretary_calls` / `/api/secretary/calls` | Insert a fake call row with transcript; confirm it appears with `channel=voice` and the transcript preview is truncated to ~120 chars. |
| 3 | Secretary SMS | `secretary_messages` / `/api/secretary/messages` | Insert a fake inbound SMS; confirm it appears with `channel=sms` and correct `from` number. |
| 4 | Secretary voicemail / callback | `secretary_callbacks` / `/api/secretary/callbacks` | Insert a fake callback request; confirm it appears with `channel=voicemail` and has a `callback_requested_at` field in the detail. |
| 5 | Lead capture form submission | `lead_capture_submissions` (or whatever the table is called) | Submit the public `/api/lead-capture/*` endpoint with test data; confirm it appears with `channel=form` — this was **previously not surfaced at all**, so verify with extra care. |
| 6 | CRM job messages | `crm_job_messages` / `/api/crm/jobs/:id/messages` | Attach a message to an existing seed job; confirm it appears in Inbox with `channel=job_message` and the `deep_link` goes to the job detail, not just the message. |
| 7 | Cross-customer superadmin feed | `/api/admin/superadmin/secretary/calls` | Confirm this is NOT duplicating rows already returned by channel #2. This was a separate page pre-refactor; it should now be a view filter, not a second data source. Count total voice rows via both old and new endpoints — they must match.

**C.3 — Unread state**

1. Confirm an `inbox_read_state` table (or equivalent) exists with columns `(conversation_id, channel, admin_user_id, last_read_at)` or similar. Check the migration file in `migrations/`.
2. As a fresh superadmin, confirm `unread_count > 0` on at least one conversation.
3. Open the conversation detail. Confirm `unread_count` drops to 0 for that conversation on the next Inbox request. Confirm it does NOT drop for other admin users — read state is per-user.
4. Confirm the header badge in the top nav reflects the total unread count. Open a conversation; the badge should decrement.

**C.4 — Reply path**

1. From an Inbox conversation detail, send a reply. Confirm it writes back to the correct channel's table (e.g. a reply to a Rover conversation writes to `rover_messages`, not `secretary_messages`).
2. Check that the outbound side-effect actually happens: for SMS/voice, verify the send is queued or mocked correctly in dev; for web chat, verify the widget receives it.
3. Try to reply to a `form` submission — this may be not-supported by design. If it isn't, the UI should hide the reply box, not 500 on submit.

**C.5 — Performance**

1. Insert 500 fake conversations across channels (use a SQL script or a small node script — clean up after). Confirm `GET /api/admin/inbox` returns within 500ms. If it doesn't, check the aggregator query plan — it's probably doing N subqueries instead of UNION ALL.
2. Confirm the Inbox list view doesn't re-fetch everything on every filter change — it should at minimum debounce and ideally use server-side filtering only.

**Pass criteria:** all 7 channels surface, unread state is correct per-user, reply writes to the right table, no N+1 in the aggregator.

---

### Phase D — Customers directory (20 min)

1. Open Customers. Confirm the search bar searches across platform users (`admin_users`/`master_companies`), CRM customers (homeowners in `customers`), and cold-call prospects. Search for known seed emails, phones, names, addresses — each must return hits from the right source with a clear type badge.
2. Confirm the type filter (`Platform User` / `CRM Customer` / `Prospect`) works and that "All" shows the merged list.
3. Click a Platform User. Confirm the profile shows: Overview, Orders, Conversations (pulled from Inbox filtered by this person), Jobs, Billing, Activity. For a seed user with known orders, confirm every order from `/api/admin/superadmin/orders` appears here.
4. Click a CRM Customer (homeowner). Confirm Jobs tab shows jobs from `crm_jobs` table. Confirm Conversations tab shows their `crm_job_messages` and any matching voice/SMS/chat threads linked by phone or email.
5. Click a Prospect. Confirm Activity tab shows cold-call outcomes from `call_logs`.
6. Check for **data collisions** — the same phone number could exist in all three tables. The profile should handle this gracefully (merged view, not three separate profiles). If it shows three separate profiles for the same person, note it as a known limitation, not a blocker.
7. Confirm the old "All Active Users" sidebar item on `/super-admin` and the "Users" tab on `/admin` are GONE. Grepping `src/index.tsx` and `public/static/admin.js` for `saSetView('users'` or the old tab ID should return no active usages.

---

### Phase E — Revenue (15 min)

1. Orders tab: confirm it shows the same data as the old `/api/admin/superadmin/orders`. Count rows — must match exactly.
2. Report Requests tab: confirm it's a filtered view of Orders where status = `needs-trace` (or whatever the flag is). Confirm the count matches `/api/admin/superadmin/orders/needs-trace`.
3. Credit Sales tab: confirm it matches `/api/admin/superadmin/sales` output.
4. Pricing & Tiers: confirm create/update/delete of a membership tier via the UI hits `/api/admin/platform/membership-tiers` and that the old `/admin/platform` page is no longer linked.
5. Invoices + Service Invoices: confirm both exist as tabs and pull from their respective tables. Confirm CSV export still works (`/api/admin/superadmin/orders/export`, `/api/admin/superadmin/users/export`).
6. Test a full order lifecycle against the new UI: create order → mark paid → verify it shows up in all relevant tabs and that the customer's profile Billing tab reflects it.

---

### Phase F — Growth analytics consolidation (20 min)

This is where 4 separate analytics surfaces got merged. Verify nothing got lost.

1. **Overview tab:** must show the top-level KPIs from old BI Hub (MRR, ARR, ARPC, trial→paid conversion, churn) AND the dashboard KPIs from `/api/admin/dashboard`. Curl both old endpoints and confirm every metric is represented in the new UI.
2. **Traffic tab:** must show both internal tracker data (from `/api/analytics/dashboard`, `/live`, `/clicks`) AND GA4 data (from `/api/analytics/ga4/*`). There should be a toggle or a clear split. Confirm both halves populate.
3. **Funnel & Health tab:** must show funnel (`/api/admin/bi/funnel`), customer health (`/api/admin/bi/customer-health`), revenue waterfall (`/api/admin/bi/revenue-waterfall`), anomalies (`/api/admin/bi/anomalies`), API performance (`/api/admin/bi/api-performance`). Five widgets, one tab. Confirm each renders without error.
4. **Marketing tab:** confirm Email Outreach + Email Setup + Meta Connect + the old "Sales & Marketing" aggregate all appear as subsections here. Confirm sending a test email campaign still works end-to-end.
5. **SEO & Blog tab:** confirm Blog Manager CRUD works (create a draft post, publish it, confirm it appears at `/blog/<slug>`). Confirm SEO page-meta editor and backlinks view work.
6. Grep for any remaining sidebar references to `site-analytics`, `ga4`, `bi-analytics-hub`, `sales-marketing`, `email-outreach`, `email-setup`, `blog-manager`, `meta-connect`. They must all be gone from the sidebar (they can still exist as tab IDs inside Growth).

---

### Phase G — AI Operations consolidation (25 min)

Five pre-refactor sidebar items (Secretary, Call Center, HeyGen, Gemini Command, Agent Hub, AI Agent) merged into one section.

1. **Overview:** confirm live dashboard renders — who is on a call right now, active agents, today's stats. Combines `/api/admin/platform/live-dashboard` and `/api/admin/superadmin/secretary/monitor`.
2. **Secretary tab:** confirm subscribers list, revenue chart, deployment status, config editor all work. Confirm calls/SMS/voicemails are NOT duplicated here — they live in Inbox.
3. **Call Center tab:** confirm campaigns, prospects, call logs, agent stats all render.
4. **Agents tab:** confirm Agent Hub + AI Agent + Gemini Command + `admin-agent` threads are all reachable through a single agents list with detail panes. Pick a known agent persona and confirm its config loads.
5. **Voice & Avatars tab:** confirm HeyGen and voice variants both work.
6. Smoke test the AI admin chat (`/api/ai-admin/*`) from wherever it's now surfaced. It was previously accessed via a floating button or dedicated page — confirm it still works post-refactor.

---

### Phase H — Platform (infrastructure & settings) (10 min)

1. Phone Numbers tab: merged view of phone marketplace + LiveKit phone pool + telephony status. Confirm numbers list, pool status, and provider health all render.
2. Onboarding tab: confirm `/api/admin/superadmin/onboarding/list` and `/config` both reachable.
3. API & Developers: confirm API Users list, API Queue, API Stats, API Accounts, Developer Portal all merged and functional.
4. System Health: confirm health check, paywall status, deployment status all render.
5. Settings: confirm material preferences, SIP mapping, transcript flags are editable. Save a change and confirm it persists.

---

### Phase I — Role gating (15 min)

This is frequently broken in large UI refactors.

1. Log in as a regular admin (non-superadmin). Confirm sidebar shows only: **Inbox, Customers, Revenue**. Growth, AI Operations, Platform must be hidden AND the URLs must return 403 if typed directly.
2. Log in as a superadmin. Confirm all 6 sections visible.
3. Log out. Confirm `/super-admin/*` URLs redirect to `/login`.
4. Check the middleware — grep `src/middleware/` for role checks. Confirm the checks happen server-side on the route handlers, not just client-side in JS.
5. Test the `/admin` → `/super-admin` redirect preserves session.

---

### Phase J — Legacy API surface (15 min)

Per the plan, backend API endpoints stay stable — this was a UI refactor plus one new Inbox endpoint. Verify nothing was accidentally removed.

1. Diff `git show <baseline-SHA>:src/routes/admin.ts` against current `src/routes/admin.ts`. Every pre-existing `GET` should still exist OR have a documented redirect/replacement. If any handler was silently deleted, flag it.
2. Same check for `src/routes/platform-admin.ts`, `src/routes/super-admin-bi.ts`, `src/routes/analytics.ts`, `src/routes/rover.ts`, `src/routes/secretary.ts`.
3. Curl each of the ~79 pre-refactor endpoints listed in `SUPER-ADMIN-SIMPLIFICATION-PLAN.md` Section 6 (if present) or grep them out of the route files. Confirm each returns 200 (or an expected 401/403 on role mismatch), never 404 or 500.
4. Check `wrangler.jsonc` and any cron worker configs — the refactor shouldn't have removed bindings, but confirm.

---

### Phase K — Dead code cleanup (10 min)

1. `src/routes/admin.ts` was 3,140 lines pre-refactor. Plan targets <800 post-refactor. Run `wc -l src/routes/admin.ts`. If it's still over 1,500, there's dead code that should have been removed.
2. `public/static/admin.js` should be deleted or reduced to a redirect stub. Confirm.
3. Grep for orphaned `saSetView(` calls pointing to view names that no longer exist.
4. Grep for dead CSS classes (`.sa-old-*`, any class only referenced in deleted markup).
5. Run `npx tsc --noEmit` and confirm no unused imports or dead types.
6. Run `npx vitest run` again — all tests must still pass. If a test was deleted, confirm it was for removed functionality, not accidentally-removed functionality.

---

### Phase L — Regression suite & final checks (15 min)

1. Go back to the **user's original complaint** and literally re-enact it: "find a new chat from a person." Click Inbox. Confirm you can see an unread conversation and open it in under 3 clicks from login. Time it. If it takes more than 3 clicks, the refactor failed its primary goal.
2. Repeat for: "see analytics." Click Growth → Overview. Should be one click from login.
3. Repeat for: "see BI / funnel / MRR." Click Growth → Funnel & Health. One click.
4. Load `/super-admin` on a cold cache with dev tools open. Record: initial HTML size, total JS loaded, time-to-interactive. Pre-refactor the JS bundle was `super-admin-dashboard.js` at ~627KB. Confirm post-refactor is not worse.
5. Run Lighthouse (or equivalent) on `/super-admin`. Performance score should be ≥ pre-refactor baseline.
6. Run `npx vitest run` one final time. Zero failures required.
7. Run `npm run build`. Zero errors required.
8. Smoke-test the Capacitor iOS build path if the refactor touched anything the mobile app relies on (check `capacitor.config.ts` — unlikely to be affected but worth a grep).

---

### Phase M — Write the debug report

Produce `DEBUG-REPORT.md` at the repo root containing:

- Summary table: each Phase A–L with pass/fail and key findings.
- List of bugs found, with severity (blocker / major / minor / cosmetic), file:line, fix applied, and commit SHA.
- List of items marked as "intentional change from plan" — places where the implementation diverged from `SUPER-ADMIN-SIMPLIFICATION-PLAN.md` and why.
- List of known limitations or follow-up work.
- Final numbers: sidebar item count, `admin.ts` line count, `super-admin-dashboard.js` bundle size, test count, all compared to baseline SHA.
- A "user smoke test" section confirming the user's original complaint is resolved, with screenshots of the Inbox and Growth sections saved to `debug-artifacts/`.

**Do not mark the refactor "done" if any blocker or major bug is unfixed.** Report honestly.

---

## End of prompt
