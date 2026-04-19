-- Agent deployment tracking for LiveKit Cloud deploys triggered from Super Admin
CREATE TABLE IF NOT EXISTS agent_deployments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requested_by_user_id INTEGER,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, running, succeeded, failed
  commit_sha TEXT,
  agent_id TEXT,                           -- from livekit.toml (CA_...)
  livekit_project TEXT,                    -- subdomain from livekit.toml
  logs TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_deploy_status ON agent_deployments(status);
CREATE INDEX IF NOT EXISTS idx_agent_deploy_requested ON agent_deployments(requested_at);
