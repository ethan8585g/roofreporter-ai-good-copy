-- ============================================================
-- Site Analytics — Every click, pageview, and session tracked
-- ============================================================

-- Core analytics events table — one row per tracked event
CREATE TABLE IF NOT EXISTS site_analytics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Event type
  event_type TEXT NOT NULL DEFAULT 'pageview',  -- pageview, click, scroll, form_submit, session_start, session_end
  
  -- Session & visitor identification
  session_id TEXT,           -- Random UUID per browser session
  visitor_id TEXT,           -- Persistent fingerprint (localStorage UUID) 
  user_id INTEGER,           -- FK to users table if logged in (NULL for anonymous)
  
  -- Page context
  page_url TEXT NOT NULL,    -- Full path e.g. /pricing, /order/new
  page_title TEXT,           -- Document title
  referrer TEXT,             -- document.referrer or Referer header
  
  -- Click-specific data (event_type = 'click')
  click_element TEXT,        -- Tag name + class + id of clicked element
  click_text TEXT,           -- innerText of clicked element (truncated)
  click_x INTEGER,           -- Page X coordinate
  click_y INTEGER,           -- Page Y coordinate
  
  -- UTM / Campaign tracking
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  
  -- Visitor identity (from Cloudflare + UA)
  ip_address TEXT,           -- CF-Connecting-IP 
  country TEXT,              -- cf.country (ISO code)
  city TEXT,                 -- cf.city
  region TEXT,               -- cf.region
  timezone TEXT,             -- cf.timezone
  asn TEXT,                  -- cf.asn (ISP identifier)
  
  -- Device & browser (from client-side JS)
  user_agent TEXT,
  browser TEXT,              -- Parsed: Chrome, Firefox, Safari, Edge, etc.
  browser_version TEXT,
  os TEXT,                   -- Parsed: Windows, macOS, iOS, Android, Linux
  device_type TEXT,          -- desktop, mobile, tablet
  screen_width INTEGER,
  screen_height INTEGER,
  language TEXT,             -- navigator.language
  
  -- Engagement metrics
  scroll_depth INTEGER,      -- Max scroll percentage (0-100)
  time_on_page INTEGER,      -- Seconds spent on page (updated on leave)
  
  -- Metadata
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast admin queries
CREATE INDEX IF NOT EXISTS idx_analytics_created ON site_analytics(created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_event ON site_analytics(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_session ON site_analytics(session_id);
CREATE INDEX IF NOT EXISTS idx_analytics_visitor ON site_analytics(visitor_id);
CREATE INDEX IF NOT EXISTS idx_analytics_page ON site_analytics(page_url, created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_country ON site_analytics(country, created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_user ON site_analytics(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_ip ON site_analytics(ip_address);

-- Daily aggregation table for fast dashboard queries
CREATE TABLE IF NOT EXISTS analytics_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,            -- YYYY-MM-DD
  page_url TEXT NOT NULL,
  pageviews INTEGER DEFAULT 0,
  unique_visitors INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  avg_time_on_page REAL DEFAULT 0,
  avg_scroll_depth REAL DEFAULT 0,
  bounce_count INTEGER DEFAULT 0, -- Sessions with only 1 pageview
  UNIQUE(date, page_url)
);

CREATE INDEX IF NOT EXISTS idx_daily_date ON analytics_daily(date);
