-- Migration 0077: Add unit column to crm_invoice_items
ALTER TABLE crm_invoice_items ADD COLUMN unit TEXT NOT NULL DEFAULT 'each';
