-- Migration 0102: Field App — crew PIN login, GPS check-ins, offline sync log
-- Crew-facing mobile app tables. Photos reuse existing job_photos table.

CREATE TABLE IF NOT EXISTS field_crew_pins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crew_member_id INTEGER NOT NULL,
  owner_id INTEGER NOT NULL,
  pin_hash TEXT NOT NULL,
  last_login_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (crew_member_id) REFERENCES customers(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_field_pin_crew ON field_crew_pins(crew_member_id);

CREATE TABLE IF NOT EXISTS field_check_ins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  crew_member_id INTEGER NOT NULL,
  event_type TEXT NOT NULL, -- 'check_in' | 'check_out' | 'break_start' | 'break_end'
  lat REAL,
  lng REAL,
  accuracy_m REAL,
  client_event_id TEXT,       -- idempotency token from offline client
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_field_checkins_job ON field_check_ins(job_id);
CREATE INDEX IF NOT EXISTS idx_field_checkins_crew ON field_check_ins(crew_member_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_field_checkins_clientid ON field_check_ins(client_event_id) WHERE client_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS field_sessions (
  token TEXT PRIMARY KEY,
  crew_member_id INTEGER NOT NULL,
  owner_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_field_sessions_crew ON field_sessions(crew_member_id);
