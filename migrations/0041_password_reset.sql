-- Migration 0041: Password reset tokens
-- Enables "Forgot Password" flow for both customer and admin accounts.
-- Tokens are single-use, expire in 1 hour, and are tied to account_type.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'customer',
  used INTEGER DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prt_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_prt_email ON password_reset_tokens(email);
