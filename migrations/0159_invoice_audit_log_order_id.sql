-- Extend invoice_audit_log to trace auto-invoice outcomes that never produce an invoice row
-- (e.g. skipped_not_enabled, skipped_no_recipient, report_timeout, quantity_zero).
-- For those cases the caller writes invoice_id = 0 (sentinel) and sets order_id.

ALTER TABLE invoice_audit_log ADD COLUMN order_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_invoice_audit_order_id ON invoice_audit_log(order_id);
CREATE INDEX IF NOT EXISTS idx_invoice_audit_action ON invoice_audit_log(action);

-- Persist homeowner contact on the order so the event-driven auto-invoice
-- trigger (fired when reports.status transitions to 'completed') can produce
-- a draft proposal with the right recipient. Previously these fields were
-- only held in a local variable inside the /use-credit handler.
ALTER TABLE orders ADD COLUMN invoice_customer_name TEXT;
ALTER TABLE orders ADD COLUMN invoice_customer_email TEXT;
ALTER TABLE orders ADD COLUMN invoice_customer_phone TEXT;
