-- Customer-facing report copy: aerial + 3D + 2D diagrams, no measurements.
-- Stored alongside the regular professional_report_html so a single order
-- has both artifacts available for download / email.

ALTER TABLE reports ADD COLUMN customer_report_html TEXT;
