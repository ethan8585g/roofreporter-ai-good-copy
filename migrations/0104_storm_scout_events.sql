-- Storm Scout analytics — thin event log for ROI attribution.
-- Client and server both write here. Keep schema minimal; aggregate on read.

CREATE TABLE IF NOT EXISTS storm_scout_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,           -- map_open | alert_view | match_click |
                                      -- before_after_open | territory_create |
                                      -- match_sent | lead_created_from_storm
  meta_json TEXT,                     -- small JSON blob, optional
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sse_customer_time ON storm_scout_events(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sse_type_time ON storm_scout_events(event_type, created_at DESC);

-- Optional: per-customer avg job value for $-attribution.
-- Lives on existing customers table if a column exists; otherwise a settings
-- row works. Keeping the analytics route tolerant of its absence.
