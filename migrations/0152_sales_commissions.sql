-- Sales & Commissions Tracking
-- Commission rules define rates per team member/role
-- Commission entries are the ledger of earned commissions

CREATE TABLE IF NOT EXISTS commission_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER NOT NULL,
    team_member_id INTEGER NOT NULL,
    member_name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'sales_rep' CHECK(role IN ('sales_rep', 'closer', 'setter', 'installer', 'manager')),
    commission_type TEXT NOT NULL DEFAULT 'percentage' CHECK(commission_type IN ('percentage', 'flat')),
    commission_rate REAL NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_commission_rules_owner ON commission_rules(owner_id);
CREATE INDEX idx_commission_rules_member ON commission_rules(team_member_id);

CREATE TABLE IF NOT EXISTS commission_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER NOT NULL,
    team_member_id INTEGER NOT NULL,
    member_name TEXT NOT NULL DEFAULT '',
    rule_id INTEGER,
    source_type TEXT NOT NULL CHECK(source_type IN ('proposal', 'invoice', 'job')),
    source_id INTEGER NOT NULL,
    source_label TEXT NOT NULL DEFAULT '',
    customer_name TEXT NOT NULL DEFAULT '',
    deal_value REAL NOT NULL DEFAULT 0,
    commission_amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'paid', 'voided')),
    paid_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_commission_entries_owner ON commission_entries(owner_id);
CREATE INDEX idx_commission_entries_member ON commission_entries(team_member_id);
CREATE INDEX idx_commission_entries_status ON commission_entries(status);
CREATE INDEX idx_commission_entries_source ON commission_entries(source_type, source_id);

-- Add sales rep attribution to proposals and jobs
ALTER TABLE crm_proposals ADD COLUMN sales_rep_id INTEGER;
ALTER TABLE crm_proposals ADD COLUMN sales_rep_name TEXT;
ALTER TABLE crm_jobs ADD COLUMN sales_rep_id INTEGER;
ALTER TABLE crm_jobs ADD COLUMN sales_rep_name TEXT;
