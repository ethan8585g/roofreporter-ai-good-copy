-- Report sharing: public shareable links for completed reports
ALTER TABLE reports ADD COLUMN share_token TEXT DEFAULT NULL;
ALTER TABLE reports ADD COLUMN share_view_count INTEGER DEFAULT 0;
ALTER TABLE reports ADD COLUMN share_sent_at TEXT DEFAULT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_share_token ON reports(share_token);
