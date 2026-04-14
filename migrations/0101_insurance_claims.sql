-- Insurance claims workflow (MVP) — attached to crm_customers
-- Supports ACV/RCV tracking, adjuster info, supplements, and line items
-- (e.g. parsed from Xactimate PDFs).

CREATE TABLE IF NOT EXISTS insurance_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  crm_customer_id INTEGER NOT NULL,
  claim_number TEXT,
  insurance_company TEXT,
  policy_number TEXT,
  date_of_loss TEXT,
  loss_type TEXT,                   -- hail, wind, fire, other
  adjuster_name TEXT,
  adjuster_email TEXT,
  adjuster_phone TEXT,
  inspection_date TEXT,
  deductible REAL DEFAULT 0,
  acv_amount REAL DEFAULT 0,        -- Actual Cash Value (initial payment)
  rcv_amount REAL DEFAULT 0,        -- Replacement Cost Value (total)
  depreciation REAL DEFAULT 0,
  recoverable_depreciation REAL DEFAULT 0,
  net_claim REAL DEFAULT 0,         -- RCV - deductible
  overhead_profit REAL DEFAULT 0,   -- O&P allowed
  status TEXT DEFAULT 'open',       -- open, inspection_scheduled, approved, supplement_pending, closed, denied
  xactimate_file_url TEXT,          -- R2 key or data URL for uploaded estimate
  xactimate_filename TEXT,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (crm_customer_id) REFERENCES crm_customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_insurance_claims_owner ON insurance_claims(owner_id);
CREATE INDEX IF NOT EXISTS idx_insurance_claims_customer ON insurance_claims(crm_customer_id);
CREATE INDEX IF NOT EXISTS idx_insurance_claims_status ON insurance_claims(status);

-- Line items on the original estimate (manual entry or parsed Xactimate)
CREATE TABLE IF NOT EXISTS claim_line_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id INTEGER NOT NULL,
  category TEXT,                    -- e.g. "Roofing", "Gutters", "Siding"
  description TEXT NOT NULL,
  quantity REAL DEFAULT 1,
  unit TEXT,                        -- SQ, LF, EA
  unit_price REAL DEFAULT 0,
  rcv REAL DEFAULT 0,
  acv REAL DEFAULT 0,
  depreciation REAL DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (claim_id) REFERENCES insurance_claims(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_claim_line_items_claim ON claim_line_items(claim_id);

-- Supplement requests (additions to original claim)
CREATE TABLE IF NOT EXISTS claim_supplements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id INTEGER NOT NULL,
  supplement_number INTEGER DEFAULT 1,
  reason TEXT,                      -- why this supplement is needed
  description TEXT,
  requested_amount REAL DEFAULT 0,
  approved_amount REAL DEFAULT 0,
  status TEXT DEFAULT 'draft',      -- draft, submitted, approved, denied, partially_approved
  submitted_date TEXT,
  response_date TEXT,
  line_items_json TEXT,             -- array of {description, quantity, unit, unit_price, amount}
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (claim_id) REFERENCES insurance_claims(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_claim_supplements_claim ON claim_supplements(claim_id);
