-- Platform Monitor Agent + Agent Memory System
-- Enables the monitor agent to scan for bugs/errors/improvements
-- and enables ALL agents to accumulate and reuse knowledge across runs.

-- ── platform_insights ─────────────────────────────────────────
-- Persistent record of findings from the platform monitor agent.
CREATE TABLE IF NOT EXISTS platform_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,    -- 'bug' | 'error' | 'improvement' | 'health' | 'performance'
  severity TEXT NOT NULL,    -- 'critical' | 'high' | 'medium' | 'low'
  title TEXT NOT NULL,
  description TEXT,
  suggested_fix TEXT,
  status TEXT DEFAULT 'open',  -- 'open' | 'acknowledged' | 'resolved'
  source_run_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_insights_status   ON platform_insights(status);
CREATE INDEX IF NOT EXISTS idx_insights_severity ON platform_insights(severity);
CREATE INDEX IF NOT EXISTS idx_insights_created  ON platform_insights(created_at DESC);

-- ── agent_memory ──────────────────────────────────────────────
-- Persistent key-value knowledge store for all agents.
-- Agents read their memory before each run and write back what they learned.
-- This is what makes agents continuously improve — they carry forward observations
-- about what works (content quality patterns, lead sources that convert, etc.)
CREATE TABLE IF NOT EXISTS agent_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_type TEXT NOT NULL,   -- 'tracing' | 'content' | 'email' | 'lead' | 'monitor'
  memory_key TEXT NOT NULL,   -- e.g., 'platform_summary', 'content_learnings', 'lead_patterns'
  memory_value TEXT NOT NULL, -- accumulated knowledge text (max ~4000 chars)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(agent_type, memory_key)
);
CREATE INDEX IF NOT EXISTS idx_agent_memory_type ON agent_memory(agent_type);

-- Register monitor agent in agent_configs
INSERT OR IGNORE INTO agent_configs (agent_type, enabled) VALUES ('monitor', 0);
