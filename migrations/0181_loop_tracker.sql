-- Loop Tracker — recurring health/scan runs surfaced in Super Admin.
-- One row per scan run; child rows hold individual findings.

CREATE TABLE IF NOT EXISTS loop_scan_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_type TEXT NOT NULL,                 -- 'public' | 'customer' | 'admin' | 'health'
  status TEXT NOT NULL,                    -- 'running' | 'pass' | 'fail' | 'error'
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  duration_ms INTEGER,
  pages_checked INTEGER NOT NULL DEFAULT 0,
  ok_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  triggered_by TEXT NOT NULL DEFAULT 'cron'  -- 'cron' | 'manual'
);

CREATE INDEX IF NOT EXISTS idx_loop_scan_runs_type_started
  ON loop_scan_runs(scan_type, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_loop_scan_runs_status
  ON loop_scan_runs(status, started_at DESC);

CREATE TABLE IF NOT EXISTS loop_scan_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES loop_scan_runs(id) ON DELETE CASCADE,
  severity TEXT NOT NULL,                  -- 'error' | 'warn'
  category TEXT NOT NULL,                  -- 'broken_link' | 'form_smoke' | 'console_error' | 'api_health' | 'health_check'
  url TEXT,
  message TEXT NOT NULL,
  details_json TEXT,
  resolved_at TEXT,
  resolved_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_loop_scan_findings_run
  ON loop_scan_findings(run_id);

CREATE INDEX IF NOT EXISTS idx_loop_scan_findings_unresolved
  ON loop_scan_findings(resolved_at) WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_loop_scan_findings_category
  ON loop_scan_findings(category, created_at DESC);
