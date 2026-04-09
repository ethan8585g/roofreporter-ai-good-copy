-- Add internal cost field to invoices (admin/sales only, not shown to customers)
ALTER TABLE invoices ADD COLUMN my_cost REAL;
