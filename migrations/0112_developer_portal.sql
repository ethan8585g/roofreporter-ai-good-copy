-- ============================================================
-- Developer Portal — self-serve signup / session auth for API customers
-- ============================================================

-- Add password_hash so API account holders can log in to the portal
ALTER TABLE api_accounts ADD COLUMN password_hash TEXT;

-- DB-backed sessions for the developer portal (mirrors admin_sessions pattern)
CREATE TABLE IF NOT EXISTS api_account_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES api_accounts(id),
  session_token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,  -- unix timestamp
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_sessions_token ON api_account_sessions(session_token);

-- Square payments need to record api_account_id for api_credits purchases
-- (customer_id is NULL for these rows)
ALTER TABLE square_payments ADD COLUMN api_account_id TEXT;
