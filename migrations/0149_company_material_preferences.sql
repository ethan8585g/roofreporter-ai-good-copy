-- Company-level material preferences (shingle type, waste factor, tax rate, etc.)
-- Stored as JSON blob so new preferences can be added without schema changes
ALTER TABLE master_companies ADD COLUMN material_preferences TEXT DEFAULT NULL;
