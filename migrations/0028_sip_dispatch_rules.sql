-- ============================================================
-- Migration 0028: SIP Dispatch Rules Management Table
-- Tracks LiveKit SIP dispatch rules for agent deployment
-- Fields: dispatch_rule_id, name, rule_type, trunk_ids,
--         room_prefix, room_name, pin, metadata, status, created_at
-- ============================================================

CREATE TABLE IF NOT EXISTS sip_dispatch_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dispatch_rule_id TEXT NOT NULL UNIQUE,    -- LiveKit dispatch rule ID (e.g. SDA_xxxxx)
  name TEXT DEFAULT '',                     -- Rule name (e.g. 'roofreporterai-dispatch')
  rule_type TEXT DEFAULT 'individual',      -- 'individual', 'direct', 'callee'
  trunk_ids TEXT DEFAULT '[]',             -- JSON array of SIP trunk IDs for inbound routing
  room_prefix TEXT DEFAULT 'secretary-',   -- Destination room prefix (individual/callee)
  room_name TEXT DEFAULT '',               -- Fixed room name (direct type)
  pin TEXT DEFAULT '',                     -- Optional PIN for access control
  metadata TEXT DEFAULT '',                -- JSON — agent config, customer_id, etc.
  status TEXT DEFAULT 'active',            -- active, disabled, deleted
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sip_dispatch_rules_status ON sip_dispatch_rules(status);
CREATE INDEX IF NOT EXISTS idx_sip_dispatch_rules_type ON sip_dispatch_rules(rule_type);
