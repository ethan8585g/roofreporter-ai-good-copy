-- Allow invoices/proposals to reference CRM contacts (homeowners) directly
-- Fixes "Customer not found" when saving a proposal with a CRM-created contact
ALTER TABLE invoices ADD COLUMN crm_customer_id INTEGER DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN crm_customer_name TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN crm_customer_email TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN crm_customer_phone TEXT DEFAULT '';
