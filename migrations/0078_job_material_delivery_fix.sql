-- Re-apply material delivery date column (0069 was a duplicate sequence number and may not have been applied)
ALTER TABLE crm_jobs ADD COLUMN IF NOT EXISTS material_delivery_date TEXT;
