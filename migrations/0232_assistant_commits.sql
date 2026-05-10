-- ============================================================
-- Migration 0232: Audit log for AI Assistant code commits
-- Every commit the in-app /super-admin/ai-assistant pushes to
-- GitHub gets a row here so we can see what the agent did, when,
-- and which prompt triggered it.
-- ============================================================

CREATE TABLE IF NOT EXISTS assistant_commits (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sha           TEXT    NOT NULL,
  branch        TEXT    NOT NULL DEFAULT 'main',
  file_paths    TEXT,                  -- JSON array of paths touched
  message       TEXT,                  -- commit message
  user_prompt   TEXT,                  -- the operator prompt that triggered this
  model         TEXT,                  -- claude-sonnet-4-6 | claude-opus-4-7
  reverted      INTEGER NOT NULL DEFAULT 0,
  reverted_by_sha TEXT,                -- if reverted, the revert commit's SHA
  created_at    TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assistant_commits_created_at ON assistant_commits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistant_commits_sha ON assistant_commits(sha);
