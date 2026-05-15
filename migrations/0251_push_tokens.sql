-- 0251_push_tokens.sql
-- Stores APNs / FCM device tokens for the iOS + Android apps.
-- A single customer can have multiple devices; we keep all active tokens and
-- mark dead ones with revoked_at instead of deleting (lets us learn which
-- platforms a user has installed the app on for analytics).

CREATE TABLE IF NOT EXISTS push_tokens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id   INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  admin_user_id INTEGER REFERENCES admin_users(id) ON DELETE CASCADE,
  token         TEXT NOT NULL,
  platform      TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  app_version   TEXT,
  device_model  TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  revoked_at    DATETIME,
  UNIQUE(token, platform)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_customer    ON push_tokens(customer_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_push_tokens_admin       ON push_tokens(admin_user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_push_tokens_last_seen   ON push_tokens(last_seen_at);
