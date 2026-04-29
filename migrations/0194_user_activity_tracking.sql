-- 0194: User activity tracking — module-level visit + daily rollup
-- Powers the super-admin "User Activity" dashboard that shows how much time
-- each admin/customer has spent in each product module.

-- Open visits: one row per (user, module) currently active.
-- Continuous activity within 5 min extends the visit (last_seen_at bumped).
-- A daily cron flushes stale rows into user_module_visits.
CREATE TABLE IF NOT EXISTS active_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_type TEXT NOT NULL CHECK(user_type IN ('admin','customer')),
  user_id INTEGER NOT NULL,
  module TEXT NOT NULL,
  started_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  ip_address TEXT,
  user_agent TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_visits_user_module
  ON active_visits(user_type, user_id, module);
CREATE INDEX IF NOT EXISTS idx_active_visits_last_seen ON active_visits(last_seen_at);

-- Closed visits — historical truth for "time spent" queries.
CREATE TABLE IF NOT EXISTS user_module_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_type TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  module TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_umv_user ON user_module_visits(user_type, user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_umv_module ON user_module_visits(module, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_umv_started ON user_module_visits(started_at);

-- Daily rollup — kept forever. user_module_visits is purged after 90 days.
CREATE TABLE IF NOT EXISTS user_activity_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  user_type TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  module TEXT NOT NULL,
  total_seconds INTEGER NOT NULL,
  visit_count INTEGER NOT NULL,
  request_count INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_uad_day_user_module
  ON user_activity_daily(day, user_type, user_id, module);
CREATE INDEX IF NOT EXISTS idx_uad_day ON user_activity_daily(day);
CREATE INDEX IF NOT EXISTS idx_uad_user ON user_activity_daily(user_type, user_id, day);
