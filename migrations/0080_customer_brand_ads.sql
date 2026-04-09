-- Add brand_ads_json column to customers for storing ad settings
ALTER TABLE customers ADD COLUMN brand_ads_json TEXT;
