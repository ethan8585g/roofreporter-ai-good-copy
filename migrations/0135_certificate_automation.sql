-- Migration: Certificate of New Roof Installation automation
-- Adds per-owner auto-send toggle and per-proposal certificate delivery tracking

-- Auto-send certificate when proposal is signed (per roofing company/owner)
ALTER TABLE customers ADD COLUMN auto_send_certificate INTEGER DEFAULT 0;

-- Track when a certificate was sent for proposals in crm_proposals table
ALTER TABLE crm_proposals ADD COLUMN certificate_sent_at TEXT;

-- Track when a certificate was sent for proposals in invoices table (used by proposal builder)
ALTER TABLE invoices ADD COLUMN certificate_sent_at TEXT;
