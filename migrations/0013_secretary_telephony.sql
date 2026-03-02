-- ============================================================
-- Migration 0013: Roofer Secretary — Telephony Integration
-- Connect existing business phone numbers via call forwarding
-- or SIP trunk to LiveKit AI voice agents
-- ============================================================

-- Phone number pool — Twilio numbers purchased and managed by RoofReporterAI
-- These are the "AI answering line" numbers that roofers forward their existing number TO
CREATE TABLE IF NOT EXISTS secretary_phone_pool (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_number TEXT NOT NULL UNIQUE,          -- E.164 format: +17805551234
  phone_sid TEXT,                              -- Twilio Phone Number SID (PN...)
  region TEXT NOT NULL DEFAULT 'AB',           -- Province/region for local presence
  status TEXT NOT NULL DEFAULT 'available',    -- available, assigned, reserved, retired
  assigned_to_customer_id INTEGER,            -- NULL if available
  assigned_at TEXT,
  sip_trunk_id TEXT,                          -- LiveKit inbound trunk ID for this number
  dispatch_rule_id TEXT,                      -- LiveKit dispatch rule ID
  monthly_cost_cents INTEGER DEFAULT 200,     -- Twilio number cost (~$2/mo)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (assigned_to_customer_id) REFERENCES customers(id)
);

-- Add telephony fields to secretary_config
-- forwarding_method: how the roofer connects their existing number
--   'call_forwarding'  = roofer dials *72 on their carrier to forward to our Twilio number
--   'sip_trunk'        = roofer's VoIP system connects directly via SIP trunk
--   'livekit_number'   = roofer buys a new LiveKit/Twilio number (doesn't want to keep existing)
ALTER TABLE secretary_config ADD COLUMN forwarding_method TEXT DEFAULT 'call_forwarding';

-- The Twilio/LiveKit inbound number assigned to this customer
ALTER TABLE secretary_config ADD COLUMN assigned_phone_number TEXT DEFAULT '';

-- The customer's existing business phone (already have business_phone column)
-- Connection status tracking
ALTER TABLE secretary_config ADD COLUMN connection_status TEXT DEFAULT 'not_connected';
-- not_connected, pending_forwarding, connected, failed, disconnected

-- Carrier-specific forwarding info (for display/instructions)
ALTER TABLE secretary_config ADD COLUMN carrier_name TEXT DEFAULT '';
-- Rogers, Telus, Bell, Shaw, Koodo, Fido, etc.

-- LiveKit telephony IDs
ALTER TABLE secretary_config ADD COLUMN livekit_inbound_trunk_id TEXT DEFAULT '';
ALTER TABLE secretary_config ADD COLUMN livekit_dispatch_rule_id TEXT DEFAULT '';
ALTER TABLE secretary_config ADD COLUMN livekit_sip_uri TEXT DEFAULT '';

-- SIP trunk credentials (for 'sip_trunk' method)
ALTER TABLE secretary_config ADD COLUMN sip_username TEXT DEFAULT '';
ALTER TABLE secretary_config ADD COLUMN sip_password TEXT DEFAULT '';

-- Twilio SIP trunk ID (for the Twilio side)
ALTER TABLE secretary_config ADD COLUMN twilio_trunk_sid TEXT DEFAULT '';

-- Connection test results
ALTER TABLE secretary_config ADD COLUMN last_test_at TEXT;
ALTER TABLE secretary_config ADD COLUMN last_test_result TEXT DEFAULT '';  -- success, failed, timeout
ALTER TABLE secretary_config ADD COLUMN last_test_details TEXT DEFAULT '';

-- Agent voice/persona settings
ALTER TABLE secretary_config ADD COLUMN agent_voice TEXT DEFAULT 'alloy';  -- OpenAI TTS voice
ALTER TABLE secretary_config ADD COLUMN agent_name TEXT DEFAULT 'Sarah';   -- AI secretary name
ALTER TABLE secretary_config ADD COLUMN agent_language TEXT DEFAULT 'en';

-- Indexes for phone pool
CREATE INDEX IF NOT EXISTS idx_phone_pool_status ON secretary_phone_pool(status);
CREATE INDEX IF NOT EXISTS idx_phone_pool_assigned ON secretary_phone_pool(assigned_to_customer_id);
CREATE INDEX IF NOT EXISTS idx_phone_pool_region ON secretary_phone_pool(region);

-- Add indexes for new config fields
CREATE INDEX IF NOT EXISTS idx_secretary_config_connection ON secretary_config(connection_status);
CREATE INDEX IF NOT EXISTS idx_secretary_config_forwarding ON secretary_config(forwarding_method);
