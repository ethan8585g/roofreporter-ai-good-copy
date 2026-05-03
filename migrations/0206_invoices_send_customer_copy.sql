-- Default ON: existing proposals fall back to the customer copy (no measurements).
-- Contractor must explicitly opt-in to sending the full contractor report.
ALTER TABLE invoices ADD COLUMN send_customer_copy INTEGER DEFAULT 1;
