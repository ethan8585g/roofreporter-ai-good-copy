-- Move customers.material_preferences to a side table.
-- Reason: 0198 added this column as the 100th on the `customers` table,
-- which trips D1's 100-column-per-result-set limit on every `SELECT *`
-- query (login flows, Square checkout, getCustomerFromToken). Splitting
-- it out keeps customers under the cap and is also a cleaner schema.
CREATE TABLE IF NOT EXISTS customer_material_preferences (
  customer_id INTEGER PRIMARY KEY,
  material_preferences TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Best-effort copy in case anyone wrote to the column between 0198 and the
-- column drop. Safe to run on environments where 0198 was never applied.
INSERT OR IGNORE INTO customer_material_preferences (customer_id, material_preferences)
SELECT id, material_preferences FROM customers WHERE material_preferences IS NOT NULL;

-- Drop the column. SQLite supports this since 3.35; D1 supports it.
ALTER TABLE customers DROP COLUMN material_preferences;
