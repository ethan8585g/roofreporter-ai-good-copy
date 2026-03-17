-- ============================================================
-- Customer Cold Call Center — Per-customer prospect lists,
-- AI outbound calling, call logs, leads & appointments
-- ============================================================

-- Prospect lists (customers upload CSV / LinkedIn scrapes)
CREATE TABLE IF NOT EXISTS cust_cc_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  source TEXT DEFAULT 'manual',
  total_contacts INTEGER DEFAULT 0,
  called_count INTEGER DEFAULT 0,
  leads_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at DATETIME DEFAULT (datetime('now')),
  updated_at DATETIME DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cust_cc_lists_customer ON cust_cc_lists(customer_id);

-- Individual prospects within lists
CREATE TABLE IF NOT EXISTS cust_cc_prospects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  list_id INTEGER,
  company_name TEXT DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL,
  email TEXT DEFAULT '',
  website TEXT DEFAULT '',
  linkedin_url TEXT DEFAULT '',
  city TEXT DEFAULT '',
  province_state TEXT DEFAULT '',
  country TEXT DEFAULT 'CA',
  job_title TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  -- Call tracking
  call_status TEXT DEFAULT 'pending',
  call_attempts INTEGER DEFAULT 0,
  last_called_at DATETIME,
  next_call_at DATETIME,
  -- Outcome
  outcome TEXT DEFAULT '',
  is_lead INTEGER DEFAULT 0,
  lead_quality TEXT DEFAULT '',
  appointment_booked INTEGER DEFAULT 0,
  appointment_date TEXT DEFAULT '',
  appointment_notes TEXT DEFAULT '',
  do_not_call INTEGER DEFAULT 0,
  -- AI call data
  last_call_summary TEXT DEFAULT '',
  last_call_transcript TEXT DEFAULT '',
  last_call_duration INTEGER DEFAULT 0,
  last_call_sentiment TEXT DEFAULT '',
  last_call_highlights TEXT DEFAULT '',
  -- Meta
  priority INTEGER DEFAULT 5,
  created_at DATETIME DEFAULT (datetime('now')),
  updated_at DATETIME DEFAULT (datetime('now')),
  FOREIGN KEY (list_id) REFERENCES cust_cc_lists(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_cust_cc_prospects_customer ON cust_cc_prospects(customer_id);
CREATE INDEX IF NOT EXISTS idx_cust_cc_prospects_list ON cust_cc_prospects(list_id);
CREATE INDEX IF NOT EXISTS idx_cust_cc_prospects_status ON cust_cc_prospects(call_status);
CREATE INDEX IF NOT EXISTS idx_cust_cc_prospects_phone ON cust_cc_prospects(phone);

-- Call logs — every call attempt recorded
CREATE TABLE IF NOT EXISTS cust_cc_call_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  prospect_id INTEGER,
  list_id INTEGER,
  -- Call info
  phone_dialed TEXT NOT NULL DEFAULT '',
  contact_name TEXT DEFAULT '',
  company_name TEXT DEFAULT '',
  call_status TEXT DEFAULT 'initiated',
  call_outcome TEXT DEFAULT '',
  call_duration_seconds INTEGER DEFAULT 0,
  -- AI content
  call_summary TEXT DEFAULT '',
  call_transcript TEXT DEFAULT '',
  conversation_highlights TEXT DEFAULT '',
  sentiment TEXT DEFAULT '',
  follow_up_required INTEGER DEFAULT 0,
  follow_up_notes TEXT DEFAULT '',
  follow_up_date TEXT DEFAULT '',
  -- Lead info
  is_lead INTEGER DEFAULT 0,
  lead_quality TEXT DEFAULT '',
  -- Appointment
  appointment_booked INTEGER DEFAULT 0,
  appointment_date TEXT DEFAULT '',
  appointment_notes TEXT DEFAULT '',
  -- Tags & notes
  agent_notes TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  -- LiveKit
  livekit_room_id TEXT DEFAULT '',
  agent_voice TEXT DEFAULT 'alloy',
  agent_name TEXT DEFAULT 'AI Agent',
  -- Timestamps
  started_at DATETIME DEFAULT (datetime('now')),
  ended_at DATETIME,
  created_at DATETIME DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cust_cc_logs_customer ON cust_cc_call_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_cust_cc_logs_prospect ON cust_cc_call_logs(prospect_id);
CREATE INDEX IF NOT EXISTS idx_cust_cc_logs_status ON cust_cc_call_logs(call_status);
CREATE INDEX IF NOT EXISTS idx_cust_cc_logs_outcome ON cust_cc_call_logs(call_outcome);
CREATE INDEX IF NOT EXISTS idx_cust_cc_logs_started ON cust_cc_call_logs(started_at);

-- Customer cold call config (agent settings per customer)
CREATE TABLE IF NOT EXISTS cust_cc_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL UNIQUE,
  agent_name TEXT DEFAULT 'AI Sales Agent',
  agent_voice TEXT DEFAULT 'alloy',
  script_intro TEXT DEFAULT '',
  script_pitch TEXT DEFAULT '',
  script_objections TEXT DEFAULT '',
  script_closing TEXT DEFAULT '',
  business_name TEXT DEFAULT '',
  callback_number TEXT DEFAULT '',
  is_active INTEGER DEFAULT 0,
  total_calls INTEGER DEFAULT 0,
  total_leads INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT (datetime('now')),
  updated_at DATETIME DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cust_cc_config_customer ON cust_cc_config(customer_id);
