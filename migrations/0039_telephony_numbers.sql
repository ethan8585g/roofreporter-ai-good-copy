-- Telephony Numbers table for tracking purchased/configured phone numbers
CREATE TABLE IF NOT EXISTS telephony_numbers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL,
  label TEXT DEFAULT '',
  type TEXT DEFAULT 'local',
  provider TEXT DEFAULT 'manual',
  forwarding_active INTEGER DEFAULT 0,
  forward_to TEXT DEFAULT '',
  sip_trunk_id TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for quick lookup
CREATE INDEX IF NOT EXISTS idx_telephony_numbers_active ON telephony_numbers(is_active);
CREATE INDEX IF NOT EXISTS idx_telephony_numbers_number ON telephony_numbers(number);
