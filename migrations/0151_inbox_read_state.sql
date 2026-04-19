-- Inbox read state — per-admin-user tracking of last read time per conversation
CREATE TABLE IF NOT EXISTS inbox_read_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id INTEGER NOT NULL,
  conversation_id TEXT NOT NULL,   -- e.g. rover_123, call_456, msg_789
  channel TEXT NOT NULL,           -- web_chat, voice, sms, voicemail, form, cold_call, job_message
  last_read_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(admin_user_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_inbox_read_admin ON inbox_read_state(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_inbox_read_conv ON inbox_read_state(conversation_id);
