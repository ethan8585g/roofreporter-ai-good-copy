-- Instant Estimator Widget: embeddable widget for contractor websites
-- Captures leads with instant roof pricing from Google Solar API

-- Widget configuration per contractor
CREATE TABLE IF NOT EXISTS widget_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  public_key TEXT NOT NULL UNIQUE,
  is_active INTEGER DEFAULT 1,
  allowed_domains TEXT DEFAULT '',

  -- Branding (falls back to customers.brand_* if null)
  headline TEXT DEFAULT 'Get Your Instant Roof Estimate',
  subheadline TEXT DEFAULT 'Enter your address to see pricing in under 60 seconds',
  button_color TEXT,
  button_text TEXT DEFAULT 'Get My Estimate',
  logo_url TEXT,

  -- Estimation config
  show_tiers INTEGER DEFAULT 1,
  require_phone INTEGER DEFAULT 1,
  require_email INTEGER DEFAULT 1,

  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_widget_configs_public_key ON widget_configs(public_key);
CREATE INDEX idx_widget_configs_customer_id ON widget_configs(customer_id);

-- Leads captured through the widget
CREATE TABLE IF NOT EXISTS widget_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  widget_config_id INTEGER NOT NULL REFERENCES widget_configs(id),
  customer_id INTEGER NOT NULL,

  -- Contact info
  lead_name TEXT DEFAULT '',
  lead_email TEXT DEFAULT '',
  lead_phone TEXT DEFAULT '',

  -- Property
  property_address TEXT NOT NULL,
  lat REAL,
  lng REAL,

  -- Estimate results
  measurements_json TEXT,
  estimate_json TEXT,
  total_area_sqft REAL,
  estimated_price_low REAL,
  estimated_price_mid REAL,
  estimated_price_high REAL,

  -- Tracking
  status TEXT DEFAULT 'new',
  source_domain TEXT DEFAULT '',
  ip_address TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',

  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_widget_leads_customer_id ON widget_leads(customer_id);
CREATE INDEX idx_widget_leads_status ON widget_leads(status);
CREATE INDEX idx_widget_leads_created ON widget_leads(created_at);
