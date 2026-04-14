-- Team Activity Log — per-action audit trail for team members
-- Owner-only dashboard reads this to show who did what

CREATE TABLE IF NOT EXISTS team_activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  actor_customer_id INTEGER,
  actor_team_member_id INTEGER,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  action TEXT NOT NULL,
  metadata TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_team_activity_owner ON team_activity_events (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_team_activity_member ON team_activity_events (actor_team_member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_team_activity_entity ON team_activity_events (entity_type, entity_id);
