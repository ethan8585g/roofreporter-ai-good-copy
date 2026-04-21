-- Add landing_page so we can attribute leads to the specific page/blog they first landed on
ALTER TABLE leads ADD COLUMN landing_page TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_landing_page ON leads(landing_page);
CREATE INDEX IF NOT EXISTS idx_leads_utm_source ON leads(utm_source);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);

-- Mirror on asset_report_leads (blog lead-magnet form target)
ALTER TABLE asset_report_leads ADD COLUMN landing_page TEXT;
ALTER TABLE asset_report_leads ADD COLUMN referrer TEXT;
ALTER TABLE asset_report_leads ADD COLUMN utm_source TEXT;
ALTER TABLE asset_report_leads ADD COLUMN utm_medium TEXT;
ALTER TABLE asset_report_leads ADD COLUMN utm_campaign TEXT;
CREATE INDEX IF NOT EXISTS idx_asset_leads_landing ON asset_report_leads(landing_page);
CREATE INDEX IF NOT EXISTS idx_asset_leads_created ON asset_report_leads(created_at);
