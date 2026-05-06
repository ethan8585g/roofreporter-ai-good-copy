-- Persistent super-admin notification feed. Source of truth for "did super
-- admin see this order arrive?" — email is best-effort, this row is durable.
-- Inserted synchronously on every order-creation path so a Worker crash or
-- email outage can't make an order silently invisible to admin.

CREATE TABLE IF NOT EXISTS super_admin_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                  -- 'new_order' | 'needs_trace' | 'trace_completed' | 'payment_unmatched'
  order_id INTEGER,
  order_number TEXT,
  customer_id INTEGER,
  customer_email TEXT,
  property_address TEXT,
  service_tier TEXT,
  price REAL,
  payment_status TEXT,
  is_trial INTEGER DEFAULT 0,
  trace_source TEXT,
  needs_admin_trace INTEGER DEFAULT 0,
  email_status TEXT DEFAULT 'pending', -- 'pending' | 'sent' | 'failed' | 'partial'
  email_detail TEXT,
  severity TEXT DEFAULT 'info',        -- 'info' | 'warn' | 'urgent'
  read_at DATETIME,
  payload_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_san_unread ON super_admin_notifications(read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_san_kind ON super_admin_notifications(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_san_order ON super_admin_notifications(order_id);

-- Idempotency key for one-time-report Square checkout. Mirrors the
-- orders.idempotency_key pattern (migration 0188): a double-clicked "Pay
-- with Square" button now returns the existing checkout URL instead of
-- creating a duplicate square_payments row.
ALTER TABLE square_payments ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_square_payments_customer_idempotency
  ON square_payments(customer_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
