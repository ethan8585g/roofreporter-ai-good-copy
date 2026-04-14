-- ============================================================
-- Migration 0110: Public API Service
-- Adds API accounts, keys, credit ledger, jobs, and audit log
-- for the third-party roof measurement API.
-- ============================================================

-- API consumers (separate from admin_users / customers)
CREATE TABLE IF NOT EXISTS api_accounts (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  credit_balance INTEGER NOT NULL DEFAULT 0,   -- 1 credit = 1 report
  status TEXT NOT NULL DEFAULT 'active',        -- active | suspended | banned
  webhook_url TEXT,
  webhook_secret TEXT,
  created_at INTEGER NOT NULL,
  stripe_customer_id TEXT
);

-- API keys — multiple per account, stored hashed
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES api_accounts(id),
  key_prefix TEXT NOT NULL,    -- first 12 chars of the raw key, stored plain for O(1) lookup
  key_hash TEXT NOT NULL,      -- PBKDF2-SHA256 of the full key
  name TEXT,
  last_used_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(key_prefix)
);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_account ON api_keys(account_id);

-- Credit ledger — immutable audit trail of every balance change
CREATE TABLE IF NOT EXISTS api_credit_ledger (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES api_accounts(id),
  delta INTEGER NOT NULL,          -- positive = credit, negative = debit/hold
  balance_after INTEGER NOT NULL,
  reason TEXT NOT NULL,            -- 'purchase' | 'hold' | 'debit' | 'refund'
  ref_type TEXT,                   -- 'square_payment' | 'api_job' | 'admin_adjustment'
  ref_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_ledger_account ON api_credit_ledger(account_id, created_at DESC);

-- API jobs — one per POST /v1/reports request
CREATE TABLE IF NOT EXISTS api_jobs (
  id TEXT PRIMARY KEY,              -- UUIDv4, exposed as job_id
  account_id TEXT NOT NULL REFERENCES api_accounts(id),
  api_key_id TEXT NOT NULL REFERENCES api_keys(id),
  order_id INTEGER,                 -- set after admin creates the order for tracing
  status TEXT NOT NULL DEFAULT 'queued',  -- queued | tracing | generating | ready | failed | cancelled
  address TEXT NOT NULL,
  lat REAL,
  lng REAL,
  client_reference TEXT,            -- caller-supplied idempotency key
  credits_held INTEGER NOT NULL DEFAULT 1,
  error_code TEXT,
  error_message TEXT,
  pdf_signed_url TEXT,              -- signed PDF URL, set on completion
  pdf_expires_at INTEGER,           -- unix timestamp when pdf_signed_url expires
  webhook_delivered_at INTEGER,
  webhook_attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  finalized_at INTEGER,
  UNIQUE(account_id, client_reference)
);
CREATE INDEX IF NOT EXISTS idx_api_jobs_status ON api_jobs(status);
CREATE INDEX IF NOT EXISTS idx_api_jobs_account ON api_jobs(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_jobs_order ON api_jobs(order_id);

-- Rate limit sliding-window counters (keyed by account_id:minute or account_id:hour)
CREATE TABLE IF NOT EXISTS api_rate_buckets (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);

-- Full request audit log — no request bodies, just metadata + hash
CREATE TABLE IF NOT EXISTS api_request_log (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  api_key_id TEXT,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code INTEGER,
  ip TEXT,
  user_agent TEXT,
  duration_ms INTEGER,
  request_body_sha256 TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_log_account ON api_request_log(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_log_time ON api_request_log(created_at DESC);
