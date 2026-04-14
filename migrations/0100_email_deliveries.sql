-- Email delivery tracking for report /email endpoint.
-- Captures one row per send attempt so we get a failure signal
-- (Gmail OAuth expired, Resend bounced, etc.) instead of dropping
-- reports silently. Resend webhook updates status → delivered /
-- bounced / complained via provider_message_id.

CREATE TABLE IF NOT EXISTS email_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER,
  recipient TEXT NOT NULL,
  subject TEXT,
  method TEXT,                      -- customer_gmail | gmail_oauth2 | resend | none
  sender_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
                                    -- pending | sent | delivered | bounced | complained | opened | failed
  provider_message_id TEXT,         -- Resend id or Gmail message id
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_deliveries_order ON email_deliveries(order_id);
CREATE INDEX IF NOT EXISTS idx_email_deliveries_status ON email_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_email_deliveries_provider_msg ON email_deliveries(provider_message_id);
CREATE INDEX IF NOT EXISTS idx_email_deliveries_created ON email_deliveries(created_at);

CREATE TABLE IF NOT EXISTS resend_webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT,
  provider_message_id TEXT,
  recipient TEXT,
  payload TEXT,
  received_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_resend_webhook_msg ON resend_webhook_events(provider_message_id);
