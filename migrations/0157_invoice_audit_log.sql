-- Invoice audit trail for financial status changes
-- Tracks who changed what on invoices/proposals for compliance

CREATE TABLE IF NOT EXISTS invoice_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  action TEXT NOT NULL,           -- status_change, payment_received, amount_changed, created, deleted
  old_value TEXT DEFAULT '',
  new_value TEXT DEFAULT '',
  changed_by TEXT DEFAULT '',     -- email or 'square_webhook' or 'system'
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invoice_audit_invoice_id ON invoice_audit_log(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_audit_created_at ON invoice_audit_log(created_at);
