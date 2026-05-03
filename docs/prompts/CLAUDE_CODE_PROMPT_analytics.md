# Roof Manager — Content Attribution & Analytics Buildout

Paste the section below into your Claude Code terminal. Treat everything before "===PROMPT===" as notes for yourself; everything after is the actual prompt.

Notes for me (Ethan):
- This is a planning + implementation task for the existing repo at `/Users/ethan/Documents/roofreporter-ai-good-copy`.
- Goal: stop guessing which blog posts and how-to pages actually produce paying customers. Give the super admin a real attribution view, and give every customer record a behavioral history.
- Stack constraints to respect: Hono monolith in `src/index.tsx`, Cloudflare Workers + D1 (`roofing-production` binding, `c.env.DB`), all SSR via Hono JSX, no separate frontend build, two auth systems (admin + customer portal). Migrations are sequential SQL files in `migrations/`.

===PROMPT===

# Task: Build a first-party content attribution + customer analytics system for Roof Manager

You are working in the Roof Manager repo (Hono on Cloudflare Workers + Pages, D1 SQLite, monolithic app in `src/index.tsx`). Read `CLAUDE.md` first, then `src/index.tsx`, `src/routes/`, `src/repositories/reports.ts`, and the latest few files in `migrations/` so you understand the existing conventions before you write anything.

I do **not** want a wrapper over GA4. I want a first-party analytics layer stored in our own D1 database so we can join page-view data against `customers`, `orders`, `reports`, `payments`, `pipeline`, and `master_companies` / `customer_companies` directly. GA4 stays installed for marketing; this system is for product + revenue attribution.

## Phase 0 — Discovery (do this before writing code)

1. Inventory every public-facing route in `src/routes/` and `src/index.tsx`. Produce a table of: route path, handler file, whether it's a blog post / how-to / marketing page / app page / API. Save this as `docs/analytics/route-inventory.md`.
2. Find every place GA4 is currently injected. Note the GA4 measurement ID location and how the injection middleware works in `src/index.tsx`. Confirm we can piggyback on the same injection point for our first-party tracker without breaking it.
3. Read the schema for these tables and write the column lists into `docs/analytics/schema-snapshot.md`: `admin_users`, `customers`, `customer_companies`, `master_companies`, `orders`, `reports`, `payments`, `invoices`, `jobs`, `pipeline`. We'll need foreign keys against these.
4. Check the latest migration number in `migrations/` — new migrations must continue the sequence.
5. **Stop and present a written plan back to me before implementing.** Include: proposed table schemas, proposed routes, proposed admin UI pages, a list of every existing file you intend to modify, and any open questions. Do not start Phase 1 until I approve.

## Phase 1 — Data model (D1 migration)

Add a single new sequential migration `migrations/NNNN_analytics.sql` that creates these tables. Indexes are mandatory — do not skip them, this thing will be hot.

- `analytics_sessions`
  - `id` TEXT PRIMARY KEY (uuid generated client-side, stored in a first-party cookie `rm_sid`, 30-day rolling expiry)
  - `visitor_id` TEXT (uuid, longer-lived `rm_vid` cookie, 2-year expiry)
  - `started_at`, `last_seen_at` INTEGER (unix ms)
  - `landing_path` TEXT
  - `landing_referrer` TEXT
  - `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` TEXT (captured on first hit of the session)
  - `gclid`, `fbclid` TEXT
  - `country`, `region`, `city` TEXT (from `request.cf` — Cloudflare gives this for free)
  - `device_type` TEXT (`mobile` / `tablet` / `desktop`)
  - `user_agent` TEXT
  - `customer_id` INTEGER NULL (FK to `customers`, populated when the session is later identified)
  - `admin_user_id` INTEGER NULL (FK to `admin_users`, so we can exclude internal traffic)
  - `is_internal` INTEGER DEFAULT 0
  - Indexes on `visitor_id`, `customer_id`, `started_at`, `utm_source`

- `analytics_pageviews`
  - `id` INTEGER PRIMARY KEY AUTOINCREMENT
  - `session_id` TEXT (FK)
  - `visitor_id` TEXT
  - `path` TEXT NOT NULL
  - `path_template` TEXT (e.g. `/blog/:slug`, computed server-side from the matched route — this is the join key for content reporting)
  - `page_type` TEXT (`blog` / `howto` / `marketing` / `app` / `admin` / `customer-portal` / `api` / `other`)
  - `content_slug` TEXT NULL (for blog/howto)
  - `referrer` TEXT
  - `referrer_domain` TEXT (parsed)
  - `entered_at` INTEGER
  - `dwell_ms` INTEGER NULL (filled in by a beacon on unload — see Phase 2)
  - `max_scroll_pct` INTEGER NULL (0–100, from beacon)
  - `viewport_w`, `viewport_h` INTEGER
  - Indexes on `session_id`, `path_template`, `page_type`, `entered_at`, `content_slug`

- `analytics_events`
  - `id` INTEGER PRIMARY KEY AUTOINCREMENT
  - `session_id` TEXT
  - `visitor_id` TEXT
  - `customer_id` INTEGER NULL
  - `name` TEXT NOT NULL — controlled vocabulary: `cta_click`, `signup_started`, `signup_completed`, `address_searched`, `report_started`, `report_generated`, `order_created`, `payment_succeeded`, `quote_requested`, `contact_submitted`, `outbound_link`, `pdf_downloaded`, `video_played`, `form_started`, `form_abandoned`
  - `path` TEXT (page where event fired)
  - `path_template` TEXT
  - `properties` TEXT (JSON blob — keep it small)
  - `value_cents` INTEGER NULL (for revenue events)
  - `created_at` INTEGER
  - Indexes on `name`, `session_id`, `customer_id`, `created_at`

- `analytics_attribution`
  - One row per converted customer, written when an order/payment/signup happens
  - `customer_id` INTEGER PRIMARY KEY (FK)
  - `first_touch_session_id`, `last_touch_session_id` TEXT
  - `first_touch_path_template`, `last_touch_path_template` TEXT
  - `first_touch_utm_source`, `last_touch_utm_source` TEXT
  - `touch_count` INTEGER
  - `journey_path_templates` TEXT (JSON array of all distinct path_templates visited before conversion, in order, deduped)
  - `days_to_convert` INTEGER
  - `converted_at` INTEGER

- `analytics_content_daily` (denormalized rollup for fast dashboards)
  - `date` TEXT (YYYY-MM-DD)
  - `path_template` TEXT
  - `page_type` TEXT
  - `content_slug` TEXT NULL
  - `pageviews`, `unique_visitors`, `sessions_started`, `signups_attributed`, `orders_attributed` INTEGER
  - `revenue_attributed_cents` INTEGER
  - `avg_dwell_ms`, `avg_scroll_pct` INTEGER
  - PRIMARY KEY (`date`, `path_template`)
  - Refilled nightly by a Cron Trigger (see Phase 5)

Write a parallel down-migration / rollback note in a comment header.

## Phase 2 — Tracking pipeline

### Server-side capture (preferred path)

Add a Hono middleware in `src/middleware/analytics.ts` that:
- Reads/sets the `rm_vid` and `rm_sid` cookies (HttpOnly=false because the client tracker also reads them; SameSite=Lax; Secure in prod).
- Skips tracking when:
  - the path starts with `/api/`, `/static/`, `/_`, or matches an asset extension
  - the request is from an authenticated admin user (mark `is_internal=1`, still log so we can filter)
  - the `DNT` header is `1`, OR a `rm_optout=1` cookie is set
- Extracts UTM params + `gclid`/`fbclid` from the query string on the first hit of a session and writes them onto `analytics_sessions`.
- Determines `path_template` by inspecting the matched Hono route (use `c.req.routePath` if available; otherwise compute it from the route definition).
- Tags `page_type` and `content_slug` based on route. Blog handlers should set `c.set('analyticsPageType', 'blog')` and `c.set('analyticsContentSlug', slug)` and the middleware reads those after the handler runs.
- Inserts one row into `analytics_pageviews`. Use `c.executionCtx.waitUntil(...)` so the DB write never blocks the response.
- Reads `request.cf` for country/region/city/device.

### Client-side beacon (for dwell, scroll, and SPA-ish in-page nav)

Inject a tiny `<script>` (≤ 3KB minified) into every HTML response right before `</body>`. Put the source in `src/templates/analytics-beacon.ts` and inline it. The script must:
- Track scroll depth (max scroll percentage reached).
- On `pagehide` / `visibilitychange:hidden`, send a `navigator.sendBeacon` POST to `/api/_a/beacon` with `{session_id, pageview_id, dwell_ms, max_scroll_pct}`.
- Expose `window.rmTrack(name, properties, valueCents?)` for handlers to fire custom events. It posts to `/api/_a/event`.
- Auto-fire `outbound_link` events on clicks to external domains.
- Auto-fire `cta_click` for any element with `data-rm-cta="<name>"`.

### Identification

When a customer logs in, signs up, or completes a checkout, call a new helper `identifySession(c, customerId)` that:
- Sets `analytics_sessions.customer_id` for the current session **and** every previous session sharing the same `visitor_id`.
- Backfills `analytics_events.customer_id` and `analytics_pageviews` joins where applicable.
- Writes/updates the `analytics_attribution` row for that customer (compute first-touch from earliest session for that visitor_id, last-touch from current session, journey from all distinct path_templates).

Wire `identifySession` into:
- `src/routes/customer-auth.ts` (login + signup)
- The order creation handler (find it via grep on the `orders` table writes)
- The payment success webhook (Stripe and/or Square — find both)

### Event firing

Add server-side `track(c, name, properties)` calls at these existing code sites — search the repo for them, do not invent paths:
- `signup_started`, `signup_completed`
- `address_searched` (every Solar API lookup)
- `report_started`, `report_generated` (start + completion of the measurement engine flow)
- `order_created`, `payment_succeeded`
- `quote_requested`, `contact_submitted`

## Phase 3 — Super Admin analytics dashboard

Add new routes under `src/routes/admin-analytics.ts`, mounted at `/admin/analytics` (HTML pages) and `/api/admin/analytics/*` (JSON for any client-side widgets). Use the same Hono JSX patterns and admin auth middleware as existing admin pages — match the look and feel of the current admin UI exactly, do not introduce a new design system.

Pages required:

1. **Overview** (`/admin/analytics`)
   - Top-line cards: 7d / 30d / 90d totals for unique visitors, sessions, pageviews, signups, orders, revenue, conversion rate.
   - Time-series chart (visitors vs orders vs revenue, daily).
   - Acquisition source breakdown (utm_source / referrer_domain) with conversion rate per source.
   - Internal traffic excluded by default; toggle to include.

2. **Content performance** (`/admin/analytics/content`) — this is the headline feature
   - Table of every `path_template` where `page_type IN ('blog','howto','marketing')`, columns:
     - Path, Page type, Content slug
     - Pageviews (period), Unique visitors, Avg dwell, Avg scroll %
     - **Signups attributed** (count where this page is in the customer's journey; show first-touch column AND any-touch column separately)
     - **Orders attributed** and **Revenue attributed** (same: first-touch and any-touch)
     - Bounce rate (sessions where this was the only page)
     - Conversion rate per visitor
   - Filterable by date range, page_type, traffic source.
   - Sortable by every column. Default sort: revenue_attributed desc.
   - CSV export button.

3. **Customer journeys** (`/admin/analytics/journeys`)
   - For each converted customer in the period: their full ordered list of `path_template` visits with timestamps, the converting event, and revenue.
   - Sankey or simple "top journey patterns" list — top 20 most common 3-step paths that ended in conversion.

4. **Funnels** (`/admin/analytics/funnels`)
   - Pre-built funnel: `landing → address_searched → report_started → report_generated → order_created → payment_succeeded`. Show drop-off at each step, segmented by acquisition source.

5. **Live** (`/admin/analytics/live`)
   - Last 30 minutes: active sessions, current paths, recent events. Auto-refresh every 10s via a small `fetch` poll (no websockets — keep it simple).

Authorization: only `admin` and `superadmin` roles. Add a `superadmin`-only toggle to view PII (IP, exact UA, referrer URL) — default view shows aggregated/anonymized fields.

## Phase 4 — Customer tracking surfaces

In the existing customer detail page (find it under `src/routes/` — likely `admin.tsx` or `customers.tsx`), add a new "Activity" tab that shows for that customer:
- Attribution summary card (first-touch source/page, last-touch, days to convert, total touches)
- Chronological timeline of every session, pageview, and event for their `visitor_id` (paginated, newest first)
- Engagement score (simple formula, document it: `0.5*log(pageviews) + 0.3*sessions + 0.2*events`)
- "Last seen" timestamp surfaced at the top of the customer record

Also add a column "Acquisition source" to the main customers list, sortable.

## Phase 5 — Rollups and retention

- Add a Cloudflare Cron Trigger (configure in `wrangler.jsonc`, write the handler in `src/cron/analytics-rollup.ts`) that runs nightly at 03:00 UTC and:
  - Rebuilds `analytics_content_daily` for the previous day (idempotent — DELETE then INSERT).
  - Recomputes `analytics_attribution` for any customer with new sessions in the last 24h.
  - Deletes raw `analytics_pageviews` and `analytics_events` rows older than 400 days (configurable via env var `ANALYTICS_RETENTION_DAYS`).

## Phase 6 — Quality gates

Before declaring done:
- Unit tests for path_template extraction, page_type tagging, and the attribution computation (`src/services/analytics.test.ts`).
- A `docs/analytics/README.md` documenting: every event name and its trigger location, every cookie, retention policy, how to opt out, and how to read the dashboards.
- Manual smoke test script in `scripts/analytics-smoke.ts` that hits a known set of routes and asserts rows land in D1 correctly when run against the local sandbox.
- Verify GA4 still fires alongside the first-party tracker — do not regress the existing GA4 setup.
- Confirm no PII leaves Cloudflare (we never send raw IPs anywhere external; only the derived city/region from `request.cf`).

## Constraints and conventions to follow

- Match existing code style — Hono JSX, Zod for validation, repository pattern in `src/repositories/`, services in `src/services/`. Add `src/repositories/analytics.ts` for all SQL.
- Never write D1 queries inline in route handlers.
- Every new route must use the existing admin auth middleware. Do not roll your own auth.
- Keep the client beacon under 3KB minified. No dependencies. Vanilla JS.
- All timestamps in unix ms (INTEGER) to match existing patterns.
- Use `c.executionCtx.waitUntil` for every analytics write so user-facing latency is unaffected.
- Make tracking opt-out work: respect `DNT` and a visible footer link "Do not track me on this site" that sets the `rm_optout` cookie and shows confirmation.

## Deliverable order

1. The Phase 0 discovery docs + written plan → wait for approval.
2. Migration + repository + middleware + beacon (Phases 1–2).
3. Server-side event instrumentation at the listed code sites.
4. Admin dashboard pages (Phase 3).
5. Customer surfaces (Phase 4).
6. Cron + retention (Phase 5).
7. Tests + docs (Phase 6).

Commit each phase as a separate commit with a clear message. Do not squash. Do not deploy — I will run `npm run deploy:prod` myself after review.

===END PROMPT===
