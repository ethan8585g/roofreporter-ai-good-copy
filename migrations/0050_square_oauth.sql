-- ============================================================
-- Migration 0050: Per-user Square OAuth connection
-- Allows each contractor to connect their own Square account
-- so invoice/proposal payment links route to their account.
-- ============================================================

CREATE TABLE IF NOT EXISTS customer_square_oauth (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL UNIQUE,
  square_merchant_id TEXT NOT NULL,
  square_access_token TEXT NOT NULL,
  square_refresh_token TEXT,
  square_location_id TEXT NOT NULL,
  square_location_name TEXT,
  square_merchant_name TEXT,
  square_currency TEXT DEFAULT 'USD',
  oauth_state TEXT,
  token_expires_at TEXT,
  connected_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customer_square_oauth_customer ON customer_square_oauth(customer_id);

-- Add payment link columns to proposals (invoices already have them from migration 0043)
ALTER TABLE crm_proposals ADD COLUMN payment_link_url TEXT DEFAULT NULL;
ALTER TABLE crm_proposals ADD COLUMN payment_link_id TEXT DEFAULT NULL;
