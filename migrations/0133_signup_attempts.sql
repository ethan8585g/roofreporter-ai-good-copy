CREATE TABLE IF NOT EXISTS signup_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  preview_id TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  completed INTEGER NOT NULL DEFAULT 0,
  recovery_sent INTEGER NOT NULL DEFAULT 0,
  recovery_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_signup_attempts_email ON signup_attempts(email);
CREATE INDEX IF NOT EXISTS idx_signup_attempts_created_at ON signup_attempts(created_at DESC);

CREATE TABLE IF NOT EXISTS signup_recovery_optouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_signup_recovery_optouts_email ON signup_recovery_optouts(email);
