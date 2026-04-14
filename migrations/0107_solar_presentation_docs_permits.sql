-- Solar sales extensions:
--   1. solar_presentation_slides — pre-set presentation slides shown to homeowners
--   2. solar_proposal_documents  — contracts/agreements/install paperwork attached to a deal
--   3. solar_permits             — permitting management per deal
-- All rows are scoped to a customer_id (owning solar company).

CREATE TABLE IF NOT EXISTS solar_presentation_slides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  slide_order INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  body TEXT,
  image_url TEXT,
  video_url TEXT,
  cta_label TEXT,
  cta_url TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sps_customer ON solar_presentation_slides(customer_id, slide_order);

CREATE TABLE IF NOT EXISTS solar_proposal_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  deal_id INTEGER,
  order_id INTEGER,
  doc_type TEXT NOT NULL DEFAULT 'contract', -- contract | agreement | install_paperwork | disclosure | other
  title TEXT NOT NULL,
  file_url TEXT,
  notes TEXT,
  is_template INTEGER NOT NULL DEFAULT 0, -- 1 = reusable company template, 0 = attached to a specific deal
  signed INTEGER NOT NULL DEFAULT 0,
  signed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_spd_customer ON solar_proposal_documents(customer_id);
CREATE INDEX IF NOT EXISTS idx_spd_deal ON solar_proposal_documents(deal_id);
CREATE INDEX IF NOT EXISTS idx_spd_template ON solar_proposal_documents(customer_id, is_template);

CREATE TABLE IF NOT EXISTS solar_permits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  deal_id INTEGER,
  homeowner_name TEXT,
  property_address TEXT,
  jurisdiction TEXT,                -- city / county / AHJ
  permit_type TEXT,                 -- building | electrical | pv | interconnection | other
  permit_number TEXT,
  status TEXT NOT NULL DEFAULT 'not_started',
    -- not_started | preparing | submitted | under_review | approved | rejected | inspection_scheduled | passed_inspection | closed
  fee_cad REAL DEFAULT 0,
  submitted_at TEXT,
  approved_at TEXT,
  inspection_at TEXT,
  inspector_name TEXT,
  inspector_notes TEXT,
  rejection_reason TEXT,
  document_url TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sper_customer ON solar_permits(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_sper_deal ON solar_permits(deal_id);
