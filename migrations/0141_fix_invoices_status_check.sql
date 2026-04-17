-- Fix invoices status CHECK constraint: the original constraint only allows
-- (draft, sent, viewed, paid, overdue, cancelled, refunded) but proposals
-- need 'accepted' and 'declined'.  SQLite requires table recreation to change
-- CHECK constraints.

-- 0. Drop triggers that reference invoices (will recreate after)
DROP TRIGGER IF EXISTS cascade_customer_delete_invoices;

-- 1. Create new table with expanded CHECK
CREATE TABLE invoices_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT UNIQUE NOT NULL,
  customer_id INTEGER NOT NULL,
  order_id INTEGER,
  subtotal REAL NOT NULL DEFAULT 0,
  tax_rate REAL DEFAULT 5.0,
  tax_amount REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'CAD',
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft','sent','viewed','paid','overdue','cancelled','refunded','accepted','declined')),
  issue_date TEXT DEFAULT (date('now')),
  due_date TEXT,
  paid_date TEXT,
  sent_date TEXT,
  payment_method TEXT,
  payment_reference TEXT,
  notes TEXT,
  terms TEXT DEFAULT 'Payment due within 30 days of invoice date.',
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  document_type TEXT NOT NULL DEFAULT 'invoice' CHECK(document_type IN ('invoice','proposal','estimate')),
  warranty_terms TEXT DEFAULT '',
  payment_terms_text TEXT DEFAULT '',
  scope_of_work TEXT DEFAULT '',
  valid_until TEXT DEFAULT '',
  share_token TEXT DEFAULT '',
  attached_report_id INTEGER DEFAULT NULL,
  attached_report_url TEXT DEFAULT '',
  discount_type TEXT DEFAULT 'fixed' CHECK(discount_type IN ('fixed','percentage')),
  company_id INTEGER DEFAULT NULL,
  customer_address TEXT DEFAULT '',
  customer_phone TEXT DEFAULT '',
  square_payment_link_id TEXT DEFAULT '',
  square_payment_link_url TEXT DEFAULT '',
  square_payment_id TEXT DEFAULT '',
  viewed_at TEXT DEFAULT '',
  viewed_count INTEGER DEFAULT 0,
  certificate_sent_at TEXT,
  -- columns from migrations 0050_cc_missing through 0077
  share_url TEXT DEFAULT '',
  customer_signature TEXT DEFAULT '',
  signed_at TEXT DEFAULT '',
  printed_name TEXT,
  crm_customer_id INTEGER DEFAULT NULL,
  crm_customer_name TEXT DEFAULT '',
  crm_customer_email TEXT DEFAULT '',
  crm_customer_phone TEXT DEFAULT '',
  accent_color TEXT,
  my_cost REAL,
  show_report_sections TEXT,
  proposal_tier TEXT DEFAULT '',
  proposal_group_id TEXT DEFAULT '',
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

-- 2. Copy all existing data (only columns that exist in the old table)
INSERT INTO invoices_new (
  id, invoice_number, customer_id, order_id,
  subtotal, tax_rate, tax_amount, discount_amount, total, currency,
  status, issue_date, due_date, paid_date, sent_date,
  payment_method, payment_reference, notes, terms,
  created_by, created_at, updated_at,
  document_type, warranty_terms, payment_terms_text, scope_of_work,
  valid_until, share_token, attached_report_id, attached_report_url,
  discount_type, company_id, customer_address, customer_phone,
  square_payment_link_id, square_payment_link_url, square_payment_id,
  viewed_at, viewed_count, certificate_sent_at
)
SELECT
  id, invoice_number, customer_id, order_id,
  subtotal, tax_rate, tax_amount, discount_amount, total, currency,
  status, issue_date, due_date, paid_date, sent_date,
  payment_method, payment_reference, notes, terms,
  created_by, created_at, updated_at,
  document_type, warranty_terms, payment_terms_text, scope_of_work,
  valid_until, share_token, attached_report_id, attached_report_url,
  discount_type, company_id, customer_address, customer_phone,
  square_payment_link_id, square_payment_link_url, square_payment_id,
  viewed_at, viewed_count, certificate_sent_at
FROM invoices;

-- 3. Drop old table and rename
DROP TABLE invoices;
ALTER TABLE invoices_new RENAME TO invoices;

-- 4. Recreate indexes
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_doctype ON invoices(document_type);
CREATE INDEX IF NOT EXISTS idx_invoices_share ON invoices(share_token);

-- 5. Recreate trigger
CREATE TRIGGER cascade_customer_delete_invoices
AFTER DELETE ON customers
BEGIN
  DELETE FROM invoices WHERE customer_id = OLD.id;
END;
