-- Add missing columns to crm_proposals that backend code references but were never created
ALTER TABLE crm_proposals ADD COLUMN share_token TEXT;
ALTER TABLE crm_proposals ADD COLUMN view_count INTEGER DEFAULT 0;
ALTER TABLE crm_proposals ADD COLUMN last_viewed_at TEXT;
ALTER TABLE crm_proposals ADD COLUMN sent_at TEXT;
ALTER TABLE crm_proposals ADD COLUMN accepted_at TEXT;
ALTER TABLE crm_proposals ADD COLUMN declined_at TEXT;
ALTER TABLE crm_proposals ADD COLUMN customer_signature TEXT;
ALTER TABLE crm_proposals ADD COLUMN printed_name TEXT;
ALTER TABLE crm_proposals ADD COLUMN signed_at TEXT;

-- Add printed_name column to invoices table (for e-signature legal name)
ALTER TABLE invoices ADD COLUMN printed_name TEXT;

-- Index for share token lookups
CREATE INDEX IF NOT EXISTS idx_crm_proposals_share_token ON crm_proposals(share_token);
