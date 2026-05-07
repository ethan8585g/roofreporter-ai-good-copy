-- Track every report open so super admin can show per-report view counts and
-- a recent-activity drill-down. Mirrors the 0214 customer_login_events pattern:
-- minimal append-only table, counts computed via COUNT(*) at query time.
-- We do NOT add another counter column to `reports` (that table has hit
-- SQLite's max column count — see migration 0214).
--
-- view_type values:
--   'share'  — public /report/share/:token visit (no auth)
--   'portal' — authenticated customer-portal HTML view
--   'pdf'    — pro or customer PDF download
--   'admin'  — super-admin auditing a report (excluded from headline count)

CREATE TABLE IF NOT EXISTS report_view_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  report_id INTEGER,
  view_type TEXT NOT NULL,
  customer_id INTEGER,
  ip_address TEXT,
  user_agent TEXT,
  share_token TEXT,
  is_bot INTEGER NOT NULL DEFAULT 0,
  viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_report_view_events_order        ON report_view_events(order_id);
CREATE INDEX IF NOT EXISTS idx_report_view_events_order_viewed ON report_view_events(order_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_view_events_customer     ON report_view_events(customer_id);
CREATE INDEX IF NOT EXISTS idx_report_view_events_viewed       ON report_view_events(viewed_at);
