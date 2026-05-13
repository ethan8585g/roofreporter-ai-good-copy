-- Denial fields on orders + customer-initiated re-trace requests.
-- Denial lives on the order (the unit being denied) because the reports
-- row may not exist yet when an order is denied at queue time.

ALTER TABLE orders ADD COLUMN denied_at TEXT;
ALTER TABLE orders ADD COLUMN denied_reason TEXT;
ALTER TABLE orders ADD COLUMN denied_by_admin_id INTEGER;

CREATE TABLE IF NOT EXISTS retrace_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  customer_id INTEGER NOT NULL,
  report_id INTEGER,
  reason_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT,
  admin_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_retrace_requests_status ON retrace_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_retrace_requests_order ON retrace_requests(order_id);
CREATE INDEX IF NOT EXISTS idx_retrace_requests_customer ON retrace_requests(customer_id);
