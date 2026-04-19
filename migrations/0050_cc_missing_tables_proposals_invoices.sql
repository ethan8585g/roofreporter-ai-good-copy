-- ============================================================
-- Migration 0050: Cold Call Centre Missing Tables + Enhanced Proposals/Invoices
-- 1. CC tables: cc_agent_personas, cc_phone_config, cc_transcript_flags,
--    cc_script_variants, cc_cost_tracking
-- 2. Enhanced proposals: shareable links, tiers, report attachments
-- 3. Enhanced invoices: Square payment links, webhook logs
-- 4. Item library for roofing line items
-- ============================================================

-- ═══════════════════════════════════════════════════════════
-- COLD CALL CENTRE — Missing Tables
-- ═══════════════════════════════════════════════════════════

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

-- cc_campaigns columns already added in 0049 migration

-- Add missing column to cc_transcript_flags (0049 created it without status)
ALTER TABLE cc_transcript_flags ADD COLUMN status TEXT DEFAULT 'open';

-- Indexes for CC tables
CREATE INDEX IF NOT EXISTS idx_cc_campaigns_persona ON cc_campaigns(agent_persona_id);
CREATE INDEX IF NOT EXISTS idx_cc_phone_config_persona ON cc_phone_config(agent_persona_id);
CREATE INDEX IF NOT EXISTS idx_cc_script_variants_persona ON cc_script_variants(persona_id);
CREATE INDEX IF NOT EXISTS idx_cc_cost_tracking_date ON cc_cost_tracking(created_at);
CREATE INDEX IF NOT EXISTS idx_cc_transcript_flags_status ON cc_transcript_flags(status);

-- ═══════════════════════════════════════════════════════════
-- ENHANCED PROPOSALS — Shareable Links, Tiers, Attachments
-- ═══════════════════════════════════════════════════════════

-- Add share token to invoices/proposals for public viewing
ALTER TABLE invoices ADD COLUMN share_token TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN share_url TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN proposal_tier TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN proposal_group_id TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN scope_of_work TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN warranty_terms TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN payment_terms_text TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN valid_until TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN attached_report_id INTEGER DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN attached_report_url TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN customer_signature TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN signed_at TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN viewed_at TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN viewed_count INTEGER DEFAULT 0;
ALTER TABLE invoices ADD COLUMN discount_type TEXT DEFAULT 'fixed';
ALTER TABLE invoices ADD COLUMN company_id INTEGER DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN customer_address TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN customer_phone TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN square_payment_link_id TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN square_payment_link_url TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN square_payment_id TEXT DEFAULT '';

-- Add unit column to invoice_items
ALTER TABLE invoice_items ADD COLUMN unit TEXT DEFAULT 'each';
ALTER TABLE invoice_items ADD COLUMN is_taxable INTEGER DEFAULT 1;
ALTER TABLE invoice_items ADD COLUMN category TEXT DEFAULT '';
ALTER TABLE invoice_items ADD COLUMN item_library_id INTEGER DEFAULT NULL;

-- Square payment link tracking
CREATE TABLE IF NOT EXISTS square_payment_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  payment_link_id TEXT NOT NULL,
  payment_link_url TEXT NOT NULL,
  order_id TEXT DEFAULT '',
  amount_cents INTEGER NOT NULL,
  currency TEXT DEFAULT 'CAD',
  status TEXT DEFAULT 'created',
  checkout_id TEXT DEFAULT '',
  transaction_id TEXT DEFAULT '',
  receipt_url TEXT DEFAULT '',
  paid_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);

-- Webhook logs for Square payment callbacks
CREATE TABLE IF NOT EXISTS webhook_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT DEFAULT 'square',
  event_type TEXT NOT NULL,
  event_id TEXT DEFAULT '',
  payload TEXT NOT NULL,
  invoice_id INTEGER,
  processed INTEGER DEFAULT 0,
  error_message TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

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

CREATE INDEX IF NOT EXISTS idx_invoices_share_token ON invoices(share_token);
CREATE INDEX IF NOT EXISTS idx_square_links_invoice ON square_payment_links(invoice_id);
CREATE INDEX IF NOT EXISTS idx_square_links_status ON square_payment_links(status);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_source ON webhook_logs(source, event_type);
CREATE INDEX IF NOT EXISTS idx_item_library_owner ON item_library(owner_customer_id);
