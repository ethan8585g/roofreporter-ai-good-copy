# Engineered Prompt — Super-Admin Web Analytics, Funnels, Attribution & Enrichment

> Paste this entire file into a Claude Code terminal session opened at the repo root (`roofreporter-ai-good-copy`). It is self-contained: it tells Claude Code the goal, the constraints, the existing code to extend (not rewrite), the phased plan, the exact data schemas, the dashboard specs, and the acceptance criteria for each phase.

---

## 0. Role, stack, and ground rules

You are a senior full-stack engineer extending an existing Hono + Cloudflare Pages + D1 application (Roof Manager, https://www.roofmanager.ca). Your job over the next several sessions is to evolve the super-admin module into a deep web-traffic intelligence platform so the team can (a) see where visitors exit, (b) diagnose funnel drop-off, (c) attribute revenue to channels, (d) identify the companies behind anonymous traffic, and (e) replay individual sessions.

Stack you must respect:

- Runtime: Cloudflare Pages Functions + Workers, `compatibility_date: 2026-02-09`, `nodejs_compat` flag on.
- Server framework: Hono 4.11.9, JSX/HTML rendered server-side. No SPA, no bundled client framework. Any client JS is plain ES modules under `public/static/` or inlined in the route handler.
- Database: Cloudflare D1 (SQLite). Binding name is `DB` in `wrangler.jsonc`, accessed via `c.env.DB`. Queries use `db.prepare('…').bind(…).first() | .all() | .run()`. No ORM.
- Migrations: sequential files in `migrations/NNNN_name.sql`. The current head is `0152_sales_commissions.sql`. New files must start at `0153` and increase. Always use `CREATE TABLE IF NOT EXISTS`, explicit indexes, `datetime('now')` defaults.
- Types: single source of truth is `src/types.ts`. Add all new types there.
- Repositories: module-level async functions (not classes), e.g. `export async function getX(db: D1Database, id: number) { … }`. New repo file per domain: `src/repositories/analytics.ts` (already partial — extend, don't duplicate).
- Routes: one file per domain under `src/routes/`. Mount in `src/index.tsx` next to the other `app.route(…)` calls.
- Services (business logic, external APIs): `src/services/`.
- Auth: admin routes use `validateAdminSession(db, authHeader)` + `requireSuperadmin(admin)` from `src/routes/auth.ts`. Token is a `Bearer` header read from `admin_sessions`.
- Privacy posture is **first-party only, minimal**: first-party cookies, no third-party tags added (GA4 and Clarity already exist — leave them alone), no PII in event payloads (mask form values), IP stored only as a truncated `/24` and an ASN. Do not add a cookie banner yet — that's a future phase gated by legal sign-off.
- Do NOT introduce new top-level dependencies unless listed in §10. Prefer stdlib + D1 + CF primitives.

You MUST follow the repo conventions you can already observe. When in doubt, open the two most recent migrations and one existing route/repo file and mirror the style.

### What NOT to do

- Do not rip out the existing `site_analytics` table, `/api/track` beacon, `tracker.js` client, or `super-admin-bi.ts` dashboards. They are the foundation. You are extending them.
- Do not add heavyweight libraries (rrweb, posthog-js, segment, sentry, chart.js with massive bundles). Use SVG or a single lightweight chart lib only if §10 authorizes it.
- Do not log raw IPs, raw User-Agent strings with PII, email addresses, passwords, form input values, or payment data into events. Mask aggressively.
- Do not deploy any phase that lacks the acceptance checks listed for that phase.
- Do not break any existing admin or customer route. The super-admin BI dashboard must continue to work at every commit.

---

## 1. Discovery — do this before writing code

Open and read fully before editing anything:

1. `src/index.tsx` — top 400 lines (GA4 injection middleware, route mounting).
2. `src/routes/analytics.ts` — existing `POST /api/track` beacon and aggregation logic.
3. `src/routes/super-admin-bi.ts` — every existing BI endpoint.
4. `src/routes/auth.ts` — `validateAdminSession` and `requireSuperadmin`.
5. `src/repositories/reports.ts` — repository convention.
6. `migrations/0018_site_analytics.sql` — the existing event table schema.
7. `migrations/0151_inbox_read_state.sql` and `migrations/0152_sales_commissions.sql` — current style.
8. `public/static/tracker.js` — current browser tracker (find it; if it is at a different path, locate it with grep and note the location).
9. `wrangler.jsonc` and `package.json` — bindings and dependencies.
10. `src/types.ts` — `Bindings` interface and existing entity types.

Produce a short internal `DISCOVERY.md` (in the repo root, git-ignored — add it to `.gitignore`) that records: (a) the exact column list of `site_analytics`, (b) the exact endpoints already mounted under `/api/admin/bi/*`, (c) the current set of events the tracker emits, (d) any gaps vs this prompt. Use it as your working notes across phases. Do not commit DISCOVERY.md.

After discovery, if anything in §2–§9 contradicts what you found (e.g., a column already exists), prefer reality — adjust the plan and note the deviation in DISCOVERY.md, then continue.

---

## 2. Goals, non-goals, and success metrics

### Goals

1. Every page view, click, scroll milestone, form interaction, and exit on `roofmanager.ca` is captured to D1 as a well-typed event, attributable to a visitor and a session, with UTM and referrer preserved across the session.
2. The super-admin can define funnels (1..N steps, each step a URL/event predicate) and view step-by-step drop-off, conversion rate, median time-between-steps, and a breakdown by source/medium/device over a selectable window.
3. The super-admin can open any page and see: top exits, scroll depth distribution, rage/dead-click coordinates (heatmap), time-to-first-interaction, and the ranked list of CTAs that received clicks vs. those that did not.
4. Anonymous B2B visitors are enriched (where possible) with company name, industry, size, and a confidence score, and surfaced in a "Company Reveal" feed in the super-admin.
5. Multi-touch attribution: every paid order is linked to the chain of UTM touches that preceded it, and revenue is attributed by first-touch, last-touch, linear, and time-decay models.
6. Session replay-lite: for any visitor, the super-admin can scrub a timeline of their events across sessions (no DOM recording — just event stream + URL + timings + click coords + scroll position). Enough to reconstruct "what did this visitor do".

### Non-goals (for this prompt)

- Full DOM session recording (rrweb-style). Too heavy for D1 / R2 budgets at this stage.
- Replacing GA4 or Clarity. Keep them. Augment, don't compete.
- A/B testing framework. Design leaves hooks for it but does not build it.
- Cookie consent UI. Minimal posture assumes first-party, no PII, no banner required today.

### Success metrics (measured 2 weeks after Phase 5 ships)

- 100% of pageviews on public pages emit a `pageview` event recorded in `analytics_events` within 2s (p95).
- Super-admin can answer "what's the drop-off between pricing and order?" in under 5 seconds of dashboard load.
- At least one funnel definition is live and updates nightly.
- IP→company enrichment succeeds on ≥30% of non-residential visitor sessions.
- For any paid order in the last 30 days, a super-admin can see the full attribution chain in ≤2 clicks.

---

## 3. Architecture (read carefully before coding)

```
Browser
  ├─ /static/tracker.js           (extend existing)
  │    · pageview, click, scroll, form, heartbeat, exit, visibility
  │    · first-party cookie rm_vid (visitor_id, 2y) + sessionStorage rm_sid
  │    · queues events, flushes on 1s debounce or sendBeacon on unload
  │    · UTMs captured on landing, stored in rm_attribution cookie
  │
  ▼ (navigator.sendBeacon → POST /api/track  no CORS, 204 no body)
Cloudflare Pages Function
  ├─ src/routes/analytics.ts (ingestion)
  │    · validate + bot-filter + truncate IP + parse UA
  │    · insert into analytics_events (raw)
  │    · update analytics_sessions rollup
  │    · enqueue enrichment job if new IP + new session (via D1 work queue table)
  │
  ▼
D1 tables (§4)
  · analytics_events    — raw event stream
  · analytics_sessions  — per-session rollup
  · analytics_visitors  — stable visitor profile
  · analytics_daily     — pre-aggregated for dashboards
  · funnel_definitions  — configurable funnels
  · funnel_results      — nightly-materialized funnel metrics
  · attribution_touches — UTM/referrer touches per visitor (append-only)
  · attribution_conversions — order_id → touch chain
  · ip_company_cache    — IP/ASN → company lookup
  · tracking_jobs       — simple queue rows (enrichment, aggregation)
  │
  ▼
Super-admin API  (src/routes/super-admin-bi.ts + new super-admin-analytics.ts)
  · GET /api/admin/bi/pages/top-exits
  · GET /api/admin/bi/pages/:path/detail   (scroll/heatmap/CTAs)
  · GET /api/admin/bi/funnels               (list/upsert definitions)
  · GET /api/admin/bi/funnels/:id/results
  · GET /api/admin/bi/attribution/models
  · GET /api/admin/bi/attribution/orders/:id
  · GET /api/admin/bi/companies/revealed    (enrichment feed)
  · GET /api/admin/bi/visitors/:vid/timeline  (replay-lite)
  · POST /api/admin/bi/aggregate/run       (manual re-roll trigger)
  │
  ▼
Super-admin UI (Hono JSX under src/templates/admin-analytics/*.tsx)
  · Pages Intelligence page
  · Funnel Builder page
  · Attribution page
  · Company Reveal feed page
  · Visitor Timeline page
```

Aggregation runs as:

- A Cron trigger (added to `wrangler.jsonc`) that hits `POST /api/internal/analytics/aggregate` on a 15-minute interval for incremental rollups, plus a nightly job at 04:10 UTC for full day rollups and funnel materialization. Protect with a shared-secret header `X-Internal-Cron-Secret` from a new env var `INTERNAL_CRON_SECRET`.
- If D1 CPU time becomes a bottleneck, consider moving aggregation to a Queue consumer in a later phase — not now.

---

## 4. Data model (authoritative)

Create these as new migrations starting at `0153_`. One table per migration file, named `0153_analytics_events.sql`, `0154_analytics_sessions.sql`, etc. Follow existing style (IF NOT EXISTS, indexes, `datetime('now')`).

All timestamp columns are TEXT ISO-8601 for consistency with current schema. Keep `site_analytics` as-is; the new `analytics_events` is the forward schema. Write a one-off backfill script that dual-writes `site_analytics` → `analytics_events` for a transition window (Phase 1), then route all new ingestion to `analytics_events`.

### 4.1 `analytics_events` — raw event stream

Columns (partial; complete these with sensible types):

- `id INTEGER PK AUTOINCREMENT`
- `event_id TEXT NOT NULL UNIQUE`  — client-generated ULID
- `event_name TEXT NOT NULL`  — `pageview | click | scroll | form_focus | form_submit | form_abandon | rage_click | dead_click | exit_intent | page_exit | heartbeat | cta_impression | cta_click | video_play | download`
- `occurred_at TEXT NOT NULL`  — client timestamp (ISO)
- `received_at TEXT NOT NULL DEFAULT (datetime('now'))`
- `visitor_id TEXT NOT NULL`
- `session_id TEXT NOT NULL`
- `user_id INTEGER NULL`  — FK to `customers.id` or `admin_users.id` when known
- `user_type TEXT NULL`   — `anon | customer | admin`
- `page_url TEXT NOT NULL`  — full URL, query-stripped below
- `page_path TEXT NOT NULL`
- `page_title TEXT`
- `referrer TEXT`
- `utm_source TEXT`, `utm_medium TEXT`, `utm_campaign TEXT`, `utm_term TEXT`, `utm_content TEXT`, `gclid TEXT`, `fbclid TEXT`
- `device TEXT`, `browser TEXT`, `os TEXT`, `screen_w INTEGER`, `screen_h INTEGER`, `viewport_w INTEGER`, `viewport_h INTEGER`, `is_mobile INTEGER`
- `geo_country TEXT`, `geo_region TEXT`, `geo_city TEXT`, `geo_asn INTEGER`, `geo_asn_org TEXT`  — from CF request headers
- `ip_prefix TEXT`  — first three octets + `.0` (e.g. `203.0.113.0`), never the full IP
- `element_selector TEXT`  — CSS selector of clicked element (truncated 512)
- `element_text TEXT`  — up to 140 chars, stripped
- `element_coords_x INTEGER`, `element_coords_y INTEGER`  — relative to viewport
- `scroll_depth_pct INTEGER`  — 0..100
- `time_on_page_ms INTEGER`
- `page_load_ms INTEGER`, `first_contentful_paint_ms INTEGER`, `largest_contentful_paint_ms INTEGER`, `cls REAL`, `inp_ms INTEGER`
- `properties JSON`  — TEXT holding JSON for event-specific extras
- Indexes: `(visitor_id, occurred_at)`, `(session_id, occurred_at)`, `(event_name, occurred_at)`, `(page_path, occurred_at)`, `(received_at)`

### 4.2 `analytics_sessions` — per-session rollup

- `session_id TEXT PK`
- `visitor_id TEXT NOT NULL`
- `started_at TEXT`, `ended_at TEXT`
- `entry_url TEXT`, `exit_url TEXT`
- `pageviews INTEGER`, `events INTEGER`
- `duration_ms INTEGER`
- `is_bounce INTEGER`  — 1 pageview, < 10s dwell
- `utm_source TEXT`, `utm_medium TEXT`, `utm_campaign TEXT`  — first-touch of session
- `referrer_host TEXT`
- `device TEXT`, `browser TEXT`, `os TEXT`, `is_mobile INTEGER`
- `geo_country TEXT`, `geo_region TEXT`, `geo_city TEXT`
- `asn INTEGER`, `asn_org TEXT`
- `ip_prefix TEXT`
- `company_id INTEGER NULL`  — FK to `ip_company_cache.id` when enrichment succeeds
- `converted_event TEXT NULL`  — e.g. `order_created`, `signup`
- `converted_at TEXT NULL`
- `converted_value REAL NULL`
- Indexes: `(visitor_id)`, `(started_at)`, `(company_id)`, `(converted_event)`

### 4.3 `analytics_visitors` — stable visitor profile (one row per `visitor_id`)

- `visitor_id TEXT PK`
- `first_seen_at TEXT`, `last_seen_at TEXT`
- `first_utm_source`, `first_utm_medium`, `first_utm_campaign`
- `first_referrer_host TEXT`
- `first_landing_path TEXT`
- `sessions INTEGER`, `pageviews INTEGER`, `events INTEGER`
- `customer_id INTEGER NULL`  — when identified via login/signup
- `known_company_id INTEGER NULL`
- `is_lead INTEGER DEFAULT 0`, `is_customer INTEGER DEFAULT 0`
- Indexes: `(customer_id)`, `(known_company_id)`, `(last_seen_at)`

### 4.4 `analytics_daily` — pre-aggregated for dashboards

One row per `(day, page_path, utm_source, utm_medium, device, geo_country)` bucket. Columns: counts of pageviews, sessions, uniques, conversions, sum revenue. Index on `(day, page_path)` and `(day, utm_source, utm_medium)`.

### 4.5 `funnel_definitions`

- `id INTEGER PK AUTOINCREMENT`
- `name TEXT NOT NULL`
- `slug TEXT UNIQUE NOT NULL`
- `window_hours INTEGER NOT NULL DEFAULT 168`  — 7d default
- `steps JSON NOT NULL`  — ordered array, each step `{name, predicate: {type: 'pageview'|'event', match: {path?:string|regex, event_name?:string, properties?:object}}}`
- `is_active INTEGER DEFAULT 1`
- `created_at`, `updated_at`

Ship these default funnels in a seed-style migration so the super-admin has something to view on day one:

- "Landing → Quote" — `/` → `/pricing` → `/order` → `order_created` event
- "Pricing → Paid" — `/pricing` → `order_created` → `payment_completed`
- "Signup → First Order" — `signup` → `order_created`
- "Blog → Pricing → Order" — `page_path LIKE '/blog%'` → `/pricing` → `/order`

### 4.6 `funnel_results`

Materialized nightly. One row per `(funnel_id, day, step_index)` with: `entered`, `completed`, `median_time_to_complete_ms`, `segment_json` (per-source/device breakdown as JSON).

### 4.7 `attribution_touches`

Append-only log of every UTM/referrer touch per visitor.

- `id INTEGER PK AUTOINCREMENT`
- `visitor_id TEXT`, `session_id TEXT`
- `touched_at TEXT`
- `source TEXT`, `medium TEXT`, `campaign TEXT`, `term TEXT`, `content TEXT`
- `gclid TEXT`, `fbclid TEXT`
- `referrer_host TEXT`
- `landing_path TEXT`
- Indexes: `(visitor_id, touched_at)`

### 4.8 `attribution_conversions`

- `id INTEGER PK AUTOINCREMENT`
- `order_id INTEGER NULL`, `signup_id INTEGER NULL`
- `visitor_id TEXT`
- `converted_at TEXT`
- `revenue REAL`
- `chain JSON`  — ordered array of the touches preceding conversion
- `first_touch_source`, `first_touch_medium`, `first_touch_campaign`
- `last_touch_source`, `last_touch_medium`, `last_touch_campaign`
- Indexes: `(order_id)`, `(visitor_id)`, `(converted_at)`

### 4.9 `ip_company_cache`

- `id INTEGER PK AUTOINCREMENT`
- `ip_prefix TEXT`  — `/24`
- `asn INTEGER`
- `company_name TEXT`, `company_domain TEXT`, `industry TEXT`, `employee_range TEXT`
- `country TEXT`, `region TEXT`, `city TEXT`
- `confidence REAL`  — 0..1
- `is_residential INTEGER DEFAULT 0`  — if ISP or residential, skip reveal
- `source TEXT`  — `ipinfo | internal | manual`
- `fetched_at TEXT`
- UNIQUE `(ip_prefix, asn)`

### 4.10 `tracking_jobs`

Simple queue table.

- `id INTEGER PK AUTOINCREMENT`
- `job_type TEXT`  — `enrich_ip | materialize_funnel | rollup_daily | attribute_order`
- `payload JSON`
- `status TEXT`  — `pending | in_progress | done | failed`
- `attempts INTEGER DEFAULT 0`
- `last_error TEXT`
- `run_after TEXT DEFAULT (datetime('now'))`
- `updated_at TEXT`
- Index `(status, run_after)`

### 4.11 Add FKs where cheap

Add a nullable `visitor_id TEXT` column to `orders` and `customers` via `ALTER TABLE … ADD COLUMN` in a migration. Back-populate via a one-off script where possible (match by customer email → most recent visitor_id seen on a signup event).

---

## 5. Client tracker (`public/static/tracker.js`) — extend, don't rewrite

Read the current file first. Add the following capabilities in modules inside the same file (keep it a single file, under 10 KB gzipped).

1. **Visitor/session identity.** If `rm_vid` cookie missing, generate ULID, set 2-year first-party cookie `SameSite=Lax; Secure`. Session id lives in `sessionStorage`, 30-min inactivity rollover.
2. **Attribution capture.** On landing (document.referrer is cross-origin OR URL has `utm_*`/`gclid`/`fbclid`): write `rm_attribution` cookie `{source, medium, campaign, term, content, referrer_host, landing_path, touched_at}` with 90-day TTL. Also append a touch event to the queue.
3. **Pageview.** Fire on initial load and on `pushState`/`popstate` (listen for history changes). Debounce 100ms.
4. **Heartbeat.** Every 10s while `document.visibilityState === 'visible'`, send an event with `time_on_page_ms`. Use `Page Visibility API` — do not tick when backgrounded.
5. **Scroll depth.** Fire `scroll` events at 25/50/75/100% milestones, de-duplicated per page.
6. **Click capture.** Capture all bubbling clicks. For each: CSS selector (shortest unique), truncated text, viewport coords, `data-cta` attribute if present.
7. **Rage click.** 3+ clicks within 1s at within 50px radius. Emit `rage_click`.
8. **Dead click.** A click that produces no DOM mutation, no URL change, and no `scroll`/`network` within 1.5s. Emit `dead_click`.
9. **Exit intent.** Mouse leaves through viewport top at ≥10 px/ms. Desktop only. Emit `exit_intent`.
10. **Form tracking.** On `focus`, emit `form_focus` (form id + field name only, never value). On submit, emit `form_submit`. If user leaves page with a form touched but not submitted, emit `form_abandon` with field-name list.
11. **Web vitals.** Use `PerformanceObserver` for FCP, LCP, CLS, INP. Emit once per page.
12. **Queue + flush.** Ring buffer in memory. Flush on 1s idle debounce, or on 20 events, or on `pagehide`/`visibilitychange=hidden` via `navigator.sendBeacon`.
13. **Payload shape.** POST `/api/track` with `{events: Event[]}` JSON body. Each event has the columns listed in 4.1 (client-controllable subset). Server fills server-side fields.
14. **Masking.** Never include `value` from inputs, never include URLs containing `?token=`/`?key=`, strip `password`, `pwd`, `email` query params server-side too.
15. **Do-not-track.** If `navigator.doNotTrack === '1'`, still send pageviews with `properties.dnt=1` but drop heartbeats, clicks, and rage/dead detection. Document this in code comments.
16. **Feature flag.** A global `window.RM_TRACKING_DISABLED = true` short-circuits everything. Super-admin pages set this flag so internal browsing doesn't pollute data.

Write small unit-testable helpers (ULID, selector builder, debouncer) as pure functions at the top. Keep file ASCII-only, no build step.

---

## 6. Ingestion endpoint — `src/routes/analytics.ts`

Current `/api/track` writes to `site_analytics`. Extend (do not replace) as follows:

1. Accept the new payload shape `{events: Event[]}`. For backward-compat also accept the legacy single-event shape for 30 days.
2. For each event:
   - Validate with Zod in `src/utils/validation-schemas.ts` — reject malformed, log counter.
   - Bot filter (regex list already present — reuse).
   - Truncate IP to `/24` before storing (never store full IP).
   - Parse UA (reuse existing helper if present; else add a minimal parser in `src/utils/ua.ts`).
   - Read CF geo headers (`cf-ipcountry`, `cf-region`, `cf-ipcity`, `cf-connecting-ip`, `cf-ray`, `cf-asn` if available).
   - Insert into `analytics_events` AND dual-write to `site_analytics` for 30 days (feature flag env var `ANALYTICS_DUAL_WRITE=1`).
   - Update `analytics_sessions` row (upsert by `session_id`).
   - Upsert `analytics_visitors`.
   - If UTM/gclid/fbclid present, append row to `attribution_touches`.
   - If this is the first event this session from a previously-unseen `ip_prefix` AND geo suggests non-residential, enqueue a `tracking_jobs` row `job_type='enrich_ip'`.
3. Respond 204 with no body. Always. Use `waitUntil` for DB writes via `c.executionCtx.waitUntil(…)` so the client is not blocked.
4. Rate limit per `visitor_id`: drop events if > 200/minute.

Acceptance: a curl of a sample payload inserts into `analytics_events` and `analytics_sessions` correctly; invalid payloads return 204 but increment a counter and are not stored.

---

## 7. Aggregation, enrichment, attribution jobs

Create `src/services/analytics-aggregation.ts` and `src/services/analytics-enrichment.ts` and `src/services/analytics-attribution.ts`.

### 7.1 Scheduled trigger

Add to `wrangler.jsonc`:
```jsonc
"triggers": { "crons": ["*/15 * * * *", "10 4 * * *"] }
```

Wire the scheduled handler in `src/index.tsx` (export `scheduled(event, env, ctx)`). Inside, check `event.cron`:

- `*/15 * * * *` → run `rollupIncremental(env.DB)` + `processTrackingJobs(env, 50 jobs max)` + `materializeFunnels(env.DB, onlyActive=true)` (cheap increments).
- `10 4 * * *` → run full daily rollup and full funnel materialization plus orphan cleanup (delete events > 180 days where allowed).

### 7.2 Rollups

- `rollupIncremental`: for the last 30 minutes of events, upsert into `analytics_daily` bucket rows.
- `rollupFullDay(dayISO)`: re-compute a given day from scratch (idempotent).

### 7.3 Enrichment

`processTrackingJobs` pulls `pending` rows ordered by `run_after`. For `enrich_ip`:

- Check `ip_company_cache` by `(ip_prefix, asn)` — if hit and fresh (<30d), attach to session and return.
- Otherwise call IPinfo (env var `IPINFO_TOKEN`). Endpoint: `https://ipinfo.io/{ip}/json?token=…`. We only send the truncated `/24` by appending `.1` for lookup.
- Free alternative fallback (no token): use the CF `cf-asn` header's ASN lookup against a static JSON table bundled under `src/data/asn-companies.json` (seed with top 5k company ASNs). Add a stub loader and document how to refresh.
- Mark `is_residential=1` for residential ASNs (Comcast, Rogers, Bell, TELUS, etc.) and skip reveal.
- Write to `ip_company_cache` and link `analytics_sessions.company_id`.

Do not call a paid enrichment vendor in code-default; leave `IPINFO_TOKEN` optional. If absent, enrichment falls back to ASN-only data.

### 7.4 Attribution

Hook: when an `order` row transitions to `payment_status='paid'` in `src/routes/square.ts` and `src/routes/orders.ts`, enqueue `attribute_order` with `{order_id}`.

`attribute_order` job:

- Find the `visitor_id` associated with the order (via `orders.visitor_id` if set, else by `customers.id` → last visitor row).
- Pull `attribution_touches` for that visitor ordered by time, within 90 days before conversion.
- Compute first-touch, last-touch, linear (equal), and time-decay (7-day half-life) attributions.
- Insert into `attribution_conversions` with `chain` JSON and the four model results (store last-touch + first-touch as columns; full model map lives in `chain` JSON).

### 7.5 Funnel materialization

For each active `funnel_definitions.row`, compute for the last N days:

- Unique visitors entering step 1 (matched the predicate at least once in the window).
- For each subsequent step, the subset who also matched that step in-order within `window_hours` from step 1.
- Median time between consecutive steps.
- A segmented breakdown by source/medium/device (small fixed set — keep cardinality under 50).

Write to `funnel_results`. Prior day rows are overwritten. Idempotent.

---

## 8. Super-admin API & UI

### 8.1 New route file `src/routes/super-admin-analytics.ts`

Mount in `src/index.tsx` at `app.route('/api/admin/analytics', superAdminAnalytics)`. Apply `validateAdminSession` + `requireSuperadmin` on every endpoint.

Endpoints (all GET unless noted):

- `GET /api/admin/analytics/overview?from=…&to=…` — high-level KPIs: uniques, sessions, pageviews, bounce rate, new vs returning, top sources, top devices, top countries.
- `GET /api/admin/analytics/pages/top-exits?from=…&to=…&limit=50` — pages ranked by exit count and exit rate, with "average scroll depth before exit" and "last CTA clicked before exit" columns.
- `GET /api/admin/analytics/pages/detail?path=…&from=…&to=…` — for a single page: scroll-depth histogram (0/25/50/75/100 buckets), heatmap sample (bucket clicks into 32x18 grid; return cell counts), rage/dead click list with top-10 selectors, CTA performance (`data-cta` attribute aggregates), time-on-page distribution.
- `GET /api/admin/analytics/funnels` / `POST /api/admin/analytics/funnels` (create/update) / `DELETE /api/admin/analytics/funnels/:id`.
- `GET /api/admin/analytics/funnels/:id/results?from=…&to=…&segment=source|medium|device|none` — step-by-step metrics.
- `GET /api/admin/analytics/attribution/overview?from=…&to=…&model=first|last|linear|decay` — revenue by channel under chosen model.
- `GET /api/admin/analytics/attribution/orders/:orderId` — full touch chain for a single order.
- `GET /api/admin/analytics/companies?from=…&to=…&minConfidence=0.5` — Company Reveal feed.
- `GET /api/admin/analytics/visitors/:vid/timeline` — ordered event list (cap 1000, paginated) for replay-lite.
- `GET /api/admin/analytics/visitors/search?q=…` — search by email (if identified), visitor_id prefix, or company name.
- `GET /api/admin/analytics/live` — last 5 min active sessions (reuse existing live-visitors if it exists; supersede if better).
- `POST /api/admin/analytics/aggregate/run?day=…` — manually re-run a day's rollup (superadmin only).

All JSON responses must be `{ok: true, data: …}` on success and `{ok: false, error: string}` on failure, matching existing admin conventions. Look at `super-admin-bi.ts` for the exact shape.

### 8.2 UI pages

Render server-side with Hono JSX. One component per page under `src/templates/admin-analytics/`. Mount admin HTML routes in `src/index.tsx` (match the pattern used for existing admin pages). Pages:

- `/admin/analytics` — Overview. Small summary cards (totals), 14-day sparkline (inline SVG — see §10), top-sources table, devices pie (SVG), geo table.
- `/admin/analytics/pages` — Pages Intelligence. Sortable table of pages with columns: path, pageviews, unique visitors, avg scroll depth, exit rate, avg time on page, rage clicks, dead clicks. Click row → drill-in.
- `/admin/analytics/pages/:path*` — Page Detail. Scroll-depth histogram, click heatmap (SVG grid cells shaded by count), rage/dead-click selector list, CTA table, exit-next-page flow.
- `/admin/analytics/funnels` — list + "New funnel" modal with a step builder (up to 8 steps, each step = pageview path pattern or event name + optional property match). Submit → POST.
- `/admin/analytics/funnels/:id` — funnel detail: step cards with counts + drop-off %, mini-sankey (SVG) across segments, time-to-complete histogram.
- `/admin/analytics/attribution` — model selector (first/last/linear/decay), table of source → revenue, line chart of channel revenue over time.
- `/admin/analytics/attribution/orders/:id` — touch-chain waterfall.
- `/admin/analytics/companies` — Company Reveal feed: rows of `(company_name, industry, pages_visited, last_seen, visits, country, confidence)`, linkable to a filtered visitor timeline.
- `/admin/analytics/visitors/:vid` — timeline list with per-event icons and URLs, click-coord mini-map, and a "jump to session boundary" control.

Every UI page must:

- Set `window.RM_TRACKING_DISABLED = true` in an inline `<script>` at the top of `<head>` so admin browsing is never counted.
- Use only TailwindCSS classes already in the build. This repo is on Tailwind 4 with CSS-first config — inspect `public/static/tailwind.css` and existing admin templates for the palette and custom utilities. Do not add new colors or plugins.
- Degrade gracefully when a data series is empty (empty state with a one-line hint, no crashed tables).
- Export CSV of the current table via a `?format=csv` query on the same API endpoint.

### 8.3 Charting

Write small inline-SVG chart helpers in `src/templates/admin-analytics/_charts.tsx`: `<Sparkline>`, `<BarList>`, `<PieSvg>`, `<Histogram>`, `<HeatmapGrid>`, `<SankeyMini>`. Keep each under ~80 LOC. No external chart lib.

---

## 9. Integration: tie conversions to visitors

Change these existing spots (carefully):

- `src/routes/customer-auth.ts` signup success: after creating the customer, read `rm_vid` cookie and set `customers.visitor_id = rm_vid`. Also upsert `analytics_visitors.customer_id` and emit a server-side `signup` event into `analytics_events`.
- `src/routes/orders.ts` order creation: read `rm_vid`, set `orders.visitor_id`, emit `order_created` server event.
- `src/routes/square.ts` payment webhook success: emit `payment_completed` server event AND enqueue `attribute_order` job.
- `src/services/ga4-events.ts`: after each server-side GA4 call, also write the same event shape to `analytics_events` so server events land in the same stream. Gate behind `ANALYTICS_SERVER_MIRROR=1`.

Use a tiny helper `insertServerEvent(db, partialEvent)` in `src/repositories/analytics.ts` so these call sites stay small.

---

## 10. Allowed new dependencies

Only these. Justify in the PR description if you add anything beyond this list.

- `ulid` (tiny, ~1 KB) — server-side ULID for `event_id` when backfilling. Client does its own 20-line ULID.
- `zod` — already in the repo, use it for payload validation.
- Nothing else. No `chart.js`, no `d3`, no `rrweb`, no `lodash`.

---

## 11. Phased rollout & acceptance criteria

Do the phases in this order. Do not start a phase until the previous phase's checks pass. Every phase ends with a commit and an update to DISCOVERY.md.

### Phase 1 — Foundations (schema, ingestion, tracker v2)

Deliverables: migrations 0153–0162 (or whatever numbers), `analytics.ts` ingestion extended, `tracker.js` extended, dual-write flag on, server-event helper in place, server events wired into signup/order/payment.

Acceptance:
- Visit a public page. `analytics_events` has rows with `event_name='pageview'` and a populated `visitor_id`, `session_id`, UTM (if present), device.
- Click, scroll to 50%, and leave. Rows exist for `click`, `scroll`, `page_exit`, and a `heartbeat` or two.
- `analytics_sessions` has a rollup row.
- `attribution_touches` has at least one row if UTMs were present.
- `site_analytics` is still being written (dual-write).
- Super-admin BI dashboard still loads correctly.

### Phase 2 — Funnels & Pages Intelligence

Deliverables: funnel tables + defaults, funnel materialization job, pages-intelligence API endpoints, UI pages `/admin/analytics`, `/admin/analytics/pages`, `/admin/analytics/pages/:path*`, `/admin/analytics/funnels`, `/admin/analytics/funnels/:id`.

Acceptance:
- The four default funnels have rows in `funnel_results` after one manual `POST /aggregate/run`.
- The Pages page shows ≥ the last 24h of activity and sorts correctly.
- The Page Detail page renders a scroll histogram, a heatmap grid, and a rage/dead-click selector list.
- The Funnel detail page shows step cards with drop-off % and matches a hand-run SQL count (document the SQL you verified with).

### Phase 3 — Enrichment & Attribution

Deliverables: `ip_company_cache` population (ASN-only fallback works without IPinfo token), `attribution_conversions` populated on paid orders, `/admin/analytics/attribution`, `/admin/analytics/companies` pages.

Acceptance:
- Triggering a paid-order webhook in dev results in an `attribution_conversions` row with a non-empty `chain`.
- Company Reveal feed shows ≥ some rows when you visit from non-residential IPs. Residential IPs are filtered.
- Attribution Overview page renders sane splits under each of first/last/linear/decay.

### Phase 4 — Visitor Timeline (Replay-lite) & Search

Deliverables: `/admin/analytics/visitors/search`, `/admin/analytics/visitors/:vid`, timeline UI.

Acceptance:
- Searching by email of an identified customer finds their visitor(s) in under 1s.
- Timeline renders up to 1000 events with icons and timestamps. Click-coord mini-map draws dots at captured coordinates.
- Admin browsing is not visible in any visitor timeline (verify `RM_TRACKING_DISABLED` is effective).

### Phase 5 — Hardening & cutover

Deliverables: kill dual-write after 30 days, add retention job (delete raw events > 180 days, keep `analytics_daily` forever), move aggregation to Cron stably, add dashboard-wide date-range picker with presets, add CSV export on every table endpoint, add e2e smoke tests under `tests/analytics/*.test.ts` with Vitest.

Acceptance:
- Smoke tests pass in CI.
- D1 storage growth ≤ 2 MB/day at current traffic (measure).
- Nightly Cron runs succeed two nights in a row; check logs.

---

## 12. Testing & verification

For every phase:

- Add Vitest unit tests for pure helpers (`ulid`, `selector builder`, `rollup math`, `attribution models`) under `src/**/__tests__/` or mirror the existing pattern (`src/utils/geo-math.test.ts`).
- Add an integration test per API endpoint that hits `c.env.DB` via the miniflare/wrangler test harness (see if one exists; if not, add a minimal harness file and document it).
- Manual verification checklist per phase (screenshot a row in D1, paste the SQL you used to double-check counts).
- Performance: measure ingestion p95 with `k6` or `autocannon` hitting `/api/track` with synthetic payloads; p95 must remain < 100 ms.

Before each PR:

- `npm run build` clean.
- `npx vitest run` all green.
- `npm run dev:sandbox` and click through each super-admin analytics page with devtools open — no console errors, no 4xx/5xx in Network.

---

## 13. Observability & ops

- Add a `analytics_ingest_errors` D1 table (or write to an existing errors table if present) recording: timestamp, error kind, truncated payload, event count. Expose a simple super-admin view to eyeball.
- Instrument ingestion latency: compute `received_at - occurred_at` and log into `analytics_events.properties.ingest_latency_ms` when > 5s. Surface a count in the Overview dashboard.
- Document env vars added in README:
  - `INTERNAL_CRON_SECRET` (required)
  - `IPINFO_TOKEN` (optional; enrichment degrades without it)
  - `ANALYTICS_DUAL_WRITE` (set to `1` during Phase 1–5 transition; remove after)
  - `ANALYTICS_SERVER_MIRROR` (set to `1` to copy GA4 server events into `analytics_events`)
- Log with `console.log({ tag: 'analytics.ingest', ... })` prefixes to make Cloudflare Logs filterable.

---

## 14. Concrete first moves for session one

When you start, do exactly this before anything else:

1. Read the 10 files listed in §1.
2. Write `DISCOVERY.md` (git-ignored) with your findings and add it to `.gitignore`.
3. Open a branch `analytics/phase-1-foundations`.
4. Draft the Phase 1 migrations as files but do NOT apply yet — show them to me for review. Use `migrations/0153_analytics_events.sql` through however many Phase 1 needs (expected: events, sessions, visitors, daily, tracking_jobs, attribution_touches, alter orders/customers for visitor_id).
5. After migrations are approved, apply them locally via `npm run db:migrate:local`, seed any default rows, and proceed to ingestion extension and tracker extension.
6. Commit at each meaningful step with conventional commits (`feat(analytics): add analytics_events migration`, etc.).

When you deliver Phase 1 acceptance, write a short summary in the PR body: what migrated, what the tracker now captures, curl examples of `/api/track`, a sample row, and known limitations.

---

## 15. Style & taste

- Keep every new file under 400 lines. Split by concern.
- No `any` unless truly unavoidable; prefer Zod inference + the `Bindings` type.
- Comment intent, not mechanics. "Why this bucket size" beats "increment counter by 1".
- Error messages are for the super-admin reading them at 11pm — clear and actionable.
- No emoji in code or UI unless matching existing convention.
- SQL is uppercase keywords, lowercase identifiers, trailing-comma-free. Match existing migrations.
- Every new endpoint's response shape documented via a TS type in `src/types.ts`.

---

## 16. Escape hatches & open questions

If you discover during discovery that the existing `site_analytics` table and dashboards already cover a specific item (e.g., it already records rage clicks), skip the duplicate work and note it in DISCOVERY.md. The spec here is the target state, not a mandate to re-create what's there.

If you need a paid enrichment vendor to hit the 30% reveal rate, stop and ask before adding one. The default build must work with IPinfo's free tier or ASN-only fallback.

If D1 write throughput becomes a concern (> 1M events/day), stop and propose a Queue + batched insert pattern before pushing more traffic into raw D1.

---

## 17. Done-done definition

This entire initiative is "done-done" when:

1. All five phases are deployed to production and stable for two weeks.
2. The super-admin can answer each of these in < 10 seconds from the dashboard: top 3 exit pages last week; conversion rate of the "Pricing → Paid" funnel last 7d by source; revenue attributable to `utm_source=google utm_medium=cpc` last 30d under last-touch; the five most recent companies that visited `/pricing`.
3. Signups and paid orders are reliably linked to their visitor and touch chain.
4. A timeline exists for any identified customer and replay-lite is usable to debug a specific customer's journey.
5. DISCOVERY.md, README env-var doc, and a top-level `docs/analytics.md` (architecture + data dictionary + runbook) are written.

Start with §1 discovery. Report back with DISCOVERY.md before writing migrations.
