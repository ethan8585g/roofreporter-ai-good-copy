-- ============================================================
-- Migration 0233: Persistent conversation history for /super-admin/ai-assistant
-- One row per saved chat. The browser auto-saves on every turn so a tab
-- close / refresh / reboot doesn't lose context. Operator can resume any
-- prior conversation from a sidebar.
-- ============================================================

CREATE TABLE IF NOT EXISTS assistant_conversations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id      INTEGER NOT NULL,
  title         TEXT,                        -- auto-generated from first user message
  messages_json TEXT NOT NULL,               -- full conversation as JSON array of {role, content}
  model         TEXT,                        -- 'sonnet' | 'opus' — last-used model
  turn_count    INTEGER NOT NULL DEFAULT 0,
  archived      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assistant_conversations_admin_updated
  ON assistant_conversations(admin_id, archived, updated_at DESC);
