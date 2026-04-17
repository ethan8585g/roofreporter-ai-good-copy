-- ============================================================
-- 0139: Call Transfer Support
-- Adds secretary_employees, call_transfers tables and extends
-- secretary_config + secretary_call_logs for post-transfer transcripts
-- ============================================================

-- Employees that the AI can transfer calls to
CREATE TABLE IF NOT EXISTS secretary_employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  role TEXT,
  phone_number TEXT NOT NULL,
  transfer_enabled INTEGER DEFAULT 1,
  available_hours TEXT,
  priority INTEGER DEFAULT 100,
  recording_consent_confirmed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
CREATE INDEX IF NOT EXISTS idx_secretary_employees_customer ON secretary_employees(customer_id);

-- Transfer records — one per transfer attempt
CREATE TABLE IF NOT EXISTS secretary_call_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_log_id INTEGER NOT NULL,
  customer_id INTEGER NOT NULL,
  employee_id INTEGER,
  employee_name TEXT,
  employee_phone TEXT,
  initiated_at TEXT NOT NULL DEFAULT (datetime('now')),
  connected_at TEXT,
  ended_at TEXT,
  status TEXT NOT NULL DEFAULT 'dialing',
  failure_reason TEXT,
  post_transfer_duration_seconds INTEGER,
  FOREIGN KEY (call_log_id) REFERENCES secretary_call_logs(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
CREATE INDEX IF NOT EXISTS idx_call_transfers_call_log ON secretary_call_transfers(call_log_id);
CREATE INDEX IF NOT EXISTS idx_call_transfers_customer ON secretary_call_transfers(customer_id);

-- Extend call logs with transcript segmentation
ALTER TABLE secretary_call_logs ADD COLUMN pre_transfer_transcript TEXT;
ALTER TABLE secretary_call_logs ADD COLUMN post_transfer_transcript TEXT;
ALTER TABLE secretary_call_logs ADD COLUMN transfer_happened INTEGER DEFAULT 0;
ALTER TABLE secretary_call_logs ADD COLUMN transferred_to_employee_id INTEGER;

-- Extend secretary_config with transfer feature settings
ALTER TABLE secretary_config ADD COLUMN transfer_enabled INTEGER DEFAULT 0;
ALTER TABLE secretary_config ADD COLUMN transfer_announcement TEXT DEFAULT 'Hi, I have {caller_name} on the line. They said: {reason_summary}. Connecting you now.';
ALTER TABLE secretary_config ADD COLUMN record_post_transfer INTEGER DEFAULT 1;
ALTER TABLE secretary_config ADD COLUMN post_transfer_disclosure TEXT DEFAULT 'Please note this call will continue to be recorded for quality and training purposes.';
ALTER TABLE secretary_config ADD COLUMN transcript_retention_days INTEGER DEFAULT 365;
