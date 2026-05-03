-- ============================================================
-- 0205 — Capture Google Ads click ID on customers
--
-- Why: enables offline conversion uploads to Google Ads. When a free
-- signup later upgrades to paid, we can push that paid conversion back
-- to the original ad click via the stored gclid — Smart Bidding then
-- learns LTV, not just signup count.
--
-- UTMs are already captured per-customer in analytics_attribution
-- (first_touch_utm_*) so we don't duplicate them here. customers.created_at
-- already records when the gclid was captured (gclid is set at register
-- time only) so no separate captured_at column is needed.
-- ============================================================

ALTER TABLE customers ADD COLUMN gclid TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_gclid ON customers(gclid) WHERE gclid IS NOT NULL;

-- ROLLBACK (manual):
--   ALTER TABLE customers DROP COLUMN gclid;
--   DROP INDEX IF EXISTS idx_customers_gclid;
