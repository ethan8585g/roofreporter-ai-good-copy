-- Phase: accuracy + tracing-UX upgrades
-- Adds report-level "needs review" flag (footprint reconciliation gate)
-- and per-segment eave/rake tagging captured during tracing.

ALTER TABLE reports ADD COLUMN needs_review INTEGER DEFAULT 0;
ALTER TABLE reports ADD COLUMN review_reason TEXT;
ALTER TABLE reports ADD COLUMN review_detail TEXT;
ALTER TABLE reports ADD COLUMN eaves_tags TEXT;

CREATE INDEX IF NOT EXISTS idx_reports_needs_review ON reports(needs_review) WHERE needs_review = 1;
