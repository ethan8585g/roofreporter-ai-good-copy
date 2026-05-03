# Claude Code Prompt — Lead-Magnet Conversion System for RoofManager

Paste the section below (everything between the two `---` lines) into your Claude Code terminal. It's written to be self-contained and assumes Claude Code has access to the repo at the project root.

---

## TASK: Ship a complete lead-magnet conversion system

I want to convert more traffic on roofmanager.ca. The plan is a "Get a Free Roof Measurement Report" lead magnet: visitor enters name + email + property address → we store it → super-admin gets a live notification in the dashboard → admin composes & sends the report email back from inside the dashboard. An auto-acknowledgment email goes to the lead immediately so they don't feel ignored.

**Important — this is a brownfield codebase.** A lot of the plumbing already exists. Do NOT recreate it. Your job is to (a) extend the existing `leads` pipeline with new fields and statuses, (b) add one new prominent lead-magnet surface (homepage hero + pricing page + exit-intent), (c) build a new super-admin "Leads Inbox" UI, and (d) add an admin-initiated "Send Report Email" action. Read the files I reference first, then plan, then execute.

### What already exists — read these before touching anything

1. **`src/lib/lead-forms.ts`** — four reusable form helpers (`inlineQuoteFormHTML`, `comparisonLeadFormHTML`, `damageAssessmentFormHTML`, `blogLeadMagnetHTML`). They share a `formSubmitJS(formId)` helper and a honeypot input. All except `blogLeadMagnetHTML` POST to `/api/agents/leads`. **Reuse this file** — add a new export, don't fork the pattern.
2. **`src/routes/agents.ts` lines 26–167** — `POST /api/agents/leads` endpoint. Already: validates email, honeypot-checks, inserts into `leads` table with graceful fallback when columns are missing, fires GA4 + Meta CAPI, emails sales@roofmanager.ca via 3-tier fallback (Gmail OAuth2 → Resend → GCP service account). **Extend this endpoint**, don't replace it.
3. **`src/services/email.ts`** — `sendGmailEmail()`, `sendGmailOAuth2()`, `sendViaResend()`, `notifySalesNewLead()`, `buildEmailWrapper()`. Use these helpers for every send. Do not invent new email plumbing.
4. **`src/index.tsx`** — monolithic Hono app. Route mounts live around lines 318–363. `getLandingPageHTML()` at line 5977 is the homepage. `getHeadTags()` at line 3910 is the shared head. `/super-admin`, `/super-admin/:section`, `/super-admin/:section/:tab` are mounted at lines 796–804 and all render `getSuperAdminDashboardHTML()`.
5. **`src/routes/super-admin-bi.ts`** — pattern for admin-only endpoints. Every route calls `validateAdminSession()` and checks `role === 'superadmin'` before responding. Mirror this exactly for the new leads endpoints.
6. **`migrations/`** — sequential D1 migrations numbered `NNNN_name.sql`. The most recent number I see is `0156_leads_address_utm.sql` which already added `address` and `utm_source` columns to the `leads` table. Continue the sequence.
7. **`leads` table current shape** (after migration 0156): `id`, `name`, `company_name`, `phone`, `email`, `source_page`, `message`, `status` (default 'new'), `address`, `utm_source`, `created_at`, `updated_at`.

### Deliverable 1 — Database migration

Create the next sequential migration file in `migrations/` (check the highest existing number and add 1). It must:

- Add columns to `leads`:
  - `report_sent_at` TEXT NULL — set when admin sends the report
  - `report_sent_by` INTEGER NULL — FK-style reference to `admin_users.id`
  - `admin_notes` TEXT NULL — private notes the admin can save
  - `priority` TEXT NOT NULL DEFAULT 'normal' — one of `'low' | 'normal' | 'high' | 'urgent'`
  - `lead_type` TEXT NULL — e.g. `'free_measurement_report'`, `'contact'`, `'demo'` (nullable so old rows remain valid)
- Add indexes: `idx_leads_report_sent_at` on `report_sent_at`, `idx_leads_priority` on `priority`, `idx_leads_lead_type` on `lead_type`.
- Write the migration so it's idempotent-ish: use `ALTER TABLE leads ADD COLUMN` statements; if D1 errors on re-apply, that's fine — migrations are one-shot here.
- Do NOT change the existing `status` column semantics. The allowed values are now: `'new' | 'contacted' | 'report_sent' | 'converted' | 'closed_lost'`. Document this in a SQL comment at the top of the migration.

### Deliverable 2 — New "Free Measurement Report" form component

In `src/lib/lead-forms.ts`, add a new export `freeMeasurementReportFormHTML(source: string, variant?: 'hero' | 'inline' | 'modal')`. Requirements:

- Fields: **name (required)**, **email (required)**, **property address (required)**, phone (optional).
- Headline: "Get a Free Roof Measurement Report — Emailed to You in Hours".
- Subhead: "Enter your address. We'll send satellite-accurate measurements to your inbox. No credit card. No sales call unless you want one."
- Uses the existing `formSubmitJS` helper — POST to `/api/agents/leads` with `lead_type: 'free_measurement_report'` appended to the body. To keep a single submit helper, either (a) extend `formSubmitJS` to also send `lead_type` from a hidden input named `lt`, or (b) write a dedicated inline submit function for this form. Prefer (a) with a backward-compatible fallback (empty string if no `lt` input present).
- Uses the existing honeypot `website` input.
- Three visual variants controlled by `variant`:
  - `'hero'` — dark glassmorphism, green (#00FF88) CTA, fills a 640px card for homepage hero placement.
  - `'inline'` — neutral dark card, sized for mid-page placement on pricing and feature pages.
  - `'modal'` — compact, designed to be the body of an exit-intent modal (no outer gradient, just the form).
- On success, replace form with a friendly confirmation: "Got it, {first name}. Check your inbox — we've sent a confirmation and your report is being prepared. Expected delivery within 2 business hours."
- Fires Meta CAPI `Lead` event on success (`window.fireMetaLeadEvent({ content_name: 'free_measurement_report' })`), matching the pattern in existing forms.
- All styling inline (no new CSS files) — match the existing forms' style system.

### Deliverable 3 — Surface the form on high-intent pages

In `src/index.tsx`:

1. **Homepage hero** — In `getLandingPageHTML()` (line 5977 area), add `${freeMeasurementReportFormHTML('homepage_hero', 'hero')}` directly below the current hero CTA buttons. Make sure the form is visible above the fold on 1440×900 and on mobile 390×844. Import the new function at the top of the file alongside the existing lead-form imports.
2. **Pricing page** — The `/pricing` route is at line 1483. Find the pricing page HTML generator (grep for the route handler or for a `getPricingPageHTML`-style function) and add `${freeMeasurementReportFormHTML('pricing_page', 'inline')}` below the pricing grid, above the FAQ.
3. **Features measurements page** — `/features/measurements` is at line 1493–1496 via `getFeatureHubPageHTML()`. Add `${freeMeasurementReportFormHTML('features_measurements', 'inline')}` near the bottom of that page.
4. **Exit-intent modal — sitewide** — Add a single `<script>` block in `getHeadTags()` (or a new shared helper `getExitIntentModalHTML()`) that:
   - Listens for `mouseleave` events at `y < 10` on desktop, and triggers on `pagehide` + a 25-second dwell timer on mobile.
   - Fires at most once per session (use `sessionStorage` key `rm_exit_intent_shown`).
   - Does NOT fire on `/super-admin`, `/customer`, `/admin`, `/api/*` paths — check `location.pathname` first.
   - Does NOT fire if a form submit succeeded earlier in the session (set `sessionStorage.rm_lead_captured = '1'` in `formSubmitJS` success path).
   - Renders `freeMeasurementReportFormHTML('exit_intent', 'modal')` inside a centered overlay with a dismissible close button and a dark backdrop (click-outside closes).
5. **Do not** add this to admin/customer pages, blog posts (blog already has `blogLeadMagnetHTML`), or damage-assessment pages (they have `damageAssessmentFormHTML` which is higher-intent).

### Deliverable 4 — Server-side changes to `/api/agents/leads`

In `src/routes/agents.ts`:

1. Accept a new optional `lead_type` field in the request body. Validate it against an allowlist: `['free_measurement_report', 'contact', 'demo', 'comparison', 'storm', 'hail', 'hurricane', 'other']`. Default to `'other'`. Persist to the `leads.lead_type` column.
2. Accept an optional `priority` field (same allowlist as the DB column). Default to `'normal'`. If `lead_type === 'free_measurement_report'`, default to `'high'` instead.
3. **Auto-acknowledgment email to the lead** — After the DB insert succeeds (and before the existing sales@ notification), send a confirmation email to `email`. Use `sendGmailOAuth2` first, fall back to `sendViaResend`, then `sendGmailEmail` (GCP). Reuse `buildEmailWrapper()` from `src/services/email.ts`. The email body must include:
   - A warm greeting using the lead's first name (parse from `name` — split on space, take index 0; if empty, fall back to "there").
   - Confirmation of the property address they submitted.
   - Expected delivery window: "within 2 business hours" for `free_measurement_report`, "within 1 business day" otherwise.
   - Subject line: `"✅ Your free roof measurement report is being prepared"` (or `"We got your message — RoofManager"` for non-report leads).
   - A plain-text fallback (most of the helpers already handle this).
   - Reply-to `sales@roofmanager.ca` so replies thread correctly.
   - Make this send non-blocking: wrap in try/catch, log failures, and never 500 the POST on an email failure.
4. **Extend the sales@ notification** to include the new fields (`lead_type`, `priority`, `utm_source`) in the existing HTML email body. Also include a **direct link** to the new super-admin Leads Inbox filtered to this lead: `https://www.roofmanager.ca/super-admin/leads?id={leadId}`.
5. Keep all existing behavior (GA4, Meta CAPI, honeypot, fallback inserts) untouched.

### Deliverable 5 — Super-admin Leads Inbox

Create `src/routes/super-admin-leads.ts`. Mirror the auth pattern from `src/routes/super-admin-bi.ts` exactly (validate session → check `role === 'superadmin'` → return 401/403 on mismatch). Endpoints:

1. `GET /api/admin/leads` — list leads with filters.
   - Query params: `status`, `lead_type`, `priority`, `q` (search name/email/address/phone with `LIKE`), `limit` (default 50, max 200), `offset` (default 0), `since` (ISO timestamp — only return leads newer than this, for polling).
   - Return `{ leads: Lead[], total: number, counts: { new, contacted, report_sent, converted, closed_lost } }`.
   - Order by `created_at DESC`. Parameterize everything — no string concatenation into SQL.
2. `GET /api/admin/leads/:id` — single lead with all columns.
3. `PATCH /api/admin/leads/:id` — update `status`, `priority`, `admin_notes`. Validate enums. Update `updated_at`.
4. `POST /api/admin/leads/:id/send-report` — this is the "compose & send report email" action.
   - Request body: `{ subject: string, body_html: string, attachment_url?: string }` (attachment is a URL to an already-uploaded PDF — we're not doing multipart uploads here).
   - Server-side: validate `subject` (1–200 chars) and `body_html` (1–50000 chars). If `attachment_url` is present, validate it's an HTTPS URL pointing to `storage.googleapis.com`, `r2.dev`, `roofmanager.ca`, or the configured R2/GCS bucket — reject others.
   - Fetch the lead. Build the outgoing email via `buildEmailWrapper()`. If `attachment_url` is present, fetch the PDF bytes server-side and attach them (see `sendGmailEmail` — it already supports base64 body encoding; for attachments you may need the MIME-multipart variant `sendGmailEmailWithAttachment` — if it doesn't exist, add it in `src/services/email.ts` following the Gmail API `multipart/mixed` format and keep it self-contained).
   - Send via Gmail OAuth2 primarily; fall back to Resend with the attachment as a URL link in the body if multipart send fails.
   - On success: update the lead row — `status = 'report_sent'`, `report_sent_at = now`, `report_sent_by = session.admin_id`, append a note to `admin_notes` with timestamp and subject line.
   - Return `{ success: true, sent_at: ISO }`. On failure, `{ error: string }` with 500.
5. `POST /api/admin/leads/export` — download CSV of leads with the current filter set. Stream CSV with header row. Nice-to-have.

Mount in `src/index.tsx` near line 335 (where `adminRoutes` is mounted): `app.route('/api/admin', superAdminLeadsRoutes)` — confirm the prefix doesn't collide with `super-admin-bi` and adjust if needed (use `/api/admin/leads` explicitly if there's overlap).

### Deliverable 6 — Leads Inbox UI inside super-admin dashboard

Add a new section to `getSuperAdminDashboardHTML()` accessible at `/super-admin/leads`. The existing dashboard uses sections/tabs — follow the same pattern. Keep it as a single HTML string returned from a helper (match the codebase style — no React/build step).

UI requirements:

1. **Header bar** — count of new leads (pulsing dot if `status='new'` count > 0), filter chips (All | New | Contacted | Report Sent | Converted | Closed), priority filter, lead-type filter, search input.
2. **Table** — columns: priority badge, name, email, address (truncated with tooltip), source_page, lead_type, status, created_at (relative: "3 min ago"), actions. Rows clickable to open drawer.
3. **Right-side drawer** — opens on row click. Shows full lead detail, editable `status`/`priority`/`admin_notes` (save button PATCHes the lead), and a **"Compose Report Email"** button.
4. **Compose modal** — opens from the drawer. Fields: `To` (pre-filled with lead email, readonly), `Subject` (pre-filled with `"Your free roof measurement report for {address}"`), `Body` (rich-ish textarea — just a `<textarea>` is fine, server accepts HTML), `Attachment URL` (text input — user pastes a URL to a PDF hosted on the site/bucket). Send button POSTs to `/api/admin/leads/:id/send-report`. On success, closes modal and flashes a toast "Report sent to {email}".
5. **Live updates** — poll `GET /api/admin/leads?since={lastFetchedAt}` every 20 seconds while the page is visible (`document.visibilityState === 'visible'`). When new rows arrive, prepend them to the table with a gentle yellow flash, play a soft ping sound (`new Audio('/static/ping.mp3').play()` — wrap in try/catch because autoplay may be blocked), and update the header counter. If `/static/ping.mp3` doesn't exist, create a silent placeholder or omit the audio gracefully.
6. **Keyboard shortcuts** — `/` focuses search, `Esc` closes drawer/modal, `j`/`k` navigates rows.
7. **Empty state** — friendly illustration/text when no leads match filters.
8. **Mobile** — table collapses to cards below 640px. Drawer becomes full-screen overlay.

Styling: match the existing super-admin dashboard — same color tokens, same fonts, same button shapes. Do not introduce a new design system. Grep the dashboard file for existing `.btn`, `.card`, `.chip` classes and reuse them.

### Deliverable 7 — Analytics & attribution

1. Capture `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, and `referrer` in `sessionStorage` on every public-page load if not already set. Add this to the shared `getHeadTags()` bootstrap script. Read all six into the lead form submissions so they're persisted.
2. Add columns to `leads` for the missing UTM parts (the table currently only has `utm_source`): `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `referrer`. Put this in the same new migration as Deliverable 1.
3. Fire `gtag('event', 'lead_submit', { lead_type, source_page, utm_source })` in the submit-success path, mirroring the existing GA4 pattern in `src/routes/agents.ts`.
4. In the Leads Inbox header, show a "Last 7 days" / "Last 30 days" top-line count with % change vs previous period.

### Deliverable 8 — Tests & verification

1. Add a Vitest file `src/routes/agents.test.ts` (or extend an existing one) with:
   - POST with valid body → 200, row inserted, `lead_type` persisted.
   - POST with missing email → 400.
   - POST with honeypot filled → silent success, no insert.
   - POST with invalid `lead_type` → defaults to `'other'`, still 200.
   - Auto-ack email send failure → still 200, lead still inserted.
2. Manual verification checklist (print this at the end of your response as a checkbox list):
   - [ ] `npm run db:migrate:local` applies cleanly.
   - [ ] `npm run dev:sandbox` starts without errors.
   - [ ] Homepage shows the new hero form above the fold on desktop and mobile.
   - [ ] Submitting the form shows success state within 3 seconds.
   - [ ] Lead appears in `/super-admin/leads` within 20 seconds via polling.
   - [ ] Auto-ack email arrives at a test inbox (use a mailinator address).
   - [ ] Sales@ notification email arrives with the new fields and direct link.
   - [ ] Exit-intent modal fires exactly once per session on the homepage.
   - [ ] Exit-intent modal does NOT fire on `/super-admin` or `/admin`.
   - [ ] Compose modal sends the report email; lead `status` flips to `report_sent`.
   - [ ] `npx vitest run` passes.

### Constraints & guardrails

- **Do not** break existing lead forms — `inlineQuoteFormHTML`, `comparisonLeadFormHTML`, `damageAssessmentFormHTML`, `blogLeadMagnetHTML` must keep working unchanged.
- **Do not** add a build step or new client-side framework. Everything is server-rendered HTML strings with inline scripts/styles.
- **Do not** store secrets in code. All keys come from `c.env`.
- **Do not** expose admin endpoints without the `validateAdminSession` + `role === 'superadmin'` check.
- **Do not** use string concatenation in SQL — always `.prepare().bind()`.
- Keep inline-JS short. If a script block exceeds ~40 lines, move it to `/static/js/leads-inbox.js` and link via `<script src>`.
- Every new file must match the existing module style (ES modules, named exports, Hono Router for route files).

### Execution order

1. Read the 7 files listed under "What already exists".
2. Write a plan back to me: files you'll create, files you'll edit, migration number, and any ambiguities you want me to resolve. Stop and wait for my approval.
3. After I approve, execute in this order: migration → `lead-forms.ts` export → `/api/agents/leads` extension → auto-ack email → super-admin-leads routes → super-admin UI section → exit-intent modal → homepage/pricing/features placements → tests → verification checklist.
4. Commit in logical chunks (one commit per deliverable).

Begin.

---

## How to use this prompt

1. Open your Claude Code terminal at the repo root.
2. Paste everything between the two `---` lines above into the prompt.
3. Claude Code will read the seven referenced files, propose a plan, and wait for your approval before executing. Say "approved, proceed" (or adjust) once the plan looks right.
4. Deploy to a staging branch first (`npm run deploy` to the non-prod Pages project), run through the manual verification checklist, then `npm run deploy:prod`.

## Why this will convert better than what you have

- **Already-good foundations:** You have four lead-capture forms and a `leads` table with email-to-sales notifications. None of that is thrown away.
- **New above-the-fold hero CTA:** Currently your homepage's primary CTAs are "Try 4 Free Reports" / "Order Now" — both require account creation or payment intent. A zero-friction "give us your address, we email the report" is a much lower-commitment step and will capture visitors who aren't ready to sign up.
- **Exit-intent rescue:** A single exit-intent modal on the marketing surface typically recovers 2–5% of abandoning sessions on sites like yours. We gate it carefully (session-scoped, path-filtered) to avoid annoying repeat visitors or admin users.
- **Auto-acknowledgment closes the loop:** Without it, leads hear nothing for hours and assume the form didn't work. With it, they have a branded email in their inbox within seconds setting expectations.
- **Admin-first workflow:** Moving from "sales@ inbox" to a real Leads Inbox with status tracking means nothing falls through. The status flow `new → contacted → report_sent → converted` gives you a pipeline view you don't currently have.
- **Attribution:** Capturing all five UTM parts + referrer lets you actually measure which channels convert, which the current `utm_source`-only schema can't.
