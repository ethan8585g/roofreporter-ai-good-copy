-- Crew Manager: Assign crew to jobs + track progress with photos/notes
CREATE TABLE IF NOT EXISTS job_crew_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  crew_member_id INTEGER NOT NULL,
  role TEXT DEFAULT 'crew',
  assigned_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (crew_member_id) REFERENCES customers(id)
);
CREATE INDEX IF NOT EXISTS idx_job_crew_job ON job_crew_assignments(job_id);
CREATE INDEX IF NOT EXISTS idx_job_crew_member ON job_crew_assignments(crew_member_id);

CREATE TABLE IF NOT EXISTS job_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  author_id INTEGER NOT NULL,
  author_name TEXT,
  update_type TEXT DEFAULT 'note',
  content TEXT,
  photo_data TEXT,
  photo_caption TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_job_progress_job ON job_progress(job_id);
