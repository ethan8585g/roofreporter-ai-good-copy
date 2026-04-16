CREATE TABLE IF NOT EXISTS preview_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  preview_id TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL,
  lat REAL,
  lng REAL,
  footprint_m2 REAL,
  pitch_deg REAL,
  segment_count INTEGER,
  ip TEXT,
  user_agent TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  converted_customer_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_preview_preview_id ON preview_requests(preview_id);
CREATE INDEX IF NOT EXISTS idx_preview_created_at ON preview_requests(created_at DESC);
