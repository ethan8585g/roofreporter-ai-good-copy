-- Add material delivery date to jobs for calendar organization
ALTER TABLE crm_jobs ADD COLUMN material_delivery_date TEXT;
