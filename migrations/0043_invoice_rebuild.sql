-- Migration 0043: Invoice module rebuild
-- Adds line item templates, discount, report linking, payment link, reminder tracking

CREATE TABLE IF NOT EXISTS crm_line_item_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  unit_price REAL NOT NULL DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT (datetime('now')),
  updated_at DATETIME DEFAULT (datetime('now'))
);

ALTER TABLE crm_invoices ADD COLUMN discount_amount REAL DEFAULT 0;
ALTER TABLE crm_invoices ADD COLUMN discount_type TEXT DEFAULT 'flat';
ALTER TABLE crm_invoices ADD COLUMN linked_report_id INTEGER DEFAULT NULL;
ALTER TABLE crm_invoices ADD COLUMN payment_link_url TEXT DEFAULT NULL;
ALTER TABLE crm_invoices ADD COLUMN payment_link_id TEXT DEFAULT NULL;
ALTER TABLE crm_invoices ADD COLUMN last_reminder_sent_at DATETIME DEFAULT NULL;
