-- 0224_attribution_columns.sql
-- Customers table is at SQLite's ALTER-friendly column limit (100 cols), so the
-- additional UTM dimensions go to the existing analytics_attribution table
-- instead. orders gains a gclid column so paid Google Ads conversions can be
-- uploaded back to Google Ads later (offline conversion API).

ALTER TABLE orders ADD COLUMN gclid TEXT;
