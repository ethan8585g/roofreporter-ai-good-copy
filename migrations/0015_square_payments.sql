-- ============================================================
-- Migration 0015: Switch from Stripe to Square Payment Processing
-- Creates new Square payment tables while preserving old data
-- ============================================================

-- Square Payments table (replaces stripe_payments)
CREATE TABLE IF NOT EXISTS square_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  square_order_id TEXT,
  square_payment_id TEXT,
  square_payment_link_id TEXT,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'cad',
  status TEXT DEFAULT 'pending',
  payment_type TEXT DEFAULT 'credit_pack',
  description TEXT,
  order_id INTEGER,
  metadata_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_square_payments_customer ON square_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_square_payments_order ON square_payments(square_order_id);
CREATE INDEX IF NOT EXISTS idx_square_payments_payment ON square_payments(square_payment_id);
CREATE INDEX IF NOT EXISTS idx_square_payments_status ON square_payments(status);

-- Square Webhook Events table (replaces stripe_webhook_events)
CREATE TABLE IF NOT EXISTS square_webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  square_event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT,
  processed INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_square_webhook_events ON square_webhook_events(square_event_id);

-- Add square_customer_id to customers table (alongside existing stripe_customer_id for backwards compat)
ALTER TABLE customers ADD COLUMN square_customer_id TEXT;
CREATE INDEX IF NOT EXISTS idx_customers_square ON customers(square_customer_id);

-- Migrate existing stripe_payments data to square_payments for historical records
INSERT OR IGNORE INTO square_payments (customer_id, square_order_id, square_payment_id, amount, currency, status, payment_type, description, order_id, created_at, updated_at)
  SELECT customer_id, stripe_checkout_session_id, stripe_payment_intent_id, amount, currency, status, payment_type, description, order_id, created_at, updated_at
  FROM stripe_payments WHERE 1=1;
