-- ============================================================
-- Migration 0033: Meta Connect — Facebook/Instagram Integration
-- Super Admin only — mass group posting, Meta Ads, scheduling
-- ============================================================

-- Store Facebook OAuth tokens (long-lived page/user tokens)
CREATE TABLE IF NOT EXISTS meta_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fb_user_id TEXT NOT NULL,
  fb_user_name TEXT DEFAULT '',
  access_token TEXT NOT NULL,           -- Long-lived user access token
  token_type TEXT DEFAULT 'user',       -- user, page
  token_expires_at TEXT,
  scopes TEXT DEFAULT '',               -- Comma-separated granted scopes
  profile_picture_url TEXT DEFAULT '',
  status TEXT DEFAULT 'active',         -- active, expired, revoked
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Cached Facebook groups the user manages or is a member of
CREATE TABLE IF NOT EXISTS meta_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meta_account_id INTEGER NOT NULL,
  fb_group_id TEXT NOT NULL,
  group_name TEXT NOT NULL,
  member_count INTEGER DEFAULT 0,
  privacy TEXT DEFAULT 'CLOSED',        -- OPEN, CLOSED, SECRET
  is_admin INTEGER DEFAULT 0,
  last_synced_at TEXT,
  enabled INTEGER DEFAULT 1,            -- 1=include in mass posts
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (meta_account_id) REFERENCES meta_accounts(id)
);

-- Cached Facebook pages the user manages
CREATE TABLE IF NOT EXISTS meta_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meta_account_id INTEGER NOT NULL,
  fb_page_id TEXT NOT NULL,
  page_name TEXT NOT NULL,
  page_access_token TEXT DEFAULT '',     -- Page-specific access token
  category TEXT DEFAULT '',
  followers_count INTEGER DEFAULT 0,
  is_published INTEGER DEFAULT 1,
  last_synced_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (meta_account_id) REFERENCES meta_accounts(id)
);

-- Mass group post campaigns
CREATE TABLE IF NOT EXISTS meta_post_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  message_template TEXT NOT NULL,        -- Post text (supports {variables})
  image_url TEXT DEFAULT '',             -- Optional image attachment
  link_url TEXT DEFAULT '',              -- Optional link attachment
  target_groups TEXT DEFAULT '[]',       -- JSON array of group IDs to post to
  status TEXT DEFAULT 'draft',           -- draft, scheduled, running, paused, completed, failed
  schedule_at TEXT,                      -- When to start posting
  post_interval_seconds INTEGER DEFAULT 60,  -- Delay between posts (avoid rate limits)
  total_groups INTEGER DEFAULT 0,
  posted_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  current_index INTEGER DEFAULT 0,       -- Track progress for chunked execution
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Individual post results per group
CREATE TABLE IF NOT EXISTS meta_post_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  fb_group_id TEXT NOT NULL,
  group_name TEXT DEFAULT '',
  fb_post_id TEXT DEFAULT '',            -- Returned post ID from Graph API
  status TEXT DEFAULT 'pending',         -- pending, posted, failed, skipped
  error_message TEXT DEFAULT '',
  posted_at TEXT,
  engagement_likes INTEGER DEFAULT 0,
  engagement_comments INTEGER DEFAULT 0,
  engagement_shares INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (campaign_id) REFERENCES meta_post_campaigns(id)
);

-- Meta Ad campaigns managed from the platform
CREATE TABLE IF NOT EXISTS meta_ad_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meta_account_id INTEGER NOT NULL,
  fb_campaign_id TEXT DEFAULT '',        -- Meta Ads campaign ID
  fb_ad_account_id TEXT DEFAULT '',      -- Ad account ID
  name TEXT NOT NULL,
  objective TEXT DEFAULT 'OUTCOME_LEADS', -- OUTCOME_AWARENESS, OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT, OUTCOME_LEADS, OUTCOME_SALES
  status TEXT DEFAULT 'draft',           -- draft, active, paused, archived
  daily_budget_cents INTEGER DEFAULT 0,
  lifetime_budget_cents INTEGER DEFAULT 0,
  currency TEXT DEFAULT 'CAD',
  target_audience TEXT DEFAULT '{}',     -- JSON targeting spec
  ad_creative TEXT DEFAULT '{}',         -- JSON creative spec
  start_date TEXT,
  end_date TEXT,
  -- Performance metrics (synced from Meta)
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  spend_cents INTEGER DEFAULT 0,
  leads INTEGER DEFAULT 0,
  cpl_cents INTEGER DEFAULT 0,           -- Cost per lead
  ctr REAL DEFAULT 0,
  last_synced_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (meta_account_id) REFERENCES meta_accounts(id)
);

-- Scheduled/recurring posts
CREATE TABLE IF NOT EXISTS meta_scheduled_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meta_account_id INTEGER NOT NULL,
  target_type TEXT DEFAULT 'group',      -- group, page, profile
  target_id TEXT NOT NULL,               -- FB group/page ID
  target_name TEXT DEFAULT '',
  message TEXT NOT NULL,
  image_url TEXT DEFAULT '',
  link_url TEXT DEFAULT '',
  schedule_at TEXT NOT NULL,
  recurrence TEXT DEFAULT 'once',        -- once, daily, weekly, monthly
  status TEXT DEFAULT 'scheduled',       -- scheduled, posted, failed, cancelled
  fb_post_id TEXT DEFAULT '',
  error_message TEXT DEFAULT '',
  posted_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_meta_accounts_status ON meta_accounts(status);
CREATE INDEX IF NOT EXISTS idx_meta_groups_account ON meta_groups(meta_account_id);
CREATE INDEX IF NOT EXISTS idx_meta_pages_account ON meta_pages(meta_account_id);
CREATE INDEX IF NOT EXISTS idx_meta_post_campaigns_status ON meta_post_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_meta_post_logs_campaign ON meta_post_logs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_meta_ad_campaigns_account ON meta_ad_campaigns(meta_account_id);
CREATE INDEX IF NOT EXISTS idx_meta_scheduled_status ON meta_scheduled_posts(status);
CREATE INDEX IF NOT EXISTS idx_meta_scheduled_time ON meta_scheduled_posts(schedule_at);
