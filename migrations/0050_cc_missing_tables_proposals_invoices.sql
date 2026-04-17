-- ============================================================
-- Migration 0050: Cold Call Centre Missing Tables + extras
-- Creates CC tables that weren't in earlier migrations.
-- NOTE: invoices/invoice_items ALTER TABLEs and square_payment_links
-- are handled by 0050_enhanced_proposals_invoices.sql (runs first
-- alphabetically), so they are NOT duplicated here.
-- ============================================================

-- Agent Personas (AI voice personas for cold calls)
CREATE TABLE IF NOT EXISTS cc_agent_personas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  llm_provider TEXT DEFAULT 'openai',
  llm_model TEXT DEFAULT 'gpt-4o-mini',
  llm_temperature REAL DEFAULT 0.7,
  system_prompt TEXT DEFAULT '',
  tts_provider TEXT DEFAULT 'openai',
  tts_voice_id TEXT DEFAULT 'alloy',
  tts_speed REAL DEFAULT 1.0,
  stt_provider TEXT DEFAULT 'deepgram',
  endpointing_ms INTEGER DEFAULT 500,
  interruption_sensitivity REAL DEFAULT 0.5,
  pause_before_reply_ms INTEGER DEFAULT 400,
  script_opening TEXT DEFAULT '',
  script_value_prop TEXT DEFAULT '',
  script_objections TEXT DEFAULT '',
  script_closing TEXT DEFAULT '',
  script_voicemail TEXT DEFAULT '',
  knowledge_docs TEXT DEFAULT '',
  dynamic_variables TEXT DEFAULT '{}',
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Phone config (SIP trunks mapped to personas)
CREATE TABLE IF NOT EXISTS cc_phone_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_number TEXT NOT NULL,
  label TEXT DEFAULT '',
  sip_trunk_id TEXT DEFAULT '',
  sip_host TEXT DEFAULT '',
  sip_username TEXT DEFAULT '',
  sip_password TEXT DEFAULT '',
  agent_persona_id INTEGER,
  status TEXT DEFAULT 'active',
  direction TEXT DEFAULT 'outbound',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (agent_persona_id) REFERENCES cc_agent_personas(id)
);

-- Transcript flags (flagged phrases for script improvement)
-- Table may already exist from earlier migration without the status column.
-- CREATE TABLE IF NOT EXISTS won't modify an existing table, so we only
-- create if missing.
CREATE TABLE IF NOT EXISTS cc_transcript_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER,
  call_type TEXT DEFAULT 'cold_call',
  flagged_text TEXT NOT NULL,
  flag_reason TEXT DEFAULT '',
  suggested_fix TEXT DEFAULT '',
  flagged_by TEXT DEFAULT 'admin',
  status TEXT DEFAULT 'open',
  applied_to_prompt INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (call_id) REFERENCES cc_call_logs(id)
);

-- Script A/B variants for testing
CREATE TABLE IF NOT EXISTS cc_script_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_id INTEGER NOT NULL,
  variant_name TEXT NOT NULL,
  script_opening TEXT DEFAULT '',
  script_value_prop TEXT DEFAULT '',
  script_objections TEXT DEFAULT '',
  script_closing TEXT DEFAULT '',
  calls_used INTEGER DEFAULT 0,
  connects INTEGER DEFAULT 0,
  interested INTEGER DEFAULT 0,
  demos INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (persona_id) REFERENCES cc_agent_personas(id)
);

-- Cost tracking per call
CREATE TABLE IF NOT EXISTS cc_cost_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_log_id INTEGER,
  campaign_id INTEGER,
  agent_id INTEGER,
  total_cost_cents INTEGER DEFAULT 0,
  llm_cost_cents INTEGER DEFAULT 0,
  tts_cost_cents INTEGER DEFAULT 0,
  stt_cost_cents INTEGER DEFAULT 0,
  telephony_cost_cents INTEGER DEFAULT 0,
  duration_seconds INTEGER DEFAULT 0,
  tokens_used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for CC tables (IF NOT EXISTS is safe)
CREATE INDEX IF NOT EXISTS idx_cc_campaigns_persona ON cc_campaigns(agent_persona_id);
CREATE INDEX IF NOT EXISTS idx_cc_phone_config_persona ON cc_phone_config(agent_persona_id);
CREATE INDEX IF NOT EXISTS idx_cc_script_variants_persona ON cc_script_variants(persona_id);
CREATE INDEX IF NOT EXISTS idx_cc_cost_tracking_date ON cc_cost_tracking(created_at);

-- Extra columns that 0050_enhanced does NOT add (share_url, signatures)
-- These use ALTER TABLE which fails on duplicate, so only include columns
-- that are NOT in 0050_enhanced.
ALTER TABLE invoices ADD COLUMN share_url TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN customer_signature TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN signed_at TEXT DEFAULT '';

-- Item library for reusable roofing line items
CREATE TABLE IF NOT EXISTS item_library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_customer_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT 'materials',
  default_unit TEXT DEFAULT 'each',
  default_unit_price REAL DEFAULT 0,
  default_quantity REAL DEFAULT 1,
  is_taxable INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_item_library_owner ON item_library(owner_customer_id);
