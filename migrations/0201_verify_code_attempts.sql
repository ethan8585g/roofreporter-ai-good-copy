-- Phase 1 #3: rate-limit failed verification-code attempts per email.
-- Without this, the 6-digit code (100k space) is brute-forceable in seconds.
-- Policy enforced in /verify-code: max 5 failed attempts per email per 15 min.

CREATE TABLE IF NOT EXISTS verify_code_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  ip TEXT,
  succeeded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vca_email_created ON verify_code_attempts(email, created_at);
