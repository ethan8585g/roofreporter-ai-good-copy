-- ============================================================
-- Account Deletion Request Queue
-- Backs POST /api/customer/account/request-deletion. The customer profile
-- page now POSTs here when a logged-in user confirms account deletion. A
-- super-admin reviews each row and processes (or refunds + deletes) within
-- the SLA promised in the UI.
-- Replaces the prior placeholder behavior (toast-only, no DB write, no
-- support notification).
-- ============================================================

CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  email_confirmation TEXT,        -- whatever the user typed when confirming (audit trail)
  reason TEXT,                    -- optional free-text "why" (future field; nullable now)
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | acknowledged | completed | rejected
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  acknowledged_at TEXT,
  acknowledged_by TEXT,           -- admin email
  processed_at TEXT,
  processed_by TEXT,
  notes TEXT,                     -- admin notes on resolution
  ip_address TEXT,                -- request origin for audit
  user_agent TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_acct_del_status ON account_deletion_requests(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_acct_del_customer ON account_deletion_requests(customer_id);
