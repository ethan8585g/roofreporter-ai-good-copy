-- Allow orders (and their resulting reports) to be attached to a CRM customer
-- when placed from the customer order flow. Attachment is optional.
ALTER TABLE orders ADD COLUMN crm_customer_id INTEGER DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_crm_customer ON orders(crm_customer_id);
