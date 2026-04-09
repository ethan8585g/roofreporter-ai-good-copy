-- ============================================================
-- Migration 0050: Enhanced Proposals & Invoices System
-- Adds proposal tiers, shareable links, Square payment links,
-- webhook logging, report attachments, item library
-- ============================================================

-- Enhanced fields on invoices table
ALTER TABLE invoices ADD COLUMN warranty_terms TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN payment_terms_text TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN scope_of_work TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN valid_until TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN share_token TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN attached_report_id INTEGER DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN attached_report_url TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN discount_type TEXT DEFAULT 'fixed' CHECK(discount_type IN ('fixed', 'percentage'));
ALTER TABLE invoices ADD COLUMN company_id INTEGER DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN customer_address TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN customer_phone TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN square_payment_link_id TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN square_payment_link_url TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN square_payment_id TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN viewed_at TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN viewed_count INTEGER DEFAULT 0;

-- Enhanced fields on invoice_items table
ALTER TABLE invoice_items ADD COLUMN unit TEXT DEFAULT 'each';
ALTER TABLE invoice_items ADD COLUMN is_taxable INTEGER DEFAULT 1;
ALTER TABLE invoice_items ADD COLUMN category TEXT DEFAULT '';
ALTER TABLE invoice_items ADD COLUMN item_library_id INTEGER DEFAULT NULL;

-- Item library for reusable line items
CREATE TABLE IF NOT EXISTS item_library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_customer_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT 'roofing',
  default_unit TEXT DEFAULT 'each',
  default_unit_price REAL DEFAULT 0,
  default_quantity REAL DEFAULT 1,
  is_taxable INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_item_library_owner ON item_library(owner_customer_id);

-- Square payment links tracking
CREATE TABLE IF NOT EXISTS square_payment_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  square_link_id TEXT NOT NULL,
  square_link_url TEXT NOT NULL,
  square_order_id TEXT DEFAULT '',
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'CAD',
  status TEXT DEFAULT 'active' CHECK(status IN ('active','completed','cancelled','expired')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT DEFAULT '',
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);

CREATE INDEX IF NOT EXISTS idx_square_links_invoice ON square_payment_links(invoice_id);
CREATE INDEX IF NOT EXISTS idx_square_links_id ON square_payment_links(square_link_id);

-- Webhook logs for Square payment events
CREATE TABLE IF NOT EXISTS webhook_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT DEFAULT 'square',
  event_type TEXT NOT NULL,
  event_id TEXT DEFAULT '',
  payload TEXT NOT NULL,
  invoice_id INTEGER DEFAULT NULL,
  processed INTEGER DEFAULT 0,
  error TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_event ON webhook_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_invoice ON webhook_logs(invoice_id);

-- Share token index
CREATE INDEX IF NOT EXISTS idx_invoices_share ON invoices(share_token);

-- Cold Call Centre missing tables
CREATE TABLE IF NOT EXISTS cc_cost_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_log_id INTEGER,
  cost_type TEXT NOT NULL CHECK(cost_type IN ('llm','tts','stt','telephony','total')),
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'CAD',
  provider TEXT DEFAULT '',
  details TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (call_log_id) REFERENCES cc_call_logs(id)
);

CREATE TABLE IF NOT EXISTS cc_script_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_id INTEGER NOT NULL,
  variant_name TEXT NOT NULL DEFAULT 'A',
  opening_line TEXT DEFAULT '',
  value_proposition TEXT DEFAULT '',
  objection_handling TEXT DEFAULT '',
  closing_line TEXT DEFAULT '',
  call_count INTEGER DEFAULT 0,
  success_rate REAL DEFAULT 0,
  avg_duration REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (persona_id) REFERENCES cc_agent_personas(id)
);

CREATE INDEX IF NOT EXISTS idx_cc_script_persona ON cc_script_variants(persona_id);
