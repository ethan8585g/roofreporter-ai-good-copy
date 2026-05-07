-- Track when the contractor confirms a roof installation is complete
ALTER TABLE invoices ADD COLUMN installation_completed_at TEXT;
