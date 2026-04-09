-- Migration 0074: Push notification subscriptions
-- Stores both FCM device tokens (iOS native) and Web Push subscriptions (browsers)

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_type TEXT NOT NULL DEFAULT 'admin',  -- 'admin' or 'customer'
  user_id INTEGER NOT NULL,
  platform TEXT NOT NULL,                    -- 'ios', 'web', 'android'
  fcm_token TEXT,                            -- FCM token (native iOS/Android)
  endpoint TEXT,                             -- Web Push subscription endpoint
  p256dh_key TEXT,                           -- Web Push client public key
  auth_key TEXT,                             -- Web Push client auth secret
  device_name TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_push_sub_user ON push_subscriptions(user_type, user_id, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_sub_fcm ON push_subscriptions(fcm_token) WHERE fcm_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_sub_endpoint ON push_subscriptions(endpoint) WHERE endpoint IS NOT NULL;
