-- Proposal/Estimate Module Enhancement
-- Fixes missing tables + adds supplier order system

-- Fix missing tables that code references but don't exist
CREATE TABLE IF NOT EXISTS crm_proposal_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  quantity REAL DEFAULT 1,
  unit TEXT DEFAULT 'each',
  unit_price REAL DEFAULT 0,
  amount REAL DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (proposal_id) REFERENCES crm_proposals(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_crm_proposal_items_proposal ON crm_proposal_items(proposal_id);

CREATE TABLE IF NOT EXISTS proposal_view_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id INTEGER NOT NULL,
  viewed_at TEXT DEFAULT (datetime('now')),
  ip_address TEXT,
  user_agent TEXT,
  referrer TEXT,
  FOREIGN KEY (proposal_id) REFERENCES crm_proposals(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_proposal_view_log_proposal ON proposal_view_log(proposal_id);

-- Enhance supplier_directory with branch/account/rep fields
ALTER TABLE supplier_directory ADD COLUMN branch_name TEXT;
ALTER TABLE supplier_directory ADD COLUMN account_number TEXT;
ALTER TABLE supplier_directory ADD COLUMN rep_name TEXT;
ALTER TABLE supplier_directory ADD COLUMN rep_phone TEXT;
ALTER TABLE supplier_directory ADD COLUMN rep_email TEXT;

-- Supplier material orders (outbound purchase orders to supplier)
CREATE TABLE IF NOT EXISTS supplier_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  proposal_id INTEGER,
  supplier_id INTEGER,
  report_id INTEGER,
  material_estimate_id INTEGER,
  order_number TEXT,
  job_address TEXT,
  customer_name TEXT,
  items_json TEXT,
  notes TEXT,
  status TEXT DEFAULT 'draft',
  total_amount REAL DEFAULT 0,
  sent_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES customers(id),
  FOREIGN KEY (proposal_id) REFERENCES crm_proposals(id),
  FOREIGN KEY (supplier_id) REFERENCES supplier_directory(id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_orders_owner ON supplier_orders(owner_id);
CREATE INDEX IF NOT EXISTS idx_supplier_orders_proposal ON supplier_orders(proposal_id);

-- Link material estimate to proposal
ALTER TABLE crm_proposals ADD COLUMN material_estimate_id INTEGER;
ALTER TABLE crm_proposals ADD COLUMN supplier_order_id INTEGER;
