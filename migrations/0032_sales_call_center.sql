-- ============================================================
-- Migration 0032: Sales Call Center — AI Outbound Dialer
-- RoofReporterAI sales outreach to roofing companies
-- Completely separate from Roofer Secretary product
-- ============================================================

-- Prospect companies to call
CREATE TABLE IF NOT EXISTS cc_prospects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT NOT NULL,
  contact_name TEXT DEFAULT '',
  phone TEXT NOT NULL,
  email TEXT DEFAULT '',
  website TEXT DEFAULT '',
  city TEXT DEFAULT '',
  province_state TEXT DEFAULT '',
  country TEXT DEFAULT 'CA',
  company_size TEXT DEFAULT '',           -- small, medium, large
  lead_source TEXT DEFAULT 'manual',      -- manual, scrape, import, referral
  status TEXT DEFAULT 'new',              -- new, queued, calling, contacted, interested, demo_scheduled, converted, not_interested, do_not_call, bad_number
  priority INTEGER DEFAULT 5,            -- 1=highest, 10=lowest
  tags TEXT DEFAULT '',                   -- comma-separated tags
  notes TEXT DEFAULT '',
  total_calls INTEGER DEFAULT 0,
  last_called_at TEXT,
  next_call_at TEXT,
  campaign_id INTEGER,
  assigned_agent_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Sales campaigns (group prospects, set scripts)
CREATE TABLE IF NOT EXISTS cc_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'draft',            -- draft, active, paused, completed, archived
  script_intro TEXT DEFAULT '',           -- Opening pitch
  script_value_prop TEXT DEFAULT '',      -- Value proposition
  script_objections TEXT DEFAULT '',      -- Objection handling
  script_closing TEXT DEFAULT '',         -- Closing/CTA
  target_region TEXT DEFAULT '',          -- e.g. "Alberta", "Ontario", "All Canada"
  target_company_size TEXT DEFAULT '',
  call_hours_start TEXT DEFAULT '09:00',  -- Local time to start calling
  call_hours_end TEXT DEFAULT '17:00',    -- Local time to stop calling
  timezone TEXT DEFAULT 'America/Edmonton',
  max_attempts INTEGER DEFAULT 3,        -- Max call attempts per prospect
  cooldown_hours INTEGER DEFAULT 24,     -- Hours between retry attempts
  total_prospects INTEGER DEFAULT 0,
  total_calls INTEGER DEFAULT 0,
  total_connects INTEGER DEFAULT 0,
  total_interested INTEGER DEFAULT 0,
  total_demos INTEGER DEFAULT 0,
  total_converted INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- AI call agents (each represents a virtual sales rep)
CREATE TABLE IF NOT EXISTS cc_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                     -- e.g. "Alex", "Jordan", "Morgan"
  voice_id TEXT DEFAULT 'alloy',          -- TTS voice: alloy, echo, fable, onyx, nova, shimmer
  persona TEXT DEFAULT '',                -- Agent personality description
  status TEXT DEFAULT 'idle',             -- idle, calling, paused, offline, error
  livekit_room_prefix TEXT DEFAULT 'sales-',
  total_calls INTEGER DEFAULT 0,
  total_connects INTEGER DEFAULT 0,
  total_interested INTEGER DEFAULT 0,
  avg_call_duration_sec REAL DEFAULT 0,
  success_rate REAL DEFAULT 0,
  current_prospect_id INTEGER,
  current_room_name TEXT DEFAULT '',
  last_active_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Call log for every outbound call attempt
CREATE TABLE IF NOT EXISTS cc_call_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prospect_id INTEGER NOT NULL,
  campaign_id INTEGER,
  agent_id INTEGER,
  agent_name TEXT DEFAULT '',
  phone_dialed TEXT NOT NULL,
  livekit_room_id TEXT DEFAULT '',
  call_status TEXT DEFAULT 'initiated',   -- initiated, ringing, connected, voicemail, no_answer, busy, failed, completed
  call_outcome TEXT DEFAULT '',            -- interested, demo_scheduled, callback_requested, not_interested, wrong_number, voicemail_left, gatekeeper_block, hung_up
  call_duration_seconds INTEGER DEFAULT 0,
  talk_time_seconds INTEGER DEFAULT 0,
  ring_time_seconds INTEGER DEFAULT 0,
  caller_sentiment TEXT DEFAULT '',        -- positive, neutral, negative, hostile
  call_summary TEXT DEFAULT '',
  call_transcript TEXT DEFAULT '',
  objections_raised TEXT DEFAULT '',       -- JSON array of objection types
  follow_up_action TEXT DEFAULT '',        -- e.g. "send_email", "schedule_demo", "call_back_tuesday"
  follow_up_date TEXT,
  recording_url TEXT DEFAULT '',
  sip_call_id TEXT DEFAULT '',
  started_at TEXT DEFAULT (datetime('now')),
  ended_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Daily/hourly performance metrics
CREATE TABLE IF NOT EXISTS cc_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric_date TEXT NOT NULL,              -- YYYY-MM-DD
  metric_hour INTEGER DEFAULT -1,         -- 0-23, -1 = daily aggregate
  campaign_id INTEGER,
  agent_id INTEGER,
  calls_made INTEGER DEFAULT 0,
  calls_connected INTEGER DEFAULT 0,
  calls_voicemail INTEGER DEFAULT 0,
  calls_no_answer INTEGER DEFAULT 0,
  avg_duration_sec REAL DEFAULT 0,
  total_talk_time_sec INTEGER DEFAULT 0,
  interested_count INTEGER DEFAULT 0,
  demos_scheduled INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_cc_prospects_status ON cc_prospects(status);
CREATE INDEX IF NOT EXISTS idx_cc_prospects_campaign ON cc_prospects(campaign_id);
CREATE INDEX IF NOT EXISTS idx_cc_prospects_phone ON cc_prospects(phone);
CREATE INDEX IF NOT EXISTS idx_cc_prospects_next_call ON cc_prospects(next_call_at);
CREATE INDEX IF NOT EXISTS idx_cc_call_logs_prospect ON cc_call_logs(prospect_id);
CREATE INDEX IF NOT EXISTS idx_cc_call_logs_campaign ON cc_call_logs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_cc_call_logs_agent ON cc_call_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_cc_call_logs_started ON cc_call_logs(started_at);
CREATE INDEX IF NOT EXISTS idx_cc_metrics_date ON cc_metrics(metric_date);
CREATE INDEX IF NOT EXISTS idx_cc_agents_status ON cc_agents(status);
