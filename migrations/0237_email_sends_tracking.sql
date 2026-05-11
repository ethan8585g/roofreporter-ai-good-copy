-- ============================================================
-- email_sends — Outbound transactional email log with open tracking
--
-- Captures every welcome / nurture / lifecycle email the system sends
-- to a customer. The tracking_token is the unique random ID embedded
-- in a 1x1 GIF pixel inside the email body. When the recipient's mail
-- client loads images, GET /api/email-pixel/<token>.gif updates
-- opened_at + open_count.
--
-- Caveats (honest):
--   - Gmail/Apple Mail prefetch images server-side → opened_at can
--     fire before a human actually reads the email.
--   - Outlook blocks images by default → opens never register even
--     if the human read it.
--   - Click tracking (wrapped links) is more reliable than opens.
--     This table is open-only for now; click tracking is a follow-up.
-- ============================================================
CREATE TABLE IF NOT EXISTS email_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,                 -- nullable: some emails go to non-customer leads
  recipient TEXT NOT NULL,             -- email address it was sent to
  kind TEXT NOT NULL,                  -- 'welcome', 'nurture_1h', 'nurture_24h', 'nurture_3d', etc.
  subject TEXT,
  tracking_token TEXT NOT NULL UNIQUE, -- random 32-char token in pixel URL
  sent_at DATETIME NOT NULL DEFAULT (datetime('now')),
  opened_at DATETIME,                  -- first open (any device, any client)
  open_count INTEGER NOT NULL DEFAULT 0,
  last_opened_at DATETIME,
  last_opened_ua TEXT,
  last_opened_ip TEXT,
  -- Errors: if the underlying transport throws, we still log a row
  -- so the super-admin can see "we tried but failed", with the reason.
  send_error TEXT,
  created_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_sends_customer ON email_sends(customer_id);
CREATE INDEX IF NOT EXISTS idx_email_sends_token ON email_sends(tracking_token);
CREATE INDEX IF NOT EXISTS idx_email_sends_kind_sent ON email_sends(kind, sent_at DESC);
