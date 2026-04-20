-- Add address and utm_source columns to leads table for lead funnel improvements
ALTER TABLE leads ADD COLUMN address TEXT;
ALTER TABLE leads ADD COLUMN utm_source TEXT;
