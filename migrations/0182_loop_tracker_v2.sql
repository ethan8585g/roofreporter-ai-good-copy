-- Migration 0182 — Loop Tracker v2
-- Expands the Loop Tracker into a unified registry for every recurring "loop"
-- in the system: Cloudflare cron scans, Claude /loop slash commands, and
-- Anthropic-hosted /schedule cloud routines. Adds deep forensic capture
-- (per-run metrics, skew, source) and a lightweight heartbeats table for
-- timeseries / "last seen" computations.

-- ── Enrich existing loop_scan_runs with forensic columns ────────────────────
-- All columns are nullable so the migration is non-breaking; existing rows
-- simply leave them NULL. New code populates them on every run.

ALTER TABLE loop_scan_runs ADD COLUMN loop_id TEXT;
ALTER TABLE loop_scan_runs ADD COLUMN source TEXT DEFAULT 'cf_cron';
ALTER TABLE loop_scan_runs ADD COLUMN metrics_json TEXT;
ALTER TABLE loop_scan_runs ADD COLUMN expected_at TEXT;
ALTER TABLE loop_scan_runs ADD COLUMN skew_ms INTEGER;
ALTER TABLE loop_scan_runs ADD COLUMN cf_ray TEXT;
ALTER TABLE loop_scan_runs ADD COLUMN cf_colo TEXT;
ALTER TABLE loop_scan_runs ADD COLUMN inputs_json TEXT;
ALTER TABLE loop_scan_runs ADD COLUMN outputs_json TEXT;
ALTER TABLE loop_scan_runs ADD COLUMN error_stack TEXT;

CREATE INDEX IF NOT EXISTS idx_loop_scan_runs_loop_id ON loop_scan_runs(loop_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_loop_scan_runs_source ON loop_scan_runs(source, started_at DESC);

-- Backfill loop_id for legacy rows so they show up in the new UI grouped by
-- the same key as new runs. Pattern: scan rows use 'scan_<scan_type>'.
UPDATE loop_scan_runs SET loop_id = 'scan_' || scan_type WHERE loop_id IS NULL;
UPDATE loop_scan_runs SET source = 'cf_cron' WHERE source IS NULL AND triggered_by = 'cron';
UPDATE loop_scan_runs SET source = 'manual' WHERE source IS NULL AND triggered_by = 'manual';
UPDATE loop_scan_runs SET source = 'inline' WHERE source IS NULL AND triggered_by = 'inline';

-- ── loop_definitions: source of truth for every registered loop ─────────────
-- One row per loop. Declares its expected schedule + ownership metadata so
-- the dashboard can show "expected to run every 30 min, last seen 2h ago,
-- STALE". Also drives the "missed runs" detection.

CREATE TABLE IF NOT EXISTS loop_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loop_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,                  -- 'site_scan' | 'health' | 'monitor' | 'cloud_routine' | 'cron'
  source TEXT NOT NULL,                    -- 'cf_cron' | 'claude_loop' | 'cloud_routine'
  schedule_cron TEXT,                      -- cron expression (informational)
  schedule_human TEXT,                     -- e.g. 'Every 30 min'
  expected_period_seconds INTEGER,         -- how long between runs is "normal"
  enabled INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  runbook_url TEXT,
  owner TEXT,                              -- 'super_admin' | 'cron_worker' | 'claude_code'
  endpoint TEXT,                           -- API path the loop hits (informational)
  last_run_at TEXT,
  last_status TEXT,
  last_run_id INTEGER,                     -- FK-by-convention to loop_scan_runs.id
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  total_runs INTEGER NOT NULL DEFAULT 0,
  total_failures INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_loop_definitions_category ON loop_definitions(category, enabled);
CREATE INDEX IF NOT EXISTS idx_loop_definitions_last_run ON loop_definitions(last_run_at DESC);

-- ── loop_heartbeats: lightweight per-execution log for timeseries ──────────
-- Every loop tick (whether it does work or not) writes one row here. Cheap,
-- one row per execution, no payload. Powers the 24h heatmap and stale
-- detection without scanning the heavier loop_scan_runs table.

CREATE TABLE IF NOT EXISTS loop_heartbeats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loop_id TEXT NOT NULL,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL,                    -- 'pass' | 'fail' | 'error' | 'skipped'
  duration_ms INTEGER,
  run_id INTEGER,                          -- FK-by-convention to loop_scan_runs.id (nullable)
  summary TEXT,
  source TEXT                              -- 'cf_cron' | 'claude_loop' | 'cloud_routine' | 'manual'
);

CREATE INDEX IF NOT EXISTS idx_loop_heartbeats_loop_ts ON loop_heartbeats(loop_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_loop_heartbeats_ts ON loop_heartbeats(ts DESC);
CREATE INDEX IF NOT EXISTS idx_loop_heartbeats_status ON loop_heartbeats(status, ts DESC);

-- ── Seed the catalog with every known loop ─────────────────────────────────
-- The dashboard reads from this table; if a loop fires that is NOT in this
-- table, the heartbeat handler auto-inserts a stub row. So this seed is
-- documentation + ownership, not a hard gate.

INSERT OR IGNORE INTO loop_definitions
  (loop_id, name, category, source, schedule_cron, schedule_human, expected_period_seconds, owner, endpoint, description) VALUES
  -- ── Cloudflare cron scans (driven by src/cron-worker.ts) ──
  ('scan_public',   'Public site scan',          'site_scan', 'cf_cron', '0,30 * * * *',  'Every 30 min',          1800, 'cron_worker', 'runScan(public)',
   'Crawls landing/pricing/contact/login/signup/blog for broken links + form smoke + console errors.'),
  ('scan_customer', 'Customer portal scan',      'site_scan', 'cf_cron', '10,40 * * * *', 'Every 30 min',          1800, 'cron_worker', 'runScan(customer)',
   'Logged-in customer surfaces. Requires SCAN_CUSTOMER_EMAIL secret.'),
  ('scan_admin',    'Super Admin scan',          'site_scan', 'cf_cron', '20,50 * * * *', 'Every 30 min',          1800, 'cron_worker', 'runScan(admin)',
   'Logged-in super-admin surfaces. Requires SCAN_ADMIN_EMAIL secret.'),
  ('scan_reports',  'Recent reports sweep',      'site_scan', 'cf_cron', '5,15,35 * * * *','Every ~20 min',          1200, 'cron_worker', 'runScan(reports)',
   'Sweeps recent roof-measurement reports for broken diagrams, dup structures, missing HTML, stuck jobs.'),
  ('scan_health',   'Daily system health check', 'health',    'cf_cron', '0 9 * * *',     'Daily at 09:00 UTC',   86400, 'cron_worker', 'runScan(health)',
   'D1 latency, secrets present, volume sanity, orphan reports.'),
  -- ── Existing Worker-driven agents (already log to agent_runs) ──
  ('tracing',       'Order processing tracing',  'cron',      'cf_cron', '*/10 * * * *',  'Every 10 min',           600, 'cron_worker', 'processOrderQueue',
   'Drains the AI order queue. Heart of report generation.'),
  ('content',       'Blog agent (Gemini)',       'cron',      'cf_cron', '0 8,14,20 * * *','3x daily 08/14/20 UTC',28800, 'cron_worker', 'runBlogAgent',
   'Auto-publishes a blog post from the keyword queue.'),
  ('lead',          'Lead agent',                'cron',      'cf_cron', '*/10 * * * *',  'Every 10 min',           600, 'cron_worker', 'runLeadAgent',
   'Auto-responds to inbound leads.'),
  ('email',         'Email agent',               'cron',      'cf_cron', '0 10 * * 2',    'Tuesdays 10:00 UTC',  604800, 'cron_worker', 'runEmailAgent',
   'Weekly campaign send.'),
  ('monitor',       'Site monitor agent',        'monitor',   'cf_cron', '0 */1 * * *',   'Every hour',            3600, 'cron_worker', 'runMonitorAgent',
   'Anthropic-driven site monitor scoring health 0-100.'),
  ('traffic',       'Traffic analyst agent',     'monitor',   'cf_cron', '0 * * * *',     'Every hour (fallback)', 3600, 'cron_worker', 'runTrafficAgent',
   'UX bounce/exit analysis, low-traffic safety net.'),
  ('attribution',   'Attribution rollup',        'cron',      'cf_cron', '0 3 * * *',     'Daily 03:00 UTC',     86400, 'cron_worker', 'runNightlyAttributionRollup',
   'Rebuilds analytics_attribution + analytics_content_daily.'),
  -- ── Claude /loop slash commands (driven from your laptop) ──
  ('funnel_monitor','Signup-funnel regression', 'monitor',   'claude_loop', NULL,         'Every 1h (/loop 1h)',  3600, 'claude_code', 'POST /agents/funnel-monitor/tick',
   '24h vs 7×24h baseline conversion check + 1h backend tripwire.'),
  ('gmail_health',  'Gmail OAuth2 transport',   'health',    'claude_loop', NULL,         'Every 6h (/loop 6h)', 21600, 'claude_code', 'POST /agents/email-health/tick',
   'Mints an access token from the production refresh token. Alerts if it fails.'),
  ('reports_monitor','Reports error sweep',     'site_scan', 'claude_loop', NULL,         'Every 1h (/loop 1h)',  3600, 'claude_code', 'POST /agents/reports-monitor/tick',
   'Triggers the same reports sweep the cron does, returns categorized findings to the slash command.');
