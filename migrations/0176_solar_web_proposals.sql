-- Solar interactive web proposals — the homeowner-facing, share-token-gated
-- replacement for the static PDF flow. One row per proposal; snapshot of
-- pricing + layout + financing at send time so edits don't mutate sent copies.
CREATE TABLE IF NOT EXISTS solar_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,             -- owning company (customers.id)
  deal_id INTEGER,                           -- optional FK to solar_deals
  report_id INTEGER,                         -- optional FK to reports (for panel layout source)
  share_token TEXT NOT NULL,                 -- 32-hex public token (crypto.getRandomValues)
  parent_proposal_id INTEGER,                -- variant grouping (Sprint 2 / item 8)

  -- System snapshot (immutable once sent)
  system_kw REAL NOT NULL,
  panel_count INTEGER NOT NULL,
  annual_kwh REAL NOT NULL,
  panel_layout_json TEXT,           -- snapshot of reports.solar_panel_layout at send time
  equipment_json TEXT,              -- inverter, battery, panel model/wattage
  pricing_json TEXT,                -- gross, rebates, net, $/W breakdown
  financing_scenarios_json TEXT,    -- [{type:'cash'|'loan'|'lease'|'ppa', ...}]

  -- Utility / savings inputs
  utility_rate_per_kwh REAL,
  annual_consumption_kwh REAL,
  offset_pct REAL,                   -- annual_kwh / annual_consumption_kwh
  savings_25yr_cad REAL,

  -- Homeowner-facing metadata
  homeowner_name TEXT,
  homeowner_email TEXT,
  homeowner_phone TEXT,
  property_address TEXT,

  -- Interaction state
  status TEXT NOT NULL DEFAULT 'draft',     -- draft|sent|viewed|signed|rejected|expired|voided
  sent_at TEXT,
  first_viewed_at TEXT,
  last_viewed_at TEXT,
  view_count INTEGER DEFAULT 0,
  signed_at TEXT,
  signature_image_r2_key TEXT,
  signer_name TEXT,
  signer_ip TEXT,
  expires_at TEXT,

  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_solar_proposals_customer ON solar_proposals(customer_id);
CREATE INDEX IF NOT EXISTS idx_solar_proposals_deal ON solar_proposals(deal_id);
CREATE INDEX IF NOT EXISTS idx_solar_proposals_parent ON solar_proposals(parent_proposal_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_solar_proposals_token ON solar_proposals(share_token);

-- Append-only funnel analytics — every view, tab-click, sign attempt.
CREATE TABLE IF NOT EXISTS solar_proposal_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,          -- proposal_sent|proposal_viewed|financing_tab_clicked|signed|rejected|scroll_depth
  event_data_json TEXT,
  user_agent TEXT,
  ip TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_solar_proposal_events_proposal ON solar_proposal_events(proposal_id, created_at);
CREATE INDEX IF NOT EXISTS idx_solar_proposal_events_type ON solar_proposal_events(event_type, created_at);
