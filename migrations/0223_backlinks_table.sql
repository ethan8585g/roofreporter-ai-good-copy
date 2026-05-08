-- 0223_backlinks_table.sql
-- Tracks placed backlinks (where Roof Manager appears on third-party sites)
-- so the SEO investment is auditable: which assets earned which links, anchor
-- text diversity, do-follow ratio, and rot detection (a placement removed
-- without notice is invisible without health checks).
--
-- Source-of-truth for outreach progress on the placements proposed in
-- docs/sales-seo/BACKLINK_OUTREACH_LIST.md and BACKLINK_STRATEGY_2026.md.

CREATE TABLE IF NOT EXISTS backlinks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_domain TEXT NOT NULL,                  -- e.g. roofingcontractor.com
  target_url TEXT NOT NULL,                     -- exact page hosting the link
  anchor_text TEXT,                             -- exact anchor used
  destination_url TEXT NOT NULL DEFAULT 'https://www.roofmanager.ca/',
                                                -- which RM URL the link points to
  asset_type TEXT,                              -- 'tool', 'blog_post', 'research', 'directory_profile', 'guest_post', 'partnership_case_study', 'other'
  asset_slug TEXT,                              -- e.g. 'pitch-calculator' or blog post slug
  dofollow INTEGER DEFAULT 1,                   -- 1=do-follow, 0=no-follow, NULL=unknown
  outreach_status TEXT DEFAULT 'pitched',       -- 'pitched', 'accepted', 'submitted', 'live', 'verified', 'removed', 'declined'
  placement_date TEXT,                          -- ISO date the link went live
  last_checked_at TEXT,                         -- ISO timestamp of most recent health check
  last_check_status TEXT,                       -- 'ok' (anchor still present), 'http_error', 'anchor_missing', 'redirect', 'removed'
  last_check_http_code INTEGER,                 -- HTTP status code from last check
  removed_at TEXT,                              -- when health check first detected removal
  notes TEXT,                                   -- freeform: contact, dates, context
  outreach_owner TEXT,                          -- person responsible for the placement
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_backlinks_status ON backlinks(outreach_status);
CREATE INDEX IF NOT EXISTS idx_backlinks_domain ON backlinks(target_domain);
CREATE INDEX IF NOT EXISTS idx_backlinks_asset ON backlinks(asset_type, asset_slug);
CREATE INDEX IF NOT EXISTS idx_backlinks_last_checked ON backlinks(last_checked_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_backlinks_target_url ON backlinks(target_url);
