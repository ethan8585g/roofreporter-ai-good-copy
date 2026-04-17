-- ============================================================
-- Migration 0138: Allow portal-submitted API jobs
-- Makes api_key_id nullable so jobs can be submitted directly
-- from the developer portal (no API key required for portal UI).
-- Also adds a source column ('api' | 'portal') for audit clarity.
-- ============================================================

-- SQLite doesn't support ALTER COLUMN, so we recreate the table.
CREATE TABLE IF NOT EXISTS api_jobs_new (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES api_accounts(id),
  api_key_id TEXT,                    -- NULL for portal-submitted jobs
  order_id INTEGER,
  status TEXT NOT NULL DEFAULT 'queued',
  address TEXT NOT NULL,
  lat REAL,
  lng REAL,
  client_reference TEXT,
  credits_held INTEGER NOT NULL DEFAULT 1,
  error_code TEXT,
  error_message TEXT,
  pdf_signed_url TEXT,
  pdf_expires_at INTEGER,
  webhook_delivered_at INTEGER,
  webhook_attempts INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'api',  -- 'api' | 'portal'
  created_at INTEGER NOT NULL,
  finalized_at INTEGER,
  UNIQUE(account_id, client_reference)
);

INSERT INTO api_jobs_new
  SELECT id, account_id, api_key_id, order_id, status, address, lat, lng,
         client_reference, credits_held, error_code, error_message,
         pdf_signed_url, pdf_expires_at, webhook_delivered_at, webhook_attempts,
         'api' as source, created_at, finalized_at
  FROM api_jobs;

DROP TABLE api_jobs;
ALTER TABLE api_jobs_new RENAME TO api_jobs;

CREATE INDEX IF NOT EXISTS idx_api_jobs_status  ON api_jobs(status);
CREATE INDEX IF NOT EXISTS idx_api_jobs_account ON api_jobs(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_jobs_order   ON api_jobs(order_id);
