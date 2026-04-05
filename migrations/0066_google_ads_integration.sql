-- Google Ads + Google Business Profile Integration

-- Google Ads connection fields on customers table
ALTER TABLE customers ADD COLUMN google_ads_refresh_token TEXT;
ALTER TABLE customers ADD COLUMN google_ads_customer_id TEXT;
ALTER TABLE customers ADD COLUMN google_ads_connected_at TEXT;

-- Google Business Profile connection fields
ALTER TABLE customers ADD COLUMN gbp_refresh_token TEXT;
ALTER TABLE customers ADD COLUMN gbp_account_id TEXT;
ALTER TABLE customers ADD COLUMN gbp_location_id TEXT;
ALTER TABLE customers ADD COLUMN gbp_connected_at TEXT;

-- Cached Google Ads campaign data
CREATE TABLE IF NOT EXISTS google_ads_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  google_campaign_id TEXT,
  name TEXT,
  status TEXT DEFAULT 'enabled',
  campaign_type TEXT,
  daily_budget_cents INTEGER,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  spend_cents INTEGER DEFAULT 0,
  ctr REAL DEFAULT 0,
  cost_per_conversion_cents INTEGER DEFAULT 0,
  last_synced_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
CREATE INDEX IF NOT EXISTS idx_gads_campaigns_customer ON google_ads_campaigns(customer_id);

-- Cached Google Business Profile reviews
CREATE TABLE IF NOT EXISTS gbp_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  google_review_id TEXT UNIQUE,
  reviewer_name TEXT,
  reviewer_photo_url TEXT,
  rating INTEGER,
  comment TEXT,
  reply TEXT,
  review_time TEXT,
  reply_time TEXT,
  last_synced_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
CREATE INDEX IF NOT EXISTS idx_gbp_reviews_customer ON gbp_reviews(customer_id);

-- Google Business Profile posts
CREATE TABLE IF NOT EXISTS gbp_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  google_post_id TEXT,
  content TEXT,
  call_to_action TEXT,
  cta_url TEXT,
  photo_url TEXT,
  status TEXT DEFAULT 'published',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
