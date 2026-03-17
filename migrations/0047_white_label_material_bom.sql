-- ============================================================
-- RoofReporterAI — Migration 0047: White-Label Branding + Material BOM
-- Adds white-label contractor branding and material estimates storage
-- ============================================================

-- White-label branding configuration per customer (contractor)
CREATE TABLE IF NOT EXISTS white_label_branding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  -- Branding
  company_name TEXT,
  logo_url TEXT,
  accent_color TEXT DEFAULT '#00897B',
  secondary_color TEXT DEFAULT '#00695C',
  font_family TEXT DEFAULT 'Inter',
  -- Report Header
  tagline TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  license_number TEXT,
  -- Footer
  footer_text TEXT,
  disclaimer_text TEXT,
  -- Feature flags
  show_roofreporter_branding INTEGER DEFAULT 1,
  show_pricing INTEGER DEFAULT 1,
  show_material_bom INTEGER DEFAULT 1,
  -- Metadata
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wl_customer ON white_label_branding(customer_id);

-- Material estimates storage (linked to reports)
CREATE TABLE IF NOT EXISTS material_estimates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  order_id INTEGER,
  -- Input measurements
  net_area_sqft REAL,
  gross_area_sqft REAL,
  waste_factor_pct REAL DEFAULT 15,
  total_eave_lf REAL,
  total_ridge_lf REAL,
  total_hip_lf REAL,
  total_valley_lf REAL,
  total_rake_lf REAL,
  pitch_rise REAL,
  complexity TEXT DEFAULT 'medium',
  -- Output totals
  shingle_bundles INTEGER,
  shingle_squares REAL,
  ridge_cap_bundles INTEGER,
  ice_water_rolls INTEGER,
  underlayment_rolls INTEGER,
  drip_edge_pcs INTEGER,
  starter_strip_pcs INTEGER,
  nail_boxes INTEGER,
  caulk_tubes INTEGER,
  pipe_boots INTEGER,
  -- Cost
  materials_subtotal_cad REAL,
  tax_estimate_cad REAL,
  materials_total_cad REAL,
  -- Full BOM JSON
  bom_json TEXT,
  -- Export formats (cached)
  xactimate_xml TEXT,
  acculynx_csv TEXT,
  jobnimbus_json TEXT,
  -- Metadata
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES reports(id)
);
CREATE INDEX IF NOT EXISTS idx_matl_report ON material_estimates(report_id);
CREATE INDEX IF NOT EXISTS idx_matl_order ON material_estimates(order_id);
