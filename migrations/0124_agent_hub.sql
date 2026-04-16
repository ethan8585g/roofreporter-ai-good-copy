-- ============================================================
-- Migration 0124: Agent Hub — Autonomous Agent Platform
-- Tables: agent_configs, agent_runs, lead_responses
-- ============================================================

-- Per-agent persistent config. One row per agent_type, seeded on create.
CREATE TABLE IF NOT EXISTS agent_configs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_type     TEXT    NOT NULL UNIQUE,  -- 'tracing' | 'content' | 'email' | 'lead'
  enabled        INTEGER NOT NULL DEFAULT 0,
  config_json    TEXT,                     -- agent-specific settings as JSON
  last_run_at    TEXT,
  last_run_status TEXT,                    -- 'success' | 'error' | 'skipped' | 'partial'
  last_run_details TEXT,
  next_run_at    TEXT,
  run_count      INTEGER DEFAULT 0,
  error_count    INTEGER DEFAULT 0,
  created_at     TEXT    DEFAULT (datetime('now')),
  updated_at     TEXT    DEFAULT (datetime('now'))
);

-- Seed default rows (disabled). ON CONFLICT = do nothing if already exists.
INSERT OR IGNORE INTO agent_configs (agent_type, enabled, config_json) VALUES
  ('tracing', 0, '{"confidence_threshold":60,"max_daily_auto":50,"notify_on_complete":true}'),
  ('content',  0, '{"quality_threshold":72,"max_attempts":2,"auto_publish":true}'),
  ('email',    0, '{"max_contacts_per_run":200,"min_days_between_campaigns":7}'),
  ('lead',     0, '{"max_leads_per_run":10,"respond_within_hours":2}');

-- Unified activity log across all agents.
CREATE TABLE IF NOT EXISTS agent_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_type   TEXT    NOT NULL,
  status       TEXT    NOT NULL,  -- 'success' | 'error' | 'skipped' | 'partial'
  summary      TEXT,              -- human-readable one-liner shown in activity feed
  details_json TEXT,              -- full result payload as JSON
  duration_ms  INTEGER,
  created_at   TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_type    ON agent_runs(agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_runs_created ON agent_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status  ON agent_runs(status);

-- Prevents the lead agent from emailing the same address twice.
CREATE TABLE IF NOT EXISTS lead_responses (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_email       TEXT    NOT NULL UNIQUE,
  lead_source      TEXT,
  responded_at     TEXT    DEFAULT (datetime('now')),
  response_subject TEXT,
  success          INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_lead_responses_email ON lead_responses(lead_email);
