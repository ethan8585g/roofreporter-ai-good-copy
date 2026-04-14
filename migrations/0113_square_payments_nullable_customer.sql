-- ============================================================
-- Migration 0113: Make square_payments.customer_id nullable
--
-- API credit purchases (payment_type='api_credits') have no customer_id
-- because they come from api_accounts, not customers.
-- SQLite does not support ALTER COLUMN, so we recreate the table.
-- ============================================================

-- Disable FK checks during recreation (D1 does not enforce FKs by default,
-- but this is belt-and-suspenders for any future enforcement toggle).
PRAGMA foreign_keys = OFF;

-- Step 1: Recreate with customer_id nullable
CREATE TABLE IF NOT EXISTS square_payments_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,                          -- nullable: NULL / 0 for API-account purchases
  api_account_id TEXT,                          -- set for payment_type='api_credits'
  square_order_id TEXT,
  square_payment_id TEXT,
  square_payment_link_id TEXT,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'usd',
  status TEXT DEFAULT 'pending',
  payment_type TEXT DEFAULT 'credit_pack',
  description TEXT,
  order_id INTEGER,
  metadata_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Step 2: Copy all existing data (api_account_id may or may not exist yet)
INSERT INTO square_payments_v2
  (id, customer_id, api_account_id, square_order_id, square_payment_id,
   square_payment_link_id, amount, currency, status, payment_type,
   description, order_id, metadata_json, created_at, updated_at)
SELECT
  id,
  CASE WHEN customer_id = 0 THEN NULL ELSE customer_id END,
  api_account_id,
  square_order_id, square_payment_id, square_payment_link_id,
  amount, currency, status, payment_type,
  description, order_id, metadata_json, created_at, updated_at
FROM square_payments;

-- Step 3: Drop old table and rename
DROP TABLE square_payments;
ALTER TABLE square_payments_v2 RENAME TO square_payments;

-- Step 4: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_square_payments_customer  ON square_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_square_payments_order     ON square_payments(square_order_id);
CREATE INDEX IF NOT EXISTS idx_square_payments_payment   ON square_payments(square_payment_id);
CREATE INDEX IF NOT EXISTS idx_square_payments_status    ON square_payments(status);
CREATE INDEX IF NOT EXISTS idx_square_payments_api_acct  ON square_payments(api_account_id);

PRAGMA foreign_keys = ON;
