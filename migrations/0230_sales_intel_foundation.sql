-- ============================================================
-- Migration 0230: Sales Intelligence Foundation (sidecar variant)
--
-- The `customers` table is already very wide (~80+ columns from
-- 25 prior migrations) and ALTER TABLE ADD COLUMN was hitting
-- D1's column-count guard. Using a sidecar table keyed by
-- customer_id avoids that and keeps the activity columns in
-- one focused place.
--
-- See: super-admin sales overhaul (2026-05-10).
-- ============================================================

-- ── customer_sales_intel: per-customer activity + lead linkage ──
CREATE TABLE IF NOT EXISTS customer_sales_intel (
  customer_id INTEGER PRIMARY KEY,
  -- last_active_at — broadest "is this customer alive" signal.
  -- Updated on login, page view, or order. Distinct from
  -- customers.last_login (auth-only) so we keep both.
  last_active_at TEXT,
  -- last_order_at — denormalized from orders for fast filtering.
  last_order_at TEXT,
  -- Polymorphic lead linkage: which inbound form did this
  -- customer come from? Three lead tables exist
  -- (contact_leads, asset_report_leads, leads), so we store
  -- table + id rather than a hard FK.
  lead_id INTEGER,
  lead_source_table TEXT,
  lead_matched_at TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_csi_last_active_at ON customer_sales_intel(last_active_at);
CREATE INDEX IF NOT EXISTS idx_csi_last_order_at ON customer_sales_intel(last_order_at);
CREATE INDEX IF NOT EXISTS idx_csi_lead_id ON customer_sales_intel(lead_id);

-- ── orders: first-order flag (orders is narrower, fits fine) ──
ALTER TABLE orders ADD COLUMN is_first_order INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_orders_is_first_order ON orders(is_first_order);

-- ── call_objections: structured objection log ───────────────
CREATE TABLE IF NOT EXISTS call_objections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_log_id INTEGER,
  prospect_id INTEGER,
  agent_id INTEGER,
  room_name TEXT,
  category TEXT NOT NULL,
  objection_text TEXT NOT NULL,
  raw_excerpt TEXT,
  sentiment TEXT,
  call_outcome TEXT,
  call_started_at TEXT,
  extracted_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_call_objections_category ON call_objections(category);
CREATE INDEX IF NOT EXISTS idx_call_objections_extracted_at ON call_objections(extracted_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_objections_call_log ON call_objections(call_log_id);

-- ── drip_campaign_state ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS drip_campaign_state (
  customer_id INTEGER PRIMARY KEY,
  last_health_score INTEGER,
  last_evaluated_at TEXT,
  last_drip_template TEXT,
  last_drip_sent_at TEXT,
  drip_count INTEGER DEFAULT 0,
  paused INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_drip_state_last_eval ON drip_campaign_state(last_evaluated_at);

-- ============================================================
-- BACKFILLS — populate the new table from existing data so the
-- dashboard works the moment this migration ships.
-- ============================================================

-- One row per active customer, with last_order_at + last_active_at
-- pre-populated. last_active_at = freshest of last_login or last_order.
INSERT OR IGNORE INTO customer_sales_intel (customer_id, last_active_at, last_order_at, updated_at)
SELECT
  c.id,
  COALESCE(
    CASE
      WHEN c.last_login IS NOT NULL AND lo.max_created_at IS NOT NULL
        THEN CASE WHEN c.last_login > lo.max_created_at THEN c.last_login ELSE lo.max_created_at END
      WHEN c.last_login IS NOT NULL THEN c.last_login
      WHEN lo.max_created_at IS NOT NULL THEN lo.max_created_at
      ELSE c.created_at
    END,
    c.created_at
  ),
  lo.max_created_at,
  datetime('now')
FROM customers c
LEFT JOIN (
  SELECT customer_id, MAX(created_at) AS max_created_at
  FROM orders
  WHERE customer_id IS NOT NULL
  GROUP BY customer_id
) lo ON lo.customer_id = c.id;

-- Backfill is_first_order via correlated subquery (D1/SQLite-safe).
UPDATE orders
SET is_first_order = 1
WHERE id IN (
  SELECT MIN(id)
  FROM orders
  WHERE customer_id IS NOT NULL
  GROUP BY customer_id
);

-- Lead linkage backfill — match by email, prefer contact_leads
-- (highest intent), then asset_report_leads, then leads.
UPDATE customer_sales_intel
SET lead_id = (
      SELECT cl.id FROM contact_leads cl
      JOIN customers c ON c.id = customer_sales_intel.customer_id
      WHERE LOWER(cl.email) = LOWER(c.email)
      ORDER BY cl.created_at ASC LIMIT 1
    ),
    lead_source_table = 'contact_leads',
    lead_matched_at = datetime('now')
WHERE lead_id IS NULL
  AND EXISTS (
    SELECT 1 FROM contact_leads cl
    JOIN customers c ON c.id = customer_sales_intel.customer_id
    WHERE LOWER(cl.email) = LOWER(c.email)
  );

UPDATE customer_sales_intel
SET lead_id = (
      SELECT al.id FROM asset_report_leads al
      JOIN customers c ON c.id = customer_sales_intel.customer_id
      WHERE LOWER(al.email) = LOWER(c.email)
      ORDER BY al.created_at ASC LIMIT 1
    ),
    lead_source_table = 'asset_report_leads',
    lead_matched_at = datetime('now')
WHERE lead_id IS NULL
  AND EXISTS (
    SELECT 1 FROM asset_report_leads al
    JOIN customers c ON c.id = customer_sales_intel.customer_id
    WHERE LOWER(al.email) = LOWER(c.email)
  );

UPDATE customer_sales_intel
SET lead_id = (
      SELECT l.id FROM leads l
      JOIN customers c ON c.id = customer_sales_intel.customer_id
      WHERE LOWER(l.email) = LOWER(c.email)
      ORDER BY l.created_at ASC LIMIT 1
    ),
    lead_source_table = 'leads',
    lead_matched_at = datetime('now')
WHERE lead_id IS NULL
  AND EXISTS (
    SELECT 1 FROM leads l
    JOIN customers c ON c.id = customer_sales_intel.customer_id
    WHERE LOWER(l.email) = LOWER(c.email)
  );
