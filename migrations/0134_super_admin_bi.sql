-- ============================================================
-- Migration 0134: Super Admin BI Dashboard — performance indexes
-- Adds composite indexes for fast BI aggregation queries.
-- No new tables needed — all source data already exists.
-- ============================================================

-- Speed up revenue/payment analytics
CREATE INDEX IF NOT EXISTS idx_sq_payments_type_status_created
  ON square_payments(payment_type, status, created_at);

-- Speed up customer health queries
CREATE INDEX IF NOT EXISTS idx_customers_active_login
  ON customers(is_active, last_login, membership_tier_id);

-- Speed up conversion funnel queries on event + page + time
CREATE INDEX IF NOT EXISTS idx_analytics_event_page_created
  ON site_analytics(event_type, page_url, created_at);

-- Speed up per-endpoint API performance queries
CREATE INDEX IF NOT EXISTS idx_api_log_path_status_created
  ON api_request_log(path, status_code, created_at);
