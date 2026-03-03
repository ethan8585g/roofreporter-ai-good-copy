-- Email verification codes for customer registration
CREATE TABLE IF NOT EXISTS email_verification_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  verified_at TEXT,
  verification_token TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_verification_codes_email ON email_verification_codes(email);
CREATE INDEX IF NOT EXISTS idx_verification_codes_token ON email_verification_codes(verification_token);
