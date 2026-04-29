-- Professional-tier measurement suite
-- 1. Per-section confidence breakdown stored alongside the global score.
-- 2. Snapshot prior report state on update so the diff banner can show changes.
-- 3. Field-survey feedback queue (auto-flagged when discrepancy >20%).
-- 4. NWS-derived weather risk metadata captured on report generation.

ALTER TABLE reports ADD COLUMN confidence_breakdown TEXT;        -- JSON: { pitch, area, edges }
ALTER TABLE reports ADD COLUMN current_version_num INTEGER DEFAULT 1;
ALTER TABLE reports ADD COLUMN weather_risk TEXT;                -- JSON: { hail_score, wind_score, last_event_at, sample_radius_km }

CREATE TABLE IF NOT EXISTS report_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  version_num INTEGER NOT NULL,
  data TEXT NOT NULL,                                             -- JSON snapshot of measurement payload
  diff_summary TEXT,                                              -- nullable JSON: { area_delta_ft2, edges_added, edges_removed, ... }
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_report_versions_report ON report_versions(report_id, version_num);

CREATE TABLE IF NOT EXISTS report_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  user_id INTEGER,
  type TEXT NOT NULL,                                             -- 'measured_differently' | 'edge_wrong' | 'pitch_wrong' | 'other'
  description TEXT,
  survey_data TEXT,                                               -- JSON: { measured_area_ft2, measured_pitch, photos: [], ... }
  discrepancy_pct REAL,
  needs_admin_review INTEGER DEFAULT 0,                           -- 1 when discrepancy_pct > 20
  status TEXT DEFAULT 'open',                                     -- 'open' | 'reviewed' | 'resolved'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_report_feedback_report ON report_feedback(report_id);
CREATE INDEX IF NOT EXISTS idx_report_feedback_admin_queue ON report_feedback(needs_admin_review, status) WHERE needs_admin_review = 1;
