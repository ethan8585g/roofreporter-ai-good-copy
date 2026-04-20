-- Meta Conversions API event log — tracks server-side events sent to Meta for deduplication
CREATE TABLE IF NOT EXISTS meta_conversion_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  pixel_id TEXT NOT NULL,
  user_email_hash TEXT,
  user_phone_hash TEXT,
  custom_data TEXT,
  source_page TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  meta_response TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_meta_conv_event_id ON meta_conversion_events(event_id);
CREATE INDEX IF NOT EXISTS idx_meta_conv_created ON meta_conversion_events(created_at DESC);
