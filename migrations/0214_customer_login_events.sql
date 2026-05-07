-- Track every customer login so super admin can show lifetime + daily counts.
-- We do NOT add a denormalised login_count column to `customers` because that
-- table has hit SQLite's max column count. Instead lifetime is computed via
-- COUNT(*) over this table when the dashboard renders.

CREATE TABLE IF NOT EXISTS customer_login_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  auth_method TEXT NOT NULL DEFAULT 'email',
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_login_events_customer ON customer_login_events(customer_id);
CREATE INDEX IF NOT EXISTS idx_login_events_created  ON customer_login_events(created_at);
CREATE INDEX IF NOT EXISTS idx_login_events_customer_date ON customer_login_events(customer_id, created_at);

-- Seed one event for every customer who already has a last_login timestamp,
-- so existing users show at least 1 lifetime login on first deploy.
INSERT INTO customer_login_events (customer_id, auth_method, created_at)
SELECT id, 'backfill', last_login
FROM customers
WHERE last_login IS NOT NULL;
