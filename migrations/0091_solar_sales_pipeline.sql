-- Solar-specific sales pipeline for solar companies.
-- Separate from revenue_pipeline (roofing) so the roofing module is untouched.
CREATE TABLE IF NOT EXISTS solar_deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,            -- owner company (customers.id)
  order_id INTEGER,                         -- optional FK to orders (report)

  -- Prospect info
  homeowner_name TEXT,
  homeowner_email TEXT,
  homeowner_phone TEXT,
  property_address TEXT,
  property_city TEXT,
  property_province TEXT,

  -- Lead source: door_knock | referral | online | event | cold_call | self_gen | other
  lead_source TEXT DEFAULT 'other',
  lead_source_detail TEXT,

  -- Stage: new_lead | appointment_set | proposal_sent | signed | install_scheduled | installed | paid | lost
  stage TEXT NOT NULL DEFAULT 'new_lead',
  lost_reason TEXT,

  -- Sales team (soft refs — free-text names for now; upgrade to team_members FK later)
  setter_id INTEGER,
  setter_name TEXT,
  closer_id INTEGER,
  closer_name TEXT,
  installer_id INTEGER,
  installer_name TEXT,

  -- Commission splits (percent of contract value, 0–100)
  setter_commission_pct REAL DEFAULT 0,
  closer_commission_pct REAL DEFAULT 0,
  installer_commission_pct REAL DEFAULT 0,
  override_commission_pct REAL DEFAULT 0,

  -- Deal economics
  system_kw REAL,
  contract_value_cad REAL DEFAULT 0,
  notes TEXT,

  appointment_at DATETIME,
  proposal_sent_at DATETIME,
  signed_at DATETIME,
  install_scheduled_at DATETIME,
  installed_at DATETIME,
  paid_at DATETIME,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_solar_deals_customer ON solar_deals(customer_id, stage);
CREATE INDEX IF NOT EXISTS idx_solar_deals_order ON solar_deals(order_id);
CREATE INDEX IF NOT EXISTS idx_solar_deals_setter ON solar_deals(customer_id, setter_id);
CREATE INDEX IF NOT EXISTS idx_solar_deals_closer ON solar_deals(customer_id, closer_id);
