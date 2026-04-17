-- Fix square_payment_links: the 0050_enhanced migration created the table with
-- different column names (square_link_id, square_link_url, etc.) than the code
-- expects (payment_link_id, payment_link_url, etc.).  Drop and recreate with
-- the schema the codebase actually uses.  The table is expected to be empty
-- since the column mismatch prevented any rows from ever being inserted.

DROP TABLE IF EXISTS square_payment_links;

CREATE TABLE square_payment_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  payment_link_id TEXT,
  payment_link_url TEXT,
  order_id TEXT,
  amount_cents INTEGER,
  currency TEXT DEFAULT 'CAD',
  status TEXT DEFAULT 'created',
  checkout_id TEXT DEFAULT '',
  transaction_id TEXT DEFAULT '',
  receipt_url TEXT DEFAULT '',
  paid_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);

CREATE INDEX IF NOT EXISTS idx_sq_pay_links_invoice ON square_payment_links(invoice_id);
CREATE INDEX IF NOT EXISTS idx_sq_pay_links_order ON square_payment_links(order_id);
