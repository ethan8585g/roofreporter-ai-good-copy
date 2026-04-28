-- ============================================================
-- 0189 — Analytics Attribution & Content Performance Rollup
-- Adds tables that join the existing site_analytics stream
-- against customers/orders/payments to answer:
--   • Which page brought a paying customer in?
--   • Which content drives the most revenue?
--   • What does a converting journey look like?
-- Purely additive — no changes to existing tables.
-- ============================================================

-- One row per converted customer.  Computed by the nightly rollup
-- (and on-demand when a customer signs up / logs in).
CREATE TABLE IF NOT EXISTS analytics_attribution (
  customer_id INTEGER PRIMARY KEY,

  -- First-touch — the very first pageview ever seen on this visitor_id
  first_touch_session_id TEXT,
  first_touch_visitor_id TEXT,
  first_touch_path TEXT,
  first_touch_path_template TEXT,
  first_touch_page_type TEXT,
  first_touch_referrer TEXT,
  first_touch_referrer_domain TEXT,
  first_touch_utm_source TEXT,
  first_touch_utm_medium TEXT,
  first_touch_utm_campaign TEXT,
  first_touch_at DATETIME,

  -- Last-touch — the pageview immediately before conversion
  last_touch_session_id TEXT,
  last_touch_path TEXT,
  last_touch_path_template TEXT,
  last_touch_page_type TEXT,
  last_touch_referrer_domain TEXT,
  last_touch_utm_source TEXT,
  last_touch_at DATETIME,

  -- Journey shape
  touch_count INTEGER DEFAULT 0,
  session_count INTEGER DEFAULT 0,
  journey_path_templates TEXT,        -- JSON array of distinct path_templates in order
  days_to_convert INTEGER,            -- floor((converted_at - first_touch_at) / 86400)

  -- Conversion outcome
  converted_at DATETIME,              -- customers.created_at
  first_paid_at DATETIME,             -- earliest payments.created_at for this customer
  total_orders INTEGER DEFAULT 0,
  total_paid_orders INTEGER DEFAULT 0,
  revenue_cents INTEGER DEFAULT 0,

  computed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_attr_first_template ON analytics_attribution(first_touch_path_template);
CREATE INDEX IF NOT EXISTS idx_attr_last_template  ON analytics_attribution(last_touch_path_template);
CREATE INDEX IF NOT EXISTS idx_attr_first_source   ON analytics_attribution(first_touch_utm_source);
CREATE INDEX IF NOT EXISTS idx_attr_converted_at   ON analytics_attribution(converted_at);
CREATE INDEX IF NOT EXISTS idx_attr_first_visitor  ON analytics_attribution(first_touch_visitor_id);

-- Denormalized daily rollup for fast dashboard rendering.
-- One row per (date, path_template).
CREATE TABLE IF NOT EXISTS analytics_content_daily (
  date TEXT NOT NULL,                 -- YYYY-MM-DD (UTC)
  path_template TEXT NOT NULL,
  page_type TEXT,
  content_slug TEXT,

  pageviews INTEGER DEFAULT 0,
  unique_visitors INTEGER DEFAULT 0,
  sessions_started INTEGER DEFAULT 0,
  bounces INTEGER DEFAULT 0,          -- sessions where this was the only pageview

  signups_first_touch INTEGER DEFAULT 0,
  signups_any_touch   INTEGER DEFAULT 0,
  orders_first_touch  INTEGER DEFAULT 0,
  orders_any_touch    INTEGER DEFAULT 0,
  revenue_first_touch_cents INTEGER DEFAULT 0,
  revenue_any_touch_cents   INTEGER DEFAULT 0,

  avg_time_on_page REAL DEFAULT 0,
  avg_scroll_depth REAL DEFAULT 0,

  computed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (date, path_template)
);

CREATE INDEX IF NOT EXISTS idx_content_daily_date ON analytics_content_daily(date);
CREATE INDEX IF NOT EXISTS idx_content_daily_type ON analytics_content_daily(page_type, date);
CREATE INDEX IF NOT EXISTS idx_content_daily_template ON analytics_content_daily(path_template);

-- ROLLBACK (manual):
--   DROP TABLE analytics_attribution;
--   DROP TABLE analytics_content_daily;
