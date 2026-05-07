-- ============================================================
-- Migration 0180: B2B Qualifying Fields on customers
-- conv-v5: Section 5 — capture sales-qualifying data at signup
-- ============================================================
-- Notes:
--   - `phone` and `company_name` already exist on customers (see 0006_customer_portal.sql),
--     so this migration only adds the two new qualifying columns.
--   - All new columns are NULLABLE so existing rows are unaffected.

ALTER TABLE customers ADD COLUMN company_size TEXT;
ALTER TABLE customers ADD COLUMN primary_use TEXT;

-- Helpful indexes for segmentation / sales filtering
CREATE INDEX IF NOT EXISTS idx_customers_company_size ON customers(company_size);
CREATE INDEX IF NOT EXISTS idx_customers_primary_use ON customers(primary_use);
