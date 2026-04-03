-- Crew Manager Enhancements: time tracking + availability
CREATE TABLE IF NOT EXISTS crew_time_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  crew_member_id INTEGER NOT NULL,
  clock_in TEXT NOT NULL,
  clock_out TEXT,
  duration_minutes INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (crew_member_id) REFERENCES customers(id)
);
CREATE INDEX IF NOT EXISTS idx_crew_time_job ON crew_time_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_crew_time_member ON crew_time_logs(crew_member_id);
