-- ============================================================
-- Website Builder — AI-Powered Contractor Sites
-- ============================================================

-- Sites: one per contractor
CREATE TABLE IF NOT EXISTS wb_sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  subdomain TEXT UNIQUE NOT NULL,
  business_name TEXT NOT NULL,
  business_phone TEXT,
  business_email TEXT,
  business_address TEXT,
  city TEXT,
  province TEXT,
  logo_url TEXT,
  primary_color TEXT DEFAULT '#1E3A5F',
  secondary_color TEXT DEFAULT '#2563EB',
  accent_color TEXT DEFAULT '#e85c2b',
  font_family TEXT DEFAULT 'Inter',
  tagline TEXT,
  services_json TEXT DEFAULT '[]',
  service_areas_json TEXT DEFAULT '[]',
  certifications_json TEXT DEFAULT '[]',
  years_in_business INTEGER,
  google_reviews_json TEXT DEFAULT '[]',
  brand_vibe TEXT DEFAULT 'professional',
  owner_name TEXT,
  company_story TEXT,
  status TEXT DEFAULT 'draft',
  theme TEXT DEFAULT 'clean-pro',
  custom_domain TEXT,
  meta_title TEXT,
  meta_description TEXT,
  intake_data_json TEXT,
  published_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES customers(id)
);
CREATE INDEX IF NOT EXISTS idx_wb_sites_owner ON wb_sites(owner_id);

-- Pages: 5 per site for MVP (home, services, about, service-areas, contact)
CREATE TABLE IF NOT EXISTS wb_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL,
  slug TEXT NOT NULL,
  page_type TEXT NOT NULL,
  title TEXT NOT NULL,
  meta_title TEXT,
  meta_description TEXT,
  sections_json TEXT DEFAULT '[]',
  html_snapshot TEXT,
  sort_order INTEGER DEFAULT 0,
  is_published INTEGER DEFAULT 0,
  city_target TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (site_id) REFERENCES wb_sites(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_wb_pages_site ON wb_pages(site_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wb_pages_site_slug ON wb_pages(site_id, slug);

-- Leads captured from published sites
CREATE TABLE IF NOT EXISTS wb_site_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL,
  owner_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  message TEXT,
  service_type TEXT,
  source TEXT DEFAULT 'contact_form',
  source_page TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  status TEXT DEFAULT 'new',
  crm_customer_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (site_id) REFERENCES wb_sites(id),
  FOREIGN KEY (owner_id) REFERENCES customers(id)
);
CREATE INDEX IF NOT EXISTS idx_wb_leads_owner ON wb_site_leads(owner_id);
CREATE INDEX IF NOT EXISTS idx_wb_leads_site ON wb_site_leads(site_id);
CREATE INDEX IF NOT EXISTS idx_wb_leads_created ON wb_site_leads(created_at DESC);

-- Content drafts (AI generation history)
CREATE TABLE IF NOT EXISTS wb_content_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL,
  version INTEGER DEFAULT 1,
  full_content_json TEXT,
  generation_model TEXT DEFAULT 'gemini-2.0-flash',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (site_id) REFERENCES wb_sites(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_wb_drafts_site ON wb_content_drafts(site_id);
