-- Certificate designs: allows roofers to save multiple certificate templates
-- Each design stores the full visual configuration as JSON
CREATE TABLE IF NOT EXISTS certificate_designs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT 'Standard Certificate',
  template_style TEXT NOT NULL DEFAULT 'classic',  -- classic | modern | bold | minimal
  primary_color TEXT DEFAULT '#1a5c38',
  secondary_color TEXT DEFAULT '#f5b041',
  font_family TEXT DEFAULT 'EB Garamond',
  license_number TEXT,
  custom_message TEXT,
  watermark_enabled INTEGER DEFAULT 0,
  logo_alignment TEXT DEFAULT 'left',  -- left | center | right
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Enhanced automation settings on the customers table
ALTER TABLE customers ADD COLUMN cert_trigger_type TEXT DEFAULT 'proposal_signed';  -- proposal_signed | job_installed
ALTER TABLE customers ADD COLUMN cert_delay_days INTEGER DEFAULT 0;
ALTER TABLE customers ADD COLUMN cert_require_approval INTEGER DEFAULT 0;
ALTER TABLE customers ADD COLUMN cert_default_design_id INTEGER;

-- Certificate send log for trigger history
CREATE TABLE IF NOT EXISTS certificate_send_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  design_id INTEGER,
  proposal_id INTEGER,
  job_id INTEGER,
  trigger_type TEXT,  -- manual | auto_proposal_signed | auto_job_installed
  recipient_email TEXT,
  recipient_name TEXT,
  property_address TEXT,
  status TEXT DEFAULT 'sent',  -- sent | failed | pending_approval
  sent_at TEXT DEFAULT (datetime('now')),
  error_message TEXT
);
