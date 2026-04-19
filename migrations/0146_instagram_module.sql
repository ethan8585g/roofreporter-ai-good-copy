-- ============================================================
-- Migration 0146: Instagram Super-Admin Module
-- Single-brand Instagram operating system for Roof Manager
-- ============================================================

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
  media_type TEXT NOT NULL,
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
  content_idea_id INTEGER,
  utm_content_slug TEXT,
  tracking_phone_number TEXT,
  boost_spend_cents INTEGER DEFAULT 0,
  organic_leads INTEGER DEFAULT 0,
  paid_leads INTEGER DEFAULT 0,
  cpl_blended_cents INTEGER,
  production_cost_cents INTEGER DEFAULT 0,
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
  hashtags_json TEXT,
  hooks_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(competitor_id, ig_media_id),
  FOREIGN KEY (competitor_id) REFERENCES instagram_competitors(id) ON DELETE CASCADE
);
CREATE INDEX idx_ig_comp_posts_posted_at ON instagram_competitor_posts(posted_at DESC);

-- Research artefacts (hashtag scores, trending sounds, content gaps)
CREATE TABLE instagram_research (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
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
  angle TEXT,
  target_persona TEXT,
  pillar TEXT,
  predicted_engagement REAL,
  predicted_cpl_cents INTEGER,
  research_ref_json TEXT,
  status TEXT NOT NULL DEFAULT 'idea',
  approved_by INTEGER,
  approved_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_ig_ideas_status ON instagram_content_ideas(status);

-- Production drafts — AI generates script, captions, voiceover, visuals
CREATE TABLE instagram_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id INTEGER NOT NULL,
  media_type TEXT NOT NULL,
  script_json TEXT,
  caption_primary TEXT,
  caption_alt_a TEXT,
  caption_alt_b TEXT,
  hashtags_json TEXT,
  voiceover_r2_key TEXT,
  visuals_r2_keys_json TEXT,
  composite_r2_key TEXT,
  render_status TEXT DEFAULT 'pending',
  render_error TEXT,
  production_cost_cents INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (idea_id) REFERENCES instagram_content_ideas(id) ON DELETE CASCADE
);

-- Publishing schedule
CREATE TABLE instagram_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
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
  platform TEXT DEFAULT 'meta_ads',
  daily_budget_cents INTEGER NOT NULL,
  lifetime_budget_cents INTEGER,
  spent_cents INTEGER DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  leads_attributed INTEGER DEFAULT 0,
  cpl_cents INTEGER,
  status TEXT DEFAULT 'active',
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (post_id) REFERENCES instagram_posts(id) ON DELETE CASCADE
);

-- Lead attribution (the cross-channel truth)
CREATE TABLE instagram_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_channel TEXT NOT NULL,
  post_id INTEGER,
  utm_content_slug TEXT,
  dm_thread_id TEXT,
  dm_keyword TEXT,
  tracking_phone_number TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  message_or_query TEXT,
  qualified INTEGER DEFAULT 0,
  converted_to_order_id INTEGER,
  converted_at TEXT,
  cost_cents INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (post_id) REFERENCES instagram_posts(id) ON DELETE SET NULL
);
CREATE INDEX idx_ig_leads_created ON instagram_leads(created_at DESC);
CREATE INDEX idx_ig_leads_post ON instagram_leads(post_id);

-- DM auto-reply keyword routing
CREATE TABLE instagram_dm_keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT UNIQUE NOT NULL,
  reply_template TEXT NOT NULL,
  landing_url TEXT NOT NULL,
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
