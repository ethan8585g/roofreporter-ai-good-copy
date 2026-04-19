-- Invoicing Automation settings on the customers table
ALTER TABLE customers ADD COLUMN auto_invoice_enabled INTEGER DEFAULT 0;
ALTER TABLE customers ADD COLUMN invoice_pricing_mode TEXT DEFAULT 'per_square';
ALTER TABLE customers ADD COLUMN invoice_price_per_square REAL DEFAULT 350;
ALTER TABLE customers ADD COLUMN invoice_price_per_bundle REAL DEFAULT 125;
