-- Add send/share/payment features to crm_invoices (mirror proposals)
ALTER TABLE crm_invoices ADD COLUMN title TEXT;
ALTER TABLE crm_invoices ADD COLUMN property_address TEXT;
ALTER TABLE crm_invoices ADD COLUMN share_token TEXT;
ALTER TABLE crm_invoices ADD COLUMN view_count INTEGER DEFAULT 0;
ALTER TABLE crm_invoices ADD COLUMN square_payment_link_url TEXT;
ALTER TABLE crm_invoices ADD COLUMN square_payment_link_id TEXT;
ALTER TABLE crm_invoices ADD COLUMN sent_at TEXT;
