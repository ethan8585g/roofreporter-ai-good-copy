-- Lead magnet conversion system: extend leads table for admin workflow + attribution
-- status allowed values (enforced in app layer): 'new' | 'contacted' | 'report_sent' | 'converted' | 'closed_lost'
-- priority allowed values (enforced in app layer): 'low' | 'normal' | 'high' | 'urgent'
ALTER TABLE leads ADD COLUMN report_sent_at TEXT;
ALTER TABLE leads ADD COLUMN report_sent_by INTEGER;
ALTER TABLE leads ADD COLUMN admin_notes TEXT;
ALTER TABLE leads ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE leads ADD COLUMN lead_type TEXT;
ALTER TABLE leads ADD COLUMN utm_medium TEXT;
ALTER TABLE leads ADD COLUMN utm_campaign TEXT;
ALTER TABLE leads ADD COLUMN utm_content TEXT;
ALTER TABLE leads ADD COLUMN utm_term TEXT;
ALTER TABLE leads ADD COLUMN referrer TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_report_sent_at ON leads(report_sent_at);
CREATE INDEX IF NOT EXISTS idx_leads_priority ON leads(priority);
CREATE INDEX IF NOT EXISTS idx_leads_lead_type ON leads(lead_type);
