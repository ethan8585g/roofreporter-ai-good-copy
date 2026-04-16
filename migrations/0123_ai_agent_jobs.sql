-- ============================================================
-- AI Agent Jobs Table — Tracks all autonomous agent actions
-- Phase 1: Auto roof tracing
-- Phase 2: Queue management, retry logic, daily digests
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  action TEXT NOT NULL,                    -- auto_traced, flagged_for_review, report_generated, failed, skipped
  success INTEGER NOT NULL DEFAULT 0,      -- 0 = false, 1 = true
  confidence INTEGER,                      -- Gemini quality score 0-100
  processing_ms INTEGER,                   -- Total processing time in milliseconds
  error TEXT,                              -- Error message if failed
  details TEXT,                            -- Human-readable summary of what happened
  agent_version TEXT DEFAULT '1.0.0',      -- Agent version for tracking improvements
  attempts INTEGER DEFAULT 1,             -- Number of attempts for this order
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- Indexes for efficient queue queries
CREATE INDEX IF NOT EXISTS idx_agent_jobs_order_id ON agent_jobs(order_id);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_action ON agent_jobs(action);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_created_at ON agent_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_success ON agent_jobs(success);

-- Agent configuration is stored per-company via the settings table (setting_key/setting_value)
