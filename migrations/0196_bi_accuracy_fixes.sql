-- 0196: BI accuracy — manual payments + clamp inflated activity durations.
-- Two unrelated-but-related fixes: the Command Center couldn't show offline
-- payments, and idle browser tabs were counted as active time.

-- ── 1. Manual payments — for purchases recorded outside the app ───────
-- Pricing changes, bulk deals, e-transfer, etc. Counted alongside paid
-- orders.price in top-spender / total-revenue rollups.
CREATE TABLE IF NOT EXISTS manual_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  description TEXT,
  paid_at TEXT NOT NULL DEFAULT (datetime('now')),
  recorded_by_admin_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_manual_payments_customer ON manual_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_manual_payments_paid_at ON manual_payments(paid_at DESC);

-- ── 2. Clamp existing inflated visit durations ───────────────────────
-- Visits over 30 min almost always mean a foreground-but-idle tab. Any
-- legitimate single-module session over 30 min is rare; clamp the row
-- and adjust the rollup to match.
UPDATE user_module_visits
   SET duration_seconds = 1800
 WHERE duration_seconds > 1800;

-- Rebuild yesterday/today's daily rollup from the now-clamped source.
DELETE FROM user_activity_daily WHERE day >= date('now','-7 days');
INSERT INTO user_activity_daily (day, user_type, user_id, module, total_seconds, visit_count, request_count)
SELECT date(started_at) AS day, user_type, user_id, module,
       SUM(duration_seconds), COUNT(*), SUM(request_count)
FROM user_module_visits
WHERE date(started_at) >= date('now','-7 days')
GROUP BY day, user_type, user_id, module
ON CONFLICT(day, user_type, user_id, module) DO UPDATE SET
  total_seconds = excluded.total_seconds,
  visit_count   = excluded.visit_count,
  request_count = excluded.request_count;
