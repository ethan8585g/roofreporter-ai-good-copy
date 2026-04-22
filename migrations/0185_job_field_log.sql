-- Job Field Log: unified module for crew to upload notes + photos to jobs,
-- and for owners to track install progress. One report per crew-member per
-- job-per-day; photos and attendees linked 1:many.

CREATE TABLE IF NOT EXISTS job_field_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  report_date TEXT NOT NULL,
  submitter_type TEXT NOT NULL DEFAULT 'crew', -- 'crew' | 'admin'
  submitter_id INTEGER NOT NULL,               -- customers.id when crew, admin_users.id when admin
  submitter_name TEXT,
  crew_start_time TEXT,                        -- HH:MM
  crew_end_time TEXT,                          -- HH:MM
  work_completed TEXT,
  issues_notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_job_field_logs_job ON job_field_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_job_field_logs_date ON job_field_logs(report_date);
CREATE INDEX IF NOT EXISTS idx_job_field_logs_submitter ON job_field_logs(submitter_type, submitter_id);

CREATE TABLE IF NOT EXISTS job_field_log_attendees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id INTEGER NOT NULL,
  crew_member_id INTEGER NOT NULL,
  crew_member_name TEXT,
  start_time TEXT,
  end_time TEXT,
  FOREIGN KEY (log_id) REFERENCES job_field_logs(id) ON DELETE CASCADE,
  FOREIGN KEY (crew_member_id) REFERENCES customers(id)
);
CREATE INDEX IF NOT EXISTS idx_job_field_log_attendees_log ON job_field_log_attendees(log_id);

CREATE TABLE IF NOT EXISTS job_field_log_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id INTEGER NOT NULL,
  photo_data TEXT NOT NULL,    -- base64 data URL
  caption TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (log_id) REFERENCES job_field_logs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_job_field_log_photos_log ON job_field_log_photos(log_id);

-- Per-crew-member access tokens so any crew can submit without a full login.
-- Owner generates a token in the admin UI and shares the magic link with the crew.
CREATE TABLE IF NOT EXISTS job_field_log_crew_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crew_member_id INTEGER NOT NULL,
  owner_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now')),
  revoked_at TEXT,
  FOREIGN KEY (crew_member_id) REFERENCES customers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_job_field_log_crew_tokens_token ON job_field_log_crew_tokens(token);
CREATE INDEX IF NOT EXISTS idx_job_field_log_crew_tokens_owner ON job_field_log_crew_tokens(owner_id);
