-- ============================================================
-- Migration 0012: Roofer Secretary — AI Phone Answering Service
-- Powered by LiveKit.io
-- ============================================================

-- Secretary subscriptions — tracks $149/mo per customer
CREATE TABLE IF NOT EXISTS secretary_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, active, cancelled, past_due
  stripe_subscription_id TEXT,
  stripe_price_id TEXT,
  monthly_price_cents INTEGER NOT NULL DEFAULT 14900,
  current_period_start TEXT,
  current_period_end TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- Secretary configuration — how the phone should be answered
CREATE TABLE IF NOT EXISTS secretary_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL UNIQUE,
  business_phone TEXT NOT NULL,              -- phone number to answer
  greeting_script TEXT NOT NULL DEFAULT '',  -- how to answer the phone
  common_qa TEXT DEFAULT '',                 -- common Q&A pairs (JSON or free text)
  general_notes TEXT DEFAULT '',             -- up to 3000 char general notes
  is_active INTEGER NOT NULL DEFAULT 0,     -- is the service live
  livekit_agent_id TEXT,                     -- LiveKit agent/room identifier
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- Secretary directories — departments/routing (2-4 per customer)
CREATE TABLE IF NOT EXISTS secretary_directories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  config_id INTEGER NOT NULL,
  name TEXT NOT NULL,                        -- e.g. "Parts", "Sales", "Service"
  phone_or_action TEXT DEFAULT '',           -- transfer number or action
  special_notes TEXT DEFAULT '',             -- up to 3000 char notes per directory
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (config_id) REFERENCES secretary_config(id)
);

-- Secretary call logs — track all calls handled by the AI
CREATE TABLE IF NOT EXISTS secretary_call_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  caller_phone TEXT,
  caller_name TEXT,
  call_duration_seconds INTEGER DEFAULT 0,
  directory_routed TEXT,                     -- which directory was selected
  call_summary TEXT,                         -- AI-generated summary
  call_transcript TEXT,                      -- full transcript
  call_outcome TEXT DEFAULT 'answered',      -- answered, voicemail, transferred, missed
  livekit_room_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_secretary_subs_customer ON secretary_subscriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_secretary_subs_status ON secretary_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_secretary_config_customer ON secretary_config(customer_id);
CREATE INDEX IF NOT EXISTS idx_secretary_dirs_config ON secretary_directories(config_id);
CREATE INDEX IF NOT EXISTS idx_secretary_calls_customer ON secretary_call_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_secretary_calls_created ON secretary_call_logs(created_at);
