-- Migration: Add brand/company customization columns to customers table
-- These columns power the Certificate of Installation, reports, proposals,
-- and any white-label output sent to homeowners.
-- The branding API (PUT /api/customer/branding) already references these fields.

ALTER TABLE customers ADD COLUMN brand_business_name TEXT;
ALTER TABLE customers ADD COLUMN brand_logo_url TEXT;
ALTER TABLE customers ADD COLUMN brand_tagline TEXT;
ALTER TABLE customers ADD COLUMN brand_phone TEXT;
ALTER TABLE customers ADD COLUMN brand_email TEXT;
ALTER TABLE customers ADD COLUMN brand_website TEXT;
ALTER TABLE customers ADD COLUMN brand_address TEXT;
ALTER TABLE customers ADD COLUMN brand_license_number TEXT;
ALTER TABLE customers ADD COLUMN brand_insurance_info TEXT;
ALTER TABLE customers ADD COLUMN brand_primary_color TEXT;
ALTER TABLE customers ADD COLUMN brand_secondary_color TEXT;
