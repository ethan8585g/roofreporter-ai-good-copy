-- Web Push subscriptions for Storm Scout (and future push features).
-- One row per device; endpoint uniquely identifies the device's push channel.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  keys_p256dh TEXT NOT NULL,
  keys_auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  last_seen TEXT DEFAULT (datetime('now')),
  disabled INTEGER NOT NULL DEFAULT 0
);

-- Skipped: push_subscriptions was already created by 0074 with different schema (user_id instead of customer_id)
-- CREATE INDEX IF NOT EXISTS idx_pushsub_customer ON push_subscriptions(customer_id);
-- CREATE INDEX IF NOT EXISTS idx_pushsub_active ON push_subscriptions(disabled);
