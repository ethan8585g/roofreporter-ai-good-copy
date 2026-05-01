-- 0195: Raw per-path event log for the Activity Log dashboard.
-- 0194's user_module_visits aggregates by module (loses the exact path).
-- This table stores one row per navigation transition so superadmin can see
-- "every single thing a user uses" — each unique page they visited, in order.

CREATE TABLE IF NOT EXISTS user_path_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_type TEXT NOT NULL CHECK(user_type IN ('admin','customer')),
  user_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  module TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip_address TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_upe_user ON user_path_events(user_type, user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_upe_occurred ON user_path_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_upe_path ON user_path_events(path);
