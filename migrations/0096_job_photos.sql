-- Job progress photos — crew uploads tied to crm_jobs, base64 in D1 (matches report_images pattern)
CREATE TABLE IF NOT EXISTS job_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  crew_member_id INTEGER,
  author_name TEXT DEFAULT '',
  data_url TEXT NOT NULL,
  caption TEXT DEFAULT '',
  phase TEXT DEFAULT 'during',
  taken_at TEXT DEFAULT (datetime('now')),
  lat REAL,
  lng REAL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_job_photos_job ON job_photos(job_id);
CREATE INDEX IF NOT EXISTS idx_job_photos_phase ON job_photos(job_id, phase);
