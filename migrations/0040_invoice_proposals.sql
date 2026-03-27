-- Migration 0040: Add document_type to invoices for Proposals / Estimates
-- Allows the invoicing table to serve invoices, proposals, and estimates
-- without requiring a separate table. Existing rows default to 'invoice'.

ALTER TABLE invoices ADD COLUMN document_type TEXT NOT NULL DEFAULT 'invoice'
  CHECK(document_type IN ('invoice', 'proposal', 'estimate'));

-- Optional: allow a proposal to reference a specific completed report by order_id
-- (order_id column already exists on the invoices table)

CREATE INDEX IF NOT EXISTS idx_invoices_doctype ON invoices(document_type);
