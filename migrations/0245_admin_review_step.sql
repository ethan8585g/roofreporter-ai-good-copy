-- Admin review gate between trace generation and customer delivery.
-- Inserts a "draft → admin reviews → approved" step into the super-admin
-- manual-trace flow so the operator can preview the rendered report and
-- curate imagery before the customer sees anything.
--
-- Lifecycle:
--   NULL                   = legacy / already-delivered (today's behaviour)
--   'awaiting_review'      = HTML rendered, customer MUST NOT see it yet
--   'approved'             = admin shipped it; finalize_delivery has fired
--
-- Customer visibility queries (customer-auth.ts orders + progress endpoints)
-- and the public GET /api/reports/:id/html route gate on this column so a
-- draft report can never leak before the operator clicks "Submit to Customer".

ALTER TABLE reports ADD COLUMN admin_review_status TEXT;
ALTER TABLE reports ADD COLUMN admin_review_started_at TEXT;
ALTER TABLE reports ADD COLUMN admin_review_completed_at TEXT;
ALTER TABLE reports ADD COLUMN admin_review_admin_id INTEGER;

-- Partial index — only rows mid-review need to be queryable. Keeps the
-- index tiny since 99% of reports stay in the NULL/approved terminal state.
CREATE INDEX IF NOT EXISTS idx_reports_admin_review_status
  ON reports(admin_review_status)
  WHERE admin_review_status IS NOT NULL;
