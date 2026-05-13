-- ============================================================
-- Super Admin → Email Tracker module
--
-- Extends email_sends so it can serve as the canonical outbound-email
-- audit log for EVERY email the platform sends (reports, invoices,
-- welcome, cart-recovery, lead alerts, admin alerts, health alerts,
-- and manual sales@ composer messages). Existing report sends still
-- log to email_deliveries — the dashboard UNIONs both sources.
--
-- New columns capture the full from→to→body so the super-admin can
-- view the exact email that was sent and resend it later. Adds a
-- suppression list so a recipient flagged as bouncing/complained is
-- skipped automatically.
-- ============================================================

-- New columns on email_sends. SQLite doesn't support IF NOT EXISTS
-- on ADD COLUMN, but Cloudflare D1's migration runner only runs each
-- migration file once per environment, so plain ALTER is safe.
ALTER TABLE email_sends ADD COLUMN body_html TEXT;
ALTER TABLE email_sends ADD COLUMN body_text TEXT;
ALTER TABLE email_sends ADD COLUMN from_addr TEXT;
ALTER TABLE email_sends ADD COLUMN category TEXT;
                                              -- customer | internal | cart | alert | lead | manual
ALTER TABLE email_sends ADD COLUMN order_id INTEGER;
ALTER TABLE email_sends ADD COLUMN retry_of_id INTEGER;
                                              -- if this row is a resend, points to the original email_sends.id
ALTER TABLE email_sends ADD COLUMN provider_message_id TEXT;
                                              -- Gmail message id or Resend id (for webhook reconciliation)
ALTER TABLE email_sends ADD COLUMN status TEXT NOT NULL DEFAULT 'sent';
                                              -- pending | sent | failed | suppressed | deduped | bounced | complained | delivered
ALTER TABLE email_sends ADD COLUMN source TEXT;
                                              -- 'platform' (wrapper-emitted) | 'gmail_mirror' (Sent-folder sync) | 'composer'
ALTER TABLE email_sends ADD COLUMN dedup_key TEXT;
                                              -- short hash of recipient+subject+body, populated when dedup is on

CREATE INDEX IF NOT EXISTS idx_email_sends_recipient ON email_sends(recipient);
CREATE INDEX IF NOT EXISTS idx_email_sends_category ON email_sends(category, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_sends_status ON email_sends(status);
CREATE INDEX IF NOT EXISTS idx_email_sends_dedup ON email_sends(dedup_key, sent_at);
CREATE INDEX IF NOT EXISTS idx_email_sends_provider_msg ON email_sends(provider_message_id);
CREATE INDEX IF NOT EXISTS idx_email_sends_order ON email_sends(order_id);
CREATE INDEX IF NOT EXISTS idx_email_sends_sent_at ON email_sends(sent_at DESC);

-- ============================================================
-- email_suppressions — manual + automatic suppression list
--
-- A row here means "do NOT send to this address". The wrapper short-
-- circuits when the recipient matches and logs the attempt with
-- status='suppressed' so the super-admin can see we declined to send.
-- ============================================================
CREATE TABLE IF NOT EXISTS email_suppressions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL,
                                              -- 'manual' | 'hard_bounce' | 'complaint' | 'invalid' | 'unsubscribe'
  notes TEXT,
  suppressed_at DATETIME NOT NULL DEFAULT (datetime('now')),
  suppressed_by_admin_id INTEGER,
  released_at DATETIME,
                                              -- non-null means the suppression was lifted; row kept for audit
  released_by_admin_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_email_suppressions_email ON email_suppressions(email);
CREATE INDEX IF NOT EXISTS idx_email_suppressions_active ON email_suppressions(released_at);

-- ============================================================
-- gmail_sent_mirror_state — bookmark for the Gmail Sent-folder
-- background sync so we only fetch new messages each tick.
-- ============================================================
CREATE TABLE IF NOT EXISTS gmail_sent_mirror_state (
  mailbox TEXT PRIMARY KEY,
                                              -- 'sales@roofmanager.ca' etc.
  last_history_id TEXT,
                                              -- Gmail historyId — opaque cursor for incremental sync
  last_synced_at DATETIME,
  last_error TEXT
);
