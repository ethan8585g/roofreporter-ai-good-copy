-- ============================================================
-- 0049: Enhanced Onboarding, Cold Call Agent Config & Tracking
-- Adds: team members during onboarding, voice agent config
-- (speed, pause, persona), membership welcome packages,
-- cold call SIP-to-agent mapping, LLM config, knowledge base,
-- campaign scheduling, transcript flagging, unified tracking
-- ============================================================

-- ── TEAM MEMBERS (created during customer onboarding) ──────
-- Note: customer_team table may already exist — IF NOT EXISTS
CREATE TABLE IF NOT EXISTS customer_team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL DEFAULT '',
  role TEXT DEFAULT 'member',  -- member, manager, admin
  phone TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1,
  permissions TEXT DEFAULT '{}',  -- JSON: { can_view_calls: true, can_edit_config: false, ... }
  created_at DATETIME DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
CREATE INDEX IF NOT EXISTS idx_team_members_customer ON customer_team_members(customer_id);
CREATE INDEX IF NOT EXISTS idx_team_members_email ON customer_team_members(email);

-- ── VOICE AGENT CONFIG (speed, pause, persona settings) ────
-- Extends secretary_config with voice tuning parameters
ALTER TABLE secretary_config ADD COLUMN voice_speed REAL DEFAULT 1.0;       -- 0.5 to 2.0 (1.0 = normal)
ALTER TABLE secretary_config ADD COLUMN voice_pause_ms INTEGER DEFAULT 800;  -- pause between AI replies in ms
ALTER TABLE secretary_config ADD COLUMN voice_provider TEXT DEFAULT 'openai'; -- openai, elevenlabs, cartesia, deepgram
ALTER TABLE secretary_config ADD COLUMN voice_model_id TEXT DEFAULT '';       -- specific voice model/ID
ALTER TABLE secretary_config ADD COLUMN voice_stability REAL DEFAULT 0.5;    -- 0-1 for ElevenLabs
ALTER TABLE secretary_config ADD COLUMN voice_similarity REAL DEFAULT 0.75;  -- 0-1 for ElevenLabs
ALTER TABLE secretary_config ADD COLUMN stt_provider TEXT DEFAULT 'deepgram'; -- deepgram, whisper, google
ALTER TABLE secretary_config ADD COLUMN endpointing_ms INTEGER DEFAULT 300;  -- silence before AI responds
ALTER TABLE secretary_config ADD COLUMN interruption_threshold REAL DEFAULT 0.5; -- 0-1 sensitivity
ALTER TABLE secretary_config ADD COLUMN llm_provider TEXT DEFAULT 'openai';  -- openai, anthropic, google
ALTER TABLE secretary_config ADD COLUMN llm_model TEXT DEFAULT 'gpt-4o-mini'; -- model name
ALTER TABLE secretary_config ADD COLUMN llm_temperature REAL DEFAULT 0.7;
ALTER TABLE secretary_config ADD COLUMN llm_max_tokens INTEGER DEFAULT 200;

-- ── MEMBERSHIP TIERS & WELCOME PACKAGES ────────────────────
CREATE TABLE IF NOT EXISTS membership_tiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                     -- 'Starter', 'Pro', 'Enterprise'
  description TEXT DEFAULT '',
  monthly_price_cents INTEGER DEFAULT 0,
  included_reports INTEGER DEFAULT 0,     -- roof reports per month
  included_minutes INTEGER DEFAULT 0,     -- secretary minutes per month
  secretary_included INTEGER DEFAULT 0,   -- 1 = secretary AI included
  cold_call_included INTEGER DEFAULT 0,   -- 1 = cold call module included
  features TEXT DEFAULT '[]',             -- JSON array of feature flags
  welcome_credits INTEGER DEFAULT 0,      -- bonus credits on signup
  welcome_discount_pct INTEGER DEFAULT 0, -- % off first month
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT (datetime('now'))
);

-- Track which tier each customer is on
ALTER TABLE customers ADD COLUMN membership_tier_id INTEGER DEFAULT NULL;
ALTER TABLE customers ADD COLUMN membership_started_at DATETIME DEFAULT NULL;
ALTER TABLE customers ADD COLUMN total_minutes_used REAL DEFAULT 0;
ALTER TABLE customers ADD COLUMN monthly_minutes_limit INTEGER DEFAULT 500;

-- ── COLD CALL AGENT PERSONAS ───────────────────────────────
CREATE TABLE IF NOT EXISTS cc_agent_personas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                       -- 'Aggressive Closer', 'Consultative', etc.
  description TEXT DEFAULT '',
  -- LLM Config
  llm_provider TEXT DEFAULT 'openai',       -- openai, anthropic, google
  llm_model TEXT DEFAULT 'gpt-4o',
  llm_temperature REAL DEFAULT 0.7,
  system_prompt TEXT DEFAULT '',             -- Core persona system prompt
  -- Voice Config
  tts_provider TEXT DEFAULT 'openai',       -- openai, elevenlabs, cartesia, deepgram
  tts_voice_id TEXT DEFAULT 'alloy',
  tts_speed REAL DEFAULT 1.0,
  -- STT Config
  stt_provider TEXT DEFAULT 'deepgram',
  -- Latency / Interruption
  endpointing_ms INTEGER DEFAULT 300,       -- silence threshold
  interruption_sensitivity REAL DEFAULT 0.5,
  pause_before_reply_ms INTEGER DEFAULT 500,
  -- Prompt Sections
  script_opening TEXT DEFAULT '',
  script_value_prop TEXT DEFAULT '',
  script_objections TEXT DEFAULT '',         -- JSON array of {objection, response}
  script_closing TEXT DEFAULT '',
  script_voicemail TEXT DEFAULT '',
  -- Knowledge Base
  knowledge_docs TEXT DEFAULT '',            -- uploaded docs / feature lists
  dynamic_variables TEXT DEFAULT '{}',       -- JSON: {Lead_Name: "{{contact_name}}", ...}
  -- Meta
  is_active INTEGER DEFAULT 1,
  total_calls_made INTEGER DEFAULT 0,
  avg_call_duration REAL DEFAULT 0,
  conversion_rate REAL DEFAULT 0,
  created_at DATETIME DEFAULT (datetime('now')),
  updated_at DATETIME DEFAULT (datetime('now'))
);

-- ── SIP TRUNK → AGENT MAPPING ──────────────────────────────
-- Links specific phone numbers to specific agent personas
ALTER TABLE cc_phone_config ADD COLUMN agent_persona_id INTEGER DEFAULT NULL;
ALTER TABLE cc_phone_config ADD COLUMN agent_type TEXT DEFAULT 'cold_call'; -- cold_call, answering, secretary
ALTER TABLE cc_phone_config ADD COLUMN agent_system_prompt TEXT DEFAULT '';
ALTER TABLE cc_phone_config ADD COLUMN agent_voice_id TEXT DEFAULT 'alloy';
ALTER TABLE cc_phone_config ADD COLUMN agent_speed REAL DEFAULT 1.0;
ALTER TABLE cc_phone_config ADD COLUMN agent_pause_ms INTEGER DEFAULT 500;
ALTER TABLE cc_phone_config ADD COLUMN linked_customer_id INTEGER DEFAULT NULL;

-- ── CAMPAIGN SCHEDULING ────────────────────────────────────
ALTER TABLE cc_campaigns ADD COLUMN agent_persona_id INTEGER DEFAULT NULL;
ALTER TABLE cc_campaigns ADD COLUMN operating_days TEXT DEFAULT 'mon,tue,wed,thu,fri';
ALTER TABLE cc_campaigns ADD COLUMN max_concurrent_calls INTEGER DEFAULT 1;
ALTER TABLE cc_campaigns ADD COLUMN auto_dial INTEGER DEFAULT 0;
ALTER TABLE cc_campaigns ADD COLUMN dnc_list TEXT DEFAULT '';  -- comma-separated phones

-- ── TRANSCRIPT FLAGGING & A/B TESTING ──────────────────────
CREATE TABLE IF NOT EXISTS cc_transcript_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL,
  call_type TEXT DEFAULT 'cold_call',      -- cold_call, secretary
  flagged_text TEXT NOT NULL,
  flag_reason TEXT DEFAULT '',              -- 'failed_close', 'bad_objection', 'confusion', 'excellent'
  suggested_fix TEXT DEFAULT '',
  applied_to_prompt INTEGER DEFAULT 0,     -- 1 = fix was applied
  flagged_by TEXT DEFAULT 'admin',
  created_at DATETIME DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_transcript_flags_call ON cc_transcript_flags(call_id);

CREATE TABLE IF NOT EXISTS cc_script_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_id INTEGER NOT NULL,
  variant_name TEXT NOT NULL,              -- 'A', 'B', 'Aggressive', 'Soft'
  script_opening TEXT DEFAULT '',
  script_value_prop TEXT DEFAULT '',
  script_objections TEXT DEFAULT '',
  script_closing TEXT DEFAULT '',
  -- Performance
  total_calls INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  avg_duration REAL DEFAULT 0,
  avg_sentiment REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_script_variants_persona ON cc_script_variants(persona_id);

-- ── COST TRACKING ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cc_cost_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER,
  call_type TEXT DEFAULT 'cold_call',
  campaign_id INTEGER,
  customer_id INTEGER,
  -- Cost breakdown
  llm_tokens_in INTEGER DEFAULT 0,
  llm_tokens_out INTEGER DEFAULT 0,
  llm_cost_cents REAL DEFAULT 0,
  tts_seconds REAL DEFAULT 0,
  tts_cost_cents REAL DEFAULT 0,
  stt_seconds REAL DEFAULT 0,
  stt_cost_cents REAL DEFAULT 0,
  telephony_seconds REAL DEFAULT 0,
  telephony_cost_cents REAL DEFAULT 0,
  total_cost_cents REAL DEFAULT 0,
  created_at DATETIME DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cost_tracking_campaign ON cc_cost_tracking(campaign_id);
CREATE INDEX IF NOT EXISTS idx_cost_tracking_customer ON cc_cost_tracking(customer_id);

-- ── SEED DEFAULT MEMBERSHIP TIERS ──────────────────────────
INSERT OR IGNORE INTO membership_tiers (id, name, description, monthly_price_cents, included_reports, included_minutes, secretary_included, cold_call_included, welcome_credits, welcome_discount_pct, sort_order) VALUES
(1, 'Starter', 'AI Secretary answering service — perfect for solo roofers', 24900, 5, 500, 1, 0, 3, 10, 1),
(2, 'Pro', 'Full AI Secretary + CRM + priority support', 49900, 20, 2000, 1, 0, 10, 15, 2),
(3, 'Enterprise', 'Everything — Secretary, Cold Call, unlimited reports, white-label', 99900, 999, 10000, 1, 1, 50, 25, 3);
