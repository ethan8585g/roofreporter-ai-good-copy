# Claude Code Prompt — Roof Manager Instagram Super-Admin Module

> **Paste everything below this line into your Claude Code terminal.** It is self-contained, grounded in the existing codebase conventions, and prescriptive. It is a build prompt — do not execute it against production without reading the Definition of Done at the bottom.

---

## 0. Mission

Add a new Super-Admin module called **Instagram** to the Roof Manager codebase at `/src/routes/`, wired into the existing admin UI at `public/static/admin.js`. The module is a single-brand social-media operating system for Roof Manager's own Instagram account, designed to maximize qualified roofing leads at the lowest possible cost-per-lead (CPL). It runs a five-phase workflow (Data → Research → Production → Ideation → Publishing), exposes four dashboards, and includes four power-user skills. All content production is AI-generated (Gemini scripts + AI voiceover + licensed stock), and all leads are attributed through three parallel channels (UTM, DM keywords, dynamic phone numbers).

Read this whole document before writing a single line of code. Then follow the order in Section 14 (Execution Order). Do not skip the migration, the secrets block, or the Definition of Done.

---

## 1. Stack & Conventions You Must Follow

The codebase has strict conventions. Mirror them exactly — do not introduce new patterns.

| Concern | Convention | Reference |
|---|---|---|
| Router | Hono on Cloudflare Pages/Workers | `src/index.tsx` |
| Route mounting | `/api/admin/{module}` under existing admin mount pattern | `src/index.tsx` around line 336 |
| Auth | `validateAdminSession` + `requireSuperadmin(admin)` (role `superadmin`) | `src/routes/auth.ts:103-106` |
| DB | Cloudflare D1 via `c.env.DB.prepare(...).bind(...).first()/all()` — **no ORM** | `src/routes/orders.ts` for pattern |
| Response envelope | `{ success: boolean, data?: any, error?: string }` | all existing routes |
| Migrations | Next file is `migrations/0146_instagram_module.sql` (latest is `0145_installation_completed_at.sql`) | `migrations/` |
| Table naming | `snake_case`, `created_at`/`updated_at` use `TEXT DEFAULT (datetime('now'))` | `migrations/0001_*.sql` |
| Frontend | Vanilla JS + Tailwind v4 + Font Awesome — no React, no chart library | `public/static/admin.js` |
| Admin nav | Inline tabs array inside `admin.js` (lines 74-88) — add entry `{ id:'instagram', label:'Instagram', icon:'fa-instagram' }` | `public/static/admin.js` |
| Cron | Cloudflare cron via `wrangler-cron.jsonc` firing `src/cron-worker.ts` every 10 min | `src/cron-worker.ts` |
| Secrets | `(c.env as any).INSTAGRAM_*` loaded in route handlers, NOT in services | pattern in `src/routes/google-ads.ts` |
| Large blobs | Cloudflare R2 — uncomment the `r2_buckets` block in `wrangler.jsonc` and add an `INSTAGRAM_R2` binding | `wrangler.jsonc:22-33` |
| Error handling | Fail-fast; services return `null` on error; routes return `{ success:false, error }` with appropriate status | `src/services/gemini-enhance.ts` |

**Do not:** introduce React, Prisma, a chart library, a new auth system, or a repository layer. The project does not use those.

**Before touching `meta-connect.ts`:** read `src/routes/meta-connect.ts` first. If an OAuth flow for Meta already exists there, extend it — do not duplicate it. Report back what you find before writing the OAuth handlers.

---

## 2. Prerequisites the User Must Provide (Block if Missing)

These are external. Before running any code, confirm the user has:

1. An **Instagram Business or Creator account** linked to a Facebook Page Roof Manager owns.
2. A **Meta Developer App** (business type) with these products enabled:
   - Instagram Graph API
   - Instagram Messaging (for DM webhooks)
   - Facebook Login for Business
3. **App Review approval** for these scopes: `instagram_basic`, `instagram_manage_insights`, `instagram_manage_messages`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`.
4. A **long-lived Page Access Token** generated and stored (it does not expire as long as it is used; rotate every ~60 days defensively).
5. A **dynamic-number pool** with a call-tracking provider (Twilio, CallRail, or similar) — we default to Twilio since the project already handles LiveKit/Deepgram credentials.
6. A **stock-media license** (Pexels API is free and sufficient; Storyblocks/Artlist for higher polish). Default to Pexels.
7. A **TTS voice** — ElevenLabs (cheap, good) or Google Cloud TTS (already have GCP auth via `gcp-auth.ts`). Default to GCP TTS to avoid a new vendor.

If any are missing, STOP and surface a concrete checklist to the user. Do not stub the API keys with placeholders that will silently 401 in production.

---

## 3. Secrets to Add

Append to deployment via `wrangler secret put`:

```
INSTAGRAM_APP_ID
INSTAGRAM_APP_SECRET
INSTAGRAM_PAGE_ACCESS_TOKEN          # long-lived
INSTAGRAM_BUSINESS_ACCOUNT_ID        # the IG user id (numeric)
INSTAGRAM_WEBHOOK_VERIFY_TOKEN       # random string, used at webhook handshake
INSTAGRAM_GRAPH_API_VERSION          # default 'v21.0'
PEXELS_API_KEY
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_TRACKING_NUMBER_POOL          # comma-separated E.164 numbers
ELEVENLABS_API_KEY                   # optional, only if overriding GCP TTS
```

Reuse existing `GEMINI_API_KEY` and `GCP_SERVICE_ACCOUNT_JSON`. Do not duplicate them.

---

## 4. Database Schema — `migrations/0146_instagram_module.sql`

Single-brand scope (no `company_id` on most tables; one row in `instagram_account`). Write this migration exactly:

```sql
-- Our single brand account (one row enforced at app layer)
CREATE TABLE instagram_account (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ig_user_id TEXT UNIQUE NOT NULL,
  username TEXT NOT NULL,
  page_id TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  token_refreshed_at TEXT,
  follower_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  media_count INTEGER DEFAULT 0,
  last_synced_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- All posts we've ever published or synced
CREATE TABLE instagram_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ig_media_id TEXT UNIQUE NOT NULL,
  media_type TEXT NOT NULL,  -- IMAGE, VIDEO, CAROUSEL_ALBUM, REEL, STORY
  caption TEXT,
  permalink TEXT,
  media_url TEXT,
  thumbnail_url TEXT,
  r2_thumbnail_key TEXT,
  posted_at TEXT NOT NULL,
  like_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  save_count INTEGER DEFAULT 0,
  share_count INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  video_views INTEGER DEFAULT 0,
  engagement_rate REAL DEFAULT 0.0,
  content_idea_id INTEGER,  -- FK to instagram_content_ideas (null for synced/legacy posts)
  utm_content_slug TEXT,    -- for lead attribution
  tracking_phone_number TEXT,
  boost_spend_cents INTEGER DEFAULT 0,
  organic_leads INTEGER DEFAULT 0,
  paid_leads INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_ig_posts_posted_at ON instagram_posts(posted_at DESC);
CREATE INDEX idx_ig_posts_utm_slug ON instagram_posts(utm_content_slug);

-- Daily snapshots for trend charts
CREATE TABLE instagram_analytics_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date TEXT NOT NULL,
  followers INTEGER,
  follows INTEGER,
  impressions INTEGER,
  reach INTEGER,
  profile_views INTEGER,
  website_clicks INTEGER,
  email_clicks INTEGER,
  phone_clicks INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(snapshot_date)
);

-- Competitor accounts we track (public-data only via Graph API Business Discovery)
CREATE TABLE instagram_competitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  follower_count INTEGER DEFAULT 0,
  media_count INTEGER DEFAULT 0,
  notes TEXT,
  is_active INTEGER DEFAULT 1,
  last_pulled_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE instagram_competitor_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competitor_id INTEGER NOT NULL,
  ig_media_id TEXT NOT NULL,
  media_type TEXT,
  caption TEXT,
  permalink TEXT,
  thumbnail_url TEXT,
  like_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  posted_at TEXT,
  hashtags_json TEXT,  -- JSON array
  hooks_json TEXT,     -- JSON array, extracted by Gemini
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(competitor_id, ig_media_id),
  FOREIGN KEY (competitor_id) REFERENCES instagram_competitors(id) ON DELETE CASCADE
);
CREATE INDEX idx_ig_comp_posts_posted_at ON instagram_competitor_posts(posted_at DESC);

-- Research artefacts (hashtag scores, trending sounds, content gaps)
CREATE TABLE instagram_research (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,  -- 'hashtag', 'hook', 'sound', 'topic', 'content_gap'
  value TEXT NOT NULL,
  score REAL DEFAULT 0.0,
  sample_post_ids_json TEXT,
  rationale TEXT,
  window_days INTEGER DEFAULT 30,
  generated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_ig_research_kind_score ON instagram_research(kind, score DESC);

-- Ideation board — AI-generated concepts before they become drafts
CREATE TABLE instagram_content_ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  angle TEXT,                   -- the hook / narrative angle
  target_persona TEXT,          -- 'homeowner-insurance-claim', 'new-roof-buyer', etc.
  pillar TEXT,                  -- 'education', 'social-proof', 'storm-alert', 'offer'
  predicted_engagement REAL,    -- model score 0-1
  predicted_cpl_cents INTEGER,  -- model estimate
  research_ref_json TEXT,       -- links back to instagram_research rows
  status TEXT NOT NULL DEFAULT 'idea',  -- idea | approved | in_production | scheduled | published | archived
  approved_by INTEGER,          -- admin_users.id
  approved_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_ig_ideas_status ON instagram_content_ideas(status);

-- Production drafts — AI generates script, captions, voiceover, visuals
CREATE TABLE instagram_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id INTEGER NOT NULL,
  media_type TEXT NOT NULL,     -- IMAGE, CAROUSEL, REEL, STORY
  script_json TEXT,             -- structured scenes: [{ shot, voiceover, onscreen_text, duration_s }]
  caption_primary TEXT,
  caption_alt_a TEXT,
  caption_alt_b TEXT,
  hashtags_json TEXT,
  voiceover_r2_key TEXT,
  visuals_r2_keys_json TEXT,    -- JSON array of R2 keys
  composite_r2_key TEXT,        -- final rendered mp4/jpg
  render_status TEXT DEFAULT 'pending',  -- pending | rendering | ready | failed
  render_error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (idea_id) REFERENCES instagram_content_ideas(id) ON DELETE CASCADE
);

-- Publishing schedule
CREATE TABLE instagram_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',  -- queued | publishing | published | failed | canceled
  published_media_id TEXT,
  publish_error TEXT,
  utm_content_slug TEXT NOT NULL,
  tracking_phone_number TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (draft_id) REFERENCES instagram_drafts(id) ON DELETE CASCADE
);
CREATE INDEX idx_ig_schedule_status_time ON instagram_schedule(status, scheduled_at);

-- Boost spend tracking (both organic + paid)
CREATE TABLE instagram_boosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  platform TEXT DEFAULT 'meta_ads',  -- meta_ads, manual_boost
  daily_budget_cents INTEGER NOT NULL,
  lifetime_budget_cents INTEGER,
  spent_cents INTEGER DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  leads_attributed INTEGER DEFAULT 0,
  cpl_cents INTEGER,
  status TEXT DEFAULT 'active',  -- active | paused | ended
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (post_id) REFERENCES instagram_posts(id) ON DELETE CASCADE
);

-- Lead attribution (the cross-channel truth)
CREATE TABLE instagram_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_channel TEXT NOT NULL,  -- utm | dm | phone
  post_id INTEGER,               -- FK instagram_posts, may be null for bio-link
  utm_content_slug TEXT,
  dm_thread_id TEXT,
  dm_keyword TEXT,
  tracking_phone_number TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  message_or_query TEXT,
  qualified INTEGER DEFAULT 0,   -- 0=raw, 1=qualified, -1=spam
  converted_to_order_id INTEGER, -- FK orders.id when they book
  converted_at TEXT,
  cost_cents INTEGER DEFAULT 0,  -- proportional boost spend
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (post_id) REFERENCES instagram_posts(id) ON DELETE SET NULL
);
CREATE INDEX idx_ig_leads_created ON instagram_leads(created_at DESC);
CREATE INDEX idx_ig_leads_post ON instagram_leads(post_id);

-- DM auto-reply keyword routing
CREATE TABLE instagram_dm_keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT UNIQUE NOT NULL,           -- e.g., 'ROOF', 'QUOTE', 'STORM'
  reply_template TEXT NOT NULL,
  landing_url TEXT NOT NULL,              -- must include utm_source=instagram
  is_active INTEGER DEFAULT 1,
  hit_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Tracking phone number pool state
CREATE TABLE instagram_tracking_numbers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_number TEXT UNIQUE NOT NULL,
  provider TEXT DEFAULT 'twilio',
  assigned_post_id INTEGER,
  assigned_at TEXT,
  released_at TEXT,
  total_calls INTEGER DEFAULT 0,
  FOREIGN KEY (assigned_post_id) REFERENCES instagram_posts(id) ON DELETE SET NULL
);
```

Apply locally with `npm run db:migrate:local` before touching routes. Confirm with `npm run db:console:local`.

---

## 5. Backend — Files to Create

Create these files. Put HTTP parsing in the routes, business logic in the services, and nothing else anywhere else.

### Routes
- `src/routes/instagram.ts` — mounts under `/api/admin/instagram`, uses `validateAdminSession` + `requireSuperadmin`. All endpoints listed in Section 6.
- `src/routes/instagram-webhooks.ts` — mounts under `/webhooks/instagram` (no auth middleware, but validates `X-Hub-Signature-256` HMAC against `INSTAGRAM_APP_SECRET`). Handles `GET` for the Meta subscription handshake and `POST` for comment/DM events.

### Services
- `src/services/instagram/graph-client.ts` — thin typed wrapper around Graph API v21 with retry + 429 backoff. One function per endpoint we call. Loads `INSTAGRAM_GRAPH_API_VERSION` and the access token as parameters, never from env directly.
- `src/services/instagram/ig-pull.ts` — **Skill 1: IG Pull.** Syncs account, recent posts, and insights. Writes to `instagram_account`, `instagram_posts`, `instagram_analytics_daily`.
- `src/services/instagram/competitor-pull.ts` — **Skill 2: Competitor Analysis.** Uses `/ig_hashtag_search` + Business Discovery to pull competitor public posts. Writes to `instagram_competitor_posts`. Uses Gemini to extract hooks + hashtags per post.
- `src/services/instagram/research-engine.ts` — Scores hashtags, identifies content gaps vs. competitors, ranks hooks. Writes to `instagram_research`.
- `src/services/instagram/ideation-engine.ts` — Gemini prompt that consumes latest `instagram_research` + our last 30 `instagram_posts` performance and outputs 10 ranked `instagram_content_ideas`. Predicts engagement and CPL.
- `src/services/instagram/production-engine.ts` — **Skill 3: Film Today.** Turns an approved idea into a fully-rendered draft: Gemini writes script → GCP TTS renders voiceover → Pexels fetches stock clips → FFmpeg (Cloud Run endpoint, reuse `cloud-run-ai.ts` pattern) composites. Writes to `instagram_drafts`. Stores all media in R2.
- `src/services/instagram/publishing-engine.ts` — Publishes scheduled drafts via `/{ig-user-id}/media` + `/{ig-user-id}/media_publish`. Assigns UTM slug + tracking phone before publish. Updates `instagram_schedule` and writes the new `instagram_posts` row.
- `src/services/instagram/boost-engine.ts` — **Skill 4: Boost Content.** Given a post id and a budget cap, creates or adjusts a Meta Ads boosted-post campaign targeting Roof Manager's ICP (geo + homeowner interests). Reallocates budget daily from underperformers to top performers. Writes to `instagram_boosts`.
- `src/services/instagram/lead-attribution.ts` — Joins `instagram_leads` across UTM, DM, and phone channels; computes blended CPL per post; writes back to `instagram_posts.organic_leads`, `paid_leads`.
- `src/services/instagram/dm-automation.ts` — Webhook handler helper: match keyword, send reply via Graph API `/me/messages`, record lead.
- `src/services/instagram/phone-tracking.ts` — Assigns/releases Twilio numbers from pool; receives Twilio webhook on inbound call; attributes call to post.

### Cron integration
Extend `src/cron-worker.ts` with:
- **Every 10 min**: `publishDueSchedule(env)` — pick up any `instagram_schedule` rows with `scheduled_at <= now()` and `status = 'queued'`, publish them.
- **Every hour**: `pullInstagramInsights(env)` — refresh recent post insights.
- **Every 6 hours**: `pullCompetitors(env)` — refresh competitor posts.
- **Daily 03:00 UTC**: `rollupDailyAnalytics(env)`, `runResearchEngine(env)`, `reallocateBoostBudgets(env)`.
- **Daily 09:00 local (13:00 UTC for America/Toronto)**: `runIdeationEngine(env)` — generates tomorrow's idea batch while you sleep.

Use the existing `scheduled(event, env, ctx)` handler; branch on `event.cron` string to fire the right job.

---

## 6. HTTP API Surface (under `/api/admin/instagram`)

All require `validateAdminSession` + `requireSuperadmin`. All return `{ success, data?, error? }`.

**Account & OAuth**
- `GET /status` — returns account row + token health + last sync times.
- `POST /oauth/start` — returns Meta OAuth URL (scopes in Section 2).
- `GET /oauth/callback` — exchanges code, stores encrypted token, provisions webhook subscription.
- `POST /oauth/refresh` — manual re-auth.

**Phase 1: Data (Skill: IG Pull)**
- `POST /pull/account` — run `ig-pull` now.
- `POST /pull/posts?since=ISO` — backfill posts.
- `GET /posts?limit=&offset=&sort=` — list posts with metrics.
- `GET /posts/:id` — single post detail with lead breakdown.
- `GET /analytics/daily?from=&to=` — daily snapshots for charts.
- `GET /analytics/summary?window=7d|30d|90d` — KPI cards.

**Phase 2: Research (Skill: Competitor Analysis)**
- `GET /competitors` / `POST /competitors` / `DELETE /competitors/:id`
- `POST /competitors/:id/pull` — run `competitor-pull` for one account.
- `POST /competitors/pull-all` — run for all active competitors.
- `GET /research/hashtags?window=30d` — ranked hashtags.
- `GET /research/hooks?window=30d` — ranked hooks from competitor captions.
- `GET /research/gaps` — topics competitors cover that we do not.
- `POST /research/run` — regenerate research artefacts now.

**Phase 3 & 4: Production + Ideation (Skill: Film Today)**
- `POST /ideas/generate?n=10` — run `ideation-engine`.
- `GET /ideas?status=` — list.
- `POST /ideas/:id/approve` — sets status `approved`, stamps `approved_by`.
- `POST /ideas/:id/reject` — archives.
- `POST /ideas/:id/produce` — triggers `production-engine` (async; returns `draft_id`). This is the **Film Today** one-click.
- `GET /drafts/:id` — fetch draft with R2 signed URLs.
- `POST /drafts/:id/regenerate?part=script|voiceover|visuals|caption` — partial re-render.
- `PUT /drafts/:id` — edit caption, script, or swap visuals.

**Phase 5: Publishing (Skill: Boost Content)**
- `POST /schedule` — `{ draft_id, scheduled_at }`; allocates UTM slug + tracking phone.
- `GET /schedule?status=` — calendar view data.
- `POST /schedule/:id/cancel`
- `POST /schedule/:id/publish-now`
- `POST /boosts` — `{ post_id, daily_budget_cents, duration_days }` → creates Meta Ads boost.
- `PATCH /boosts/:id` — adjust budget / pause / resume.
- `POST /boosts/reallocate` — run the daily reallocation now.
- `GET /boosts?post_id=` — list.

**Leads & Attribution**
- `GET /leads?source=&from=&to=&post_id=` — filtered list.
- `PATCH /leads/:id` — mark qualified/spam, link to order.
- `GET /leads/summary` — CPL by post, by channel, by pillar.
- `GET /dm-keywords` / `POST /dm-keywords` / `PATCH /dm-keywords/:id`
- `GET /tracking-numbers` / `POST /tracking-numbers/provision` — pool management.

**Webhooks (mounted at `/webhooks/instagram`, not under admin)**
- `GET /webhooks/instagram` — Meta verification handshake.
- `POST /webhooks/instagram` — receives messages/comments events; HMAC-validate before processing.
- `POST /webhooks/twilio/voice` — inbound call attribution.

---

## 7. Frontend — Edits to `public/static/admin.js`

1. Add to the tabs array (around line 74-88):
   ```js
   { id:'instagram', label:'Instagram', icon:'fa-instagram' }
   ```
2. Add the tab handler (around line 102):
   ```js
   ${A.tab === 'instagram' ? renderInstagram() : ''}
   ```
3. Add a `renderInstagram()` function that renders a **secondary tab strip** for the four dashboards and defers to sub-renderers. Match the existing `mc(label, value, icon, color)` KPI-card helper. Tailwind v4 + Font Awesome only — no new libraries.

### Dashboard 1 — Performance (Phase 1: Data)
- KPI row: Followers (delta vs. 7d), Impressions 7d, Engagement Rate 30d, Organic Leads 30d, Blended CPL 30d.
- Line chart: follower growth + engagement rate overlay (render with inline SVG — no chart lib; 300-400 lines of SVG path code is fine).
- Post table: top 20 by engagement in window, sortable columns (posted_at, media_type, reach, engagement, leads, CPL), thumbnail from R2, click-through to post detail drawer.
- Actions: "Pull Now" (`POST /pull/account`), "Export CSV".

### Dashboard 2 — Research (Phase 2: Research)
- Competitor roster with add/remove, last pull timestamp, post count.
- Ranked hashtag cloud (top 50 by score with trend arrow).
- "Hooks that win" list — Gemini-extracted competitor hooks with performance signals.
- Content gap panel — topics competitors hit that we do not, clickable to "Send to Ideation".
- Action: "Run Research Now" → `POST /research/run`.

### Dashboard 3 — Studio (Phases 3 + 4: Production & Ideation)
- Two columns: **Ideas** (status=`idea`,`approved`) and **Drafts** (status across `in_production`,`scheduled`).
- Idea card: title, angle, pillar, predicted engagement bar, predicted CPL, "Approve" / "Film Today" / "Archive".
- Draft card: thumbnail preview, render status, caption preview, "Regenerate Voiceover" / "Regenerate Visuals" / "Schedule".
- Header action: "Generate Ideas" → `POST /ideas/generate?n=10`.
- "Film Today" is a single button on any `approved` idea; it fires `POST /ideas/:id/produce` and streams status until the draft composite lands in R2.

### Dashboard 4 — Leads & Boost (Phase 5: Publishing + Monetization)
- Calendar grid (next 14 days) showing scheduled posts; drag-to-reschedule is out of scope — use a modal editor.
- Leads table: most recent 100 leads across UTM/DM/phone with qualification toggle, link-to-order button.
- Boost panel: active campaigns with spend, CPL, action buttons (pause/boost-more/reallocate).
- **Unit-economics card** (the whole point of the module): Organic CPL, Paid CPL, Blended CPL, ROI vs. average roofing job margin. Pull job-margin from existing `orders` + `invoices`.
- DM keyword manager (inline table CRUD).
- Tracking number pool status.

Keep every dashboard keyboard-navigable. Do not introduce a modal library — use existing modal patterns from `admin.js`.

---

## 8. The Five Phases — Data Flow Contract

This is the contract the engine enforces. If a row in one phase lacks the upstream reference, it cannot advance.

1. **Data.** `ig-pull` + `competitor-pull` populate `instagram_posts`, `instagram_analytics_daily`, `instagram_competitor_posts`. Nothing else writes there.
2. **Research.** `research-engine` reads only phase-1 tables and writes `instagram_research`. Deterministic; re-runnable.
3. **Production.** `production-engine` runs only when `instagram_content_ideas.status = 'approved'`; it writes `instagram_drafts` and moves idea to `in_production`. Final composite lives in R2 under `instagram/drafts/{draft_id}/composite.{ext}`.
4. **Ideation.** `ideation-engine` reads phase-1 + phase-2 tables and writes `instagram_content_ideas` with `status='idea'`. The engine never approves — a human (superadmin) approves through the UI.
5. **Publishing.** `publishing-engine` runs against `instagram_schedule.status='queued'`. It assigns UTM slug (`ig_{YYYYMMDD}_{idea_id}`) and grabs a free tracking number from the pool. After publish, it creates the `instagram_posts` row and closes the schedule entry. Boost (if any) is created post-publish by `boost-engine`.

Execution order note: your prompt listed the phases as Data, Research, Production, Ideation, Publishing. The runtime order of *generation* is Data → Research → Ideation → Production → Publishing (you cannot produce a draft before an idea exists). The UI tabs and the phase labels follow your stated order; the engine follows the dependency order. Do not re-label; the two orders live peacefully because they describe different things.

---

## 9. The Four Skills — Definitions

Each skill is a callable command (API endpoint + one-click UI button). Treat them as first-class.

1. **IG Pull.** Endpoint: `POST /pull/account` (+ `/pull/posts`). UI: "Pull Now" button on Dashboard 1. Refreshes account, last 50 posts, per-post insights, daily snapshot. Idempotent.
2. **Competitor Analysis.** Endpoint: `POST /competitors/pull-all` + `POST /research/run`. UI: "Run Research Now" on Dashboard 2. Pulls all active competitors, regenerates hashtag/hook/gap scores.
3. **Film Today.** Endpoint: `POST /ideas/:id/produce`. UI: "Film Today" on any approved idea in Dashboard 3. One-click pipeline: script → voiceover (GCP TTS) → visuals (Pexels stock) → composite (Cloud Run FFmpeg) → R2. Typical wall-clock: ~90-180 seconds. Return `draft_id` immediately and stream status via polling `GET /drafts/:id`.
4. **Boost Content.** Endpoint: `POST /boosts` + `POST /boosts/reallocate`. UI: "Boost" button on a published post in Dashboard 4 with a budget slider. Creates a Meta Ads boosted-post campaign and registers it in `instagram_boosts`. Daily cron reallocates spend: if a campaign's CPL > 2× the median, it pauses; saved budget rolls to campaigns with CPL < median.

Each skill must log structured events to existing admin audit logging (find the existing logger in the codebase; do not invent a new one).

---

## 10. Cost & Lead-Economics Math (the "cheapest leads" part)

Hard-code these so the product is honest about cost:

- `cost_cents` per lead = proportional share of `instagram_boosts.spent_cents` for the lead's post, split evenly across leads for that post in the same day. Organic leads have `cost_cents = 0` but carry an allocation of production cost (see below).
- `production_cost_cents_per_draft` — sum of: Gemini calls (count tokens × price), GCP TTS chars × price, Pexels is free, Cloud Run render seconds × price. Compute at produce time; write to a new column on `instagram_drafts` (add to the migration).
- `blended_cpl_cents` = `(sum(boost spend) + sum(production cost for posts in window)) / sum(qualified leads in window)`.
- Boost reallocation rule (already stated in Section 9): pause any boost whose 24h rolling CPL > 2× median-of-active-boosts-CPL; redirect saved daily budget to the boost with the lowest CPL.
- Kill switch: if blended CPL > configured ceiling (default CA$60), pause *all* boosts and surface a banner on Dashboard 4.

Add to the migration (append to the schema above):
```sql
ALTER TABLE instagram_drafts ADD COLUMN production_cost_cents INTEGER DEFAULT 0;
ALTER TABLE instagram_posts  ADD COLUMN cpl_blended_cents INTEGER;
```

Expose a super-admin setting for the CPL ceiling; reuse whatever settings table the app already has (grep for `settings` in `migrations/`). Do not create a new `settings` table if one exists.

---

## 11. Lead Attribution — All Three Channels

1. **UTM.** Every publish stamps `utm_content_slug = ig_{YYYYMMDD}_{idea_id}`. Extend `src/routes/lead-capture.ts` (do not rewrite it) so any inbound submission with `utm_source=instagram` also inserts a row into `instagram_leads` with the matching `post_id`. Use the slug — not the permalink — as the join key.
2. **DM.** Webhook receives a message; `dm-automation` matches the keyword (case-insensitive, first token); sends the reply template via Graph API; creates an `instagram_leads` row with `source_channel='dm'`, `dm_thread_id`, and the post the keyword is associated with (store this on `instagram_dm_keywords` or resolve via CTA link).
3. **Phone.** `phone-tracking` maintains a Twilio pool. When publishing a post, pull a number, set it as the CTA number in the caption/overlay, and store it on `instagram_posts.tracking_phone_number` + `instagram_schedule.tracking_phone_number`. Twilio inbound-call webhook creates `instagram_leads` row with `source_channel='phone'`.

Deduplicate across channels on `(contact_phone, created_at-within-24h)`; keep the earliest row as canonical and store the others as related via a `related_lead_id` column if cleaner (add to migration if needed, but only if you actually implement dedup).

---

## 12. Security, Privacy, Ops

- Encrypt `instagram_account.access_token_encrypted` with AES-GCM using `JWT_SECRET` as the KEK (or add a new `INSTAGRAM_TOKEN_ENC_KEY`). Do not store the raw token.
- Validate `X-Hub-Signature-256` on every webhook POST. Reject mismatches with 401.
- Rate-limit `/api/admin/instagram/pull/*` to 1 call per 60s per admin.
- All Graph API calls go through `graph-client.ts`'s 429 backoff (exponential with jitter, max 5 retries).
- PII: captions, DMs, and caller numbers land in D1. Document retention policy inline in `instagram-leads` DDL (keep 13 months, then redact phone/email, keep row for analytics).
- Add feature flag `instagram_module_enabled` (default false) to whatever flag system exists; otherwise gate on a superadmin-only boolean in the module's `/status` endpoint.

---

## 13. Tests

Add vitest suites (match existing `src/utils/geo-math.test.ts` style):
- `src/services/instagram/graph-client.test.ts` — mock fetch; assert retry on 429, URL formation, version pinning.
- `src/services/instagram/research-engine.test.ts` — deterministic scoring on seeded competitor posts.
- `src/services/instagram/lead-attribution.test.ts` — UTM join, dedup across channels, CPL math, kill-switch trigger.
- `src/services/instagram/boost-engine.test.ts` — reallocation rule against a fixture of five boosts with varying CPLs.

Run with `npx vitest run src/services/instagram/`. Do not ship until green.

---

## 14. Execution Order (do these in this order)

1. Read `src/routes/meta-connect.ts` end-to-end. Report back whether it already implements the Instagram OAuth flow. If yes, extend; if no, proceed.
2. Confirm all secrets in Section 3 are set in `wrangler.jsonc` dev vars and wrangler secrets.
3. Write and apply `migrations/0146_instagram_module.sql`. Run `npm run db:reset && npm run db:migrate:local && npm run db:seed`. Inspect via `npm run db:console:local`.
4. Uncomment R2 in `wrangler.jsonc`, add `INSTAGRAM_R2` binding, create bucket `roofmanager-instagram-media` (cite the bucket name in the migration PR description so ops can create it in prod).
5. Scaffold `graph-client.ts`; ship IG Pull + the Dashboard-1 UI first. This must work end-to-end before any other dashboard is attempted.
6. Ship Competitor Analysis + Dashboard-2.
7. Ship Ideation + Production + Dashboard-3 (this is the largest surface; budget the most time here).
8. Ship Publishing + Boost + Lead Attribution + Dashboard-4.
9. Wire cron handlers in `cron-worker.ts`; verify with a manual dry-run route (`POST /api/admin/instagram/_cron/:job` guarded by superadmin).
10. Write tests as you go, not at the end.
11. Update `README.md` (if it covers module docs) with a one-paragraph description + links to the four endpoints that matter: pull, ideate, produce, publish.

---

## 15. Definition of Done

The module is not done until all of these are true:

- [ ] Migration `0146_instagram_module.sql` applies cleanly on a fresh `db:reset`.
- [ ] OAuth round-trip completes and `instagram_account` has one row with an encrypted token.
- [ ] `POST /api/admin/instagram/pull/account` syncs ≥ 50 posts and writes one `instagram_analytics_daily` row.
- [ ] Three active competitors synced; `instagram_research` has ≥ 20 hashtag rows and ≥ 10 hook rows with non-zero scores.
- [ ] `POST /ideas/generate?n=10` returns 10 ideas with predicted CPL > 0 and predicted engagement in (0, 1).
- [ ] "Film Today" on one approved idea produces a real mp4 in R2 in under 4 minutes, and its `instagram_drafts` row has non-null `composite_r2_key` and `production_cost_cents > 0`.
- [ ] Scheduling a draft 2 minutes into the future results in a live IG post and a new `instagram_posts` row with a stamped `utm_content_slug`.
- [ ] Submitting a lead-capture form with that UTM creates an `instagram_leads` row joined to the post.
- [ ] A Twilio inbound call to the assigned tracking number creates an `instagram_leads` row with `source_channel='phone'`.
- [ ] Sending a DM with the keyword `ROOF` gets the auto-reply and creates an `instagram_leads` row with `source_channel='dm'`.
- [ ] Creating a boost with a $10/day cap results in an `instagram_boosts` row; the reallocation cron pauses it if CPL is 2× the median.
- [ ] Kill-switch fires when blended CPL exceeds the configured ceiling; Dashboard 4 shows the banner.
- [ ] All four dashboards render on mobile (Tailwind responsive) and under 500ms on local.
- [ ] Vitest suites pass: `npx vitest run src/services/instagram/`.
- [ ] `npm run build` succeeds; `npm run deploy` (staging) succeeds; a smoke-test script hits `/status` and returns `success: true`.

---

## 16. Explicit Non-Goals (do not build these now)

- TikTok, YouTube Shorts, LinkedIn, Twitter/X cross-posting.
- Per-customer multi-tenancy (see Section 2 — single brand only).
- In-browser video editing. Edits are re-renders only.
- Influencer outreach and UGC licensing.
- A separate mobile app.
- A generic "social CRM" — the lead table here is Instagram-scoped by design. Leads converted to orders flow into the existing `orders` pipeline; this module does not duplicate CRM features.

---

## 17. Report Back

Before writing code, read Sections 1, 2, and 14, then respond with:
1. Confirmation that `meta-connect.ts` does or does not already implement IG OAuth (and what parts you'll reuse).
2. A list of any secrets from Section 3 that are not yet set.
3. A sanity check on the five-phase data-flow contract in Section 8.
4. Any convention deltas you spot between this prompt and the current codebase that should block the build.

Then execute Section 14 in order.
