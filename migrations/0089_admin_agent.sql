-- Autonomous super admin agent (LangGraph-backed)
CREATE TABLE IF NOT EXISTS admin_agent_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id INTEGER NOT NULL,
  title TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_agent_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL REFERENCES admin_agent_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT,
  tool_calls TEXT,
  tool_call_id TEXT,
  name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_agent_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER,
  admin_user_id INTEGER,
  tool_name TEXT NOT NULL,
  args TEXT,
  result TEXT,
  success INTEGER,
  autonomous INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_thread ON admin_agent_messages(thread_id, id);
CREATE INDEX IF NOT EXISTS idx_agent_threads_admin ON admin_agent_threads(admin_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_actions_thread ON admin_agent_actions(thread_id, created_at DESC);
