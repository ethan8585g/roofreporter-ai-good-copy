-- ============================================================
-- 0187: Auto-send proposal email + auto-sync jobs to Google Calendar
-- ============================================================
-- The customers table is at SQLite's column limit, so toggles
-- live in their own table keyed by owner_id.
-- Both default ON (1) so the feature works as soon as Gmail is
-- connected. Read pattern: COALESCE(setting, 1).
-- ============================================================

CREATE TABLE IF NOT EXISTS user_automation_settings (
  owner_id INTEGER PRIMARY KEY,
  auto_send_proposal INTEGER DEFAULT 1,
  auto_sync_calendar INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
