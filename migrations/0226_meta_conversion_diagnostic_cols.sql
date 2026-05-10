-- 0226_meta_conversion_diagnostic_cols.sql
-- Add diagnostic columns to meta_conversion_events so a CAPI failure can be
-- traced through Meta's Events Manager (fbtrace_id) and HTTP-level error
-- categorization (4xx auth vs 5xx outage vs rate-limit). test_event_code
-- distinguishes ads-health probes from production conversions.

ALTER TABLE meta_conversion_events ADD COLUMN fbtrace_id TEXT;
ALTER TABLE meta_conversion_events ADD COLUMN http_status_code INTEGER;
ALTER TABLE meta_conversion_events ADD COLUMN test_event_code TEXT;

CREATE INDEX IF NOT EXISTS idx_meta_conv_fbtrace ON meta_conversion_events(fbtrace_id);
CREATE INDEX IF NOT EXISTS idx_meta_conv_http ON meta_conversion_events(http_status_code, created_at DESC);
