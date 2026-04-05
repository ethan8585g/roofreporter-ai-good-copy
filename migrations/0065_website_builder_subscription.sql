-- Website Builder Subscription — $99/month via Square
CREATE TABLE IF NOT EXISTS wb_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, active, cancelled, expired
  square_order_id TEXT,
  square_payment_link_id TEXT,
  monthly_price_cents INTEGER NOT NULL DEFAULT 9900,
  current_period_start TEXT,
  current_period_end TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS idx_wb_subs_customer ON wb_subscriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_wb_subs_status ON wb_subscriptions(status);
