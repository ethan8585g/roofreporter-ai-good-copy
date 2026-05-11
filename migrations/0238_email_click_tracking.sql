-- ============================================================
-- email_sends — Add click-tracking columns
--
-- Open tracking (pixel) is unreliable due to image prefetch by Gmail/
-- Apple Mail and image-blocking by Outlook. Click tracking (wrapped
-- href redirects through /api/email-link/<token>) is the trustworthy
-- signal: a click is unambiguously a human action.
-- ============================================================
ALTER TABLE email_sends ADD COLUMN click_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_sends ADD COLUMN first_clicked_at DATETIME;
ALTER TABLE email_sends ADD COLUMN last_clicked_at DATETIME;
ALTER TABLE email_sends ADD COLUMN last_clicked_url TEXT;
ALTER TABLE email_sends ADD COLUMN last_clicked_ip TEXT;
ALTER TABLE email_sends ADD COLUMN last_clicked_ua TEXT;
