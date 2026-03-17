-- Call Center Phone Lines — Multi-line support with dispatch rules
-- Supports two dispatch types:
--   1) outbound_prompt_leadlist: Admin triggers outbound calls from dashboard / outreach lead lists
--   2) inbound_forwarding: Answers inbound calls only when toggled on + user has call forwarding active

-- Add dispatch configuration columns to cc_phone_config
ALTER TABLE cc_phone_config ADD COLUMN dispatch_type TEXT DEFAULT 'outbound_prompt_leadlist';
ALTER TABLE cc_phone_config ADD COLUMN dispatch_description TEXT DEFAULT '';
ALTER TABLE cc_phone_config ADD COLUMN assigned_email TEXT DEFAULT '';
ALTER TABLE cc_phone_config ADD COLUMN owner_name TEXT DEFAULT '';
ALTER TABLE cc_phone_config ADD COLUMN inbound_enabled INTEGER DEFAULT 0;
ALTER TABLE cc_phone_config ADD COLUMN outbound_enabled INTEGER DEFAULT 1;
ALTER TABLE cc_phone_config ADD COLUMN call_forwarding_active INTEGER DEFAULT 0;
ALTER TABLE cc_phone_config ADD COLUMN call_forwarding_number TEXT DEFAULT '';
ALTER TABLE cc_phone_config ADD COLUMN ai_greeting TEXT DEFAULT '';
ALTER TABLE cc_phone_config ADD COLUMN ai_persona TEXT DEFAULT '';
ALTER TABLE cc_phone_config ADD COLUMN max_ring_seconds INTEGER DEFAULT 20;
ALTER TABLE cc_phone_config ADD COLUMN voicemail_enabled INTEGER DEFAULT 1;

-- Seed the two configured phone lines
INSERT OR IGNORE INTO cc_phone_config (
  label, business_phone, assigned_phone_number, connection_status,
  dispatch_type, dispatch_description, assigned_email, owner_name,
  inbound_enabled, outbound_enabled, call_forwarding_active,
  phone_verified, is_active
) VALUES (
  'Super Admin Call Center',
  '+12402122251', '+12402122251', 'connected',
  'outbound_prompt_leadlist',
  'Outbound dialer — triggered upon prompt and from outreach lead lists in the admin call center dashboard',
  'ethangourley17@gmail.com', 'Super Admin',
  0, 1, 0,
  1, 1
);

INSERT OR IGNORE INTO cc_phone_config (
  label, business_phone, assigned_phone_number, connection_status,
  dispatch_type, dispatch_description, assigned_email, owner_name,
  inbound_enabled, outbound_enabled, call_forwarding_active,
  call_forwarding_number,
  phone_verified, is_active
) VALUES (
  'Reuse Canada Inbound Line',
  '+14849649758', '+14849649758', 'connected',
  'inbound_forwarding',
  'Inbound call answering only — dispatches when toggled on and user sets call forwarding on their mobile device',
  'dev@reusecanada.ca', 'Reuse Canada Dev',
  1, 0, 0,
  '',
  1, 0
);

CREATE INDEX IF NOT EXISTS idx_cc_phone_dispatch ON cc_phone_config(dispatch_type);
CREATE INDEX IF NOT EXISTS idx_cc_phone_active ON cc_phone_config(is_active);
