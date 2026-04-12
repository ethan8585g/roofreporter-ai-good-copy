-- Lead capture for Free Asset Report + Condo cheat sheet + Demo portal
CREATE TABLE IF NOT EXISTS asset_report_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  address TEXT,
  building_count INTEGER,
  name TEXT,
  company TEXT,
  source TEXT NOT NULL DEFAULT 'homepage_cta',
  tag TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_asset_leads_email ON asset_report_leads(email);
CREATE INDEX IF NOT EXISTS idx_asset_leads_source ON asset_report_leads(source);
CREATE INDEX IF NOT EXISTS idx_asset_leads_tag ON asset_report_leads(tag);
