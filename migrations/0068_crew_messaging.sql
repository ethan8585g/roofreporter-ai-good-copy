-- Crew messaging table for job-level crew communication
CREATE TABLE IF NOT EXISTS crew_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  author_id INTEGER NOT NULL,
  author_name TEXT DEFAULT '',
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_crew_messages_job ON crew_messages(job_id);
CREATE INDEX IF NOT EXISTS idx_crew_messages_job_date ON crew_messages(job_id, created_at);

-- Add GPS columns to crew_time_logs for check-in location tracking
ALTER TABLE crew_time_logs ADD COLUMN clock_in_lat REAL;
ALTER TABLE crew_time_logs ADD COLUMN clock_in_lng REAL;
