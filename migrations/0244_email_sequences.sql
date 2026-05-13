-- ============================================================
-- Email Sequences — Manual enrollment + super-admin-defined chains
--
-- Two new tables:
--
-- sequence_definitions: catalog of every email chain the platform
--   knows about. Built-in chains (signup_nurture, cart_recovery,
--   drip_campaigns, lead_agent) are seeded with kind='builtin' and
--   their step bodies are produced by existing service functions.
--   Custom chains (kind='custom') are super-admin-authored — steps_json
--   holds the templates inline (subject + body_html_template with
--   {{variable}} placeholders).
--
-- sequence_enrollments: one row per "this recipient is in this chain".
--   Created by the super-admin enrollment modal. The cron-worker's
--   processDueEnrollments() picks rows where next_send_at <= now and
--   fires the current step. Auto-fired chains (signup_nurture etc.)
--   continue using their existing dedup paths (user_activity_log)
--   alongside this — manual enrollment is a parallel surface, not a
--   replacement.
-- ============================================================

CREATE TABLE IF NOT EXISTS sequence_definitions (
  sequence_type TEXT PRIMARY KEY,
                                              -- 'signup_nurture' | 'cart_recovery' | ... | 'custom_*'
  name TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'custom',
                                              -- 'builtin' | 'custom'
  steps_json TEXT NOT NULL DEFAULT '[]',
                                              -- JSON array. Builtin format:
                                              --   [{ step_index, label, delay_seconds, handler: 'signup_nurture_1h' }, ...]
                                              -- Custom format:
                                              --   [{ step_index, label, delay_seconds, subject_template, body_html_template, from_addr, track }, ...]
  default_category TEXT NOT NULL DEFAULT 'customer',
                                              -- inserted into email_sends.category for every step
  default_from TEXT,
                                              -- e.g. 'sales@roofmanager.ca'; overridable per step
  enabled INTEGER NOT NULL DEFAULT 1,
  archived_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
  created_by_admin_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sequence_definitions_kind ON sequence_definitions(kind, enabled);

-- Seed the 4 built-in chains. steps_json uses handler keys that the
-- sequence-engine resolves to existing service functions.
INSERT OR IGNORE INTO sequence_definitions (sequence_type, name, description, kind, steps_json, default_category, default_from) VALUES
('signup_nurture',
 'Signup Nurture',
 'New-customer nudge sequence: +1h check-in, +24h reminder, +3d goodbye.',
 'builtin',
 '[{"step_index":0,"label":"+1h check-in","delay_seconds":0,"handler":"signup_nurture_1h"},{"step_index":1,"label":"+24h reminder","delay_seconds":82800,"handler":"signup_nurture_24h"},{"step_index":2,"label":"+3d final","delay_seconds":172800,"handler":"signup_nurture_3d"}]',
 'customer',
 'sales@roofmanager.ca'),
('cart_recovery',
 'Abandoned Checkout Recovery',
 '2-touch sequence for customers with pending Square checkouts.',
 'builtin',
 '[{"step_index":0,"label":"+2h one-click","delay_seconds":0,"handler":"cart_recovery_2h"},{"step_index":1,"label":"+24h reminder","delay_seconds":79200,"handler":"cart_recovery_24h"}]',
 'cart',
 'support@roofmanager.ca'),
('drip_stuck_signup_60d',
 'Stuck Signup (60d)',
 'One-touch nudge for customers who signed up 60+ days ago and never placed an order.',
 'builtin',
 '[{"step_index":0,"label":"Stuck-signup nudge","delay_seconds":0,"handler":"drip_stuck_signup_60d"}]',
 'customer',
 'sales@roofmanager.ca'),
('drip_at_risk_churn_30d',
 'At-Risk Churn (30d silent)',
 'Re-engagement for paying customers gone silent 30+ days.',
 'builtin',
 '[{"step_index":0,"label":"Churn re-engagement","delay_seconds":0,"handler":"drip_at_risk_churn_30d"}]',
 'customer',
 'sales@roofmanager.ca'),
('drip_trial_ends_3d',
 'Trial Ends (3d warning)',
 'Reminder to customers whose trial ends in 1-3 days and have no orders.',
 'builtin',
 '[{"step_index":0,"label":"Trial-ends warning","delay_seconds":0,"handler":"drip_trial_ends_3d"}]',
 'customer',
 'sales@roofmanager.ca');

-- ============================================================
-- sequence_enrollments — one row per recipient × sequence
-- ============================================================
CREATE TABLE IF NOT EXISTS sequence_enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sequence_type TEXT NOT NULL,
                                              -- foreign-key-ish to sequence_definitions.sequence_type
  customer_id INTEGER,
  recipient_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
                                              -- 'active' | 'paused' | 'completed' | 'cancelled' | 'failed'
  current_step INTEGER NOT NULL DEFAULT 0,
                                              -- 0-indexed pointer into steps_json
  enrolled_at DATETIME NOT NULL DEFAULT (datetime('now')),
  next_send_at DATETIME,
                                              -- null when paused/completed/cancelled
  last_step_sent_at DATETIME,
  last_email_send_id INTEGER,
                                              -- last email_sends.id this enrollment produced
  completed_at DATETIME,
  cancelled_at DATETIME,
  failed_at DATETIME,
  enrolled_by_admin_id INTEGER,
  notes TEXT,
  metadata_json TEXT,
                                              -- arbitrary per-enrollment context (order_id, payment_id, etc.)
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_seq_enrollments_due ON sequence_enrollments(status, next_send_at);
CREATE INDEX IF NOT EXISTS idx_seq_enrollments_type ON sequence_enrollments(sequence_type, status);
CREATE INDEX IF NOT EXISTS idx_seq_enrollments_recipient ON sequence_enrollments(recipient_email);
CREATE INDEX IF NOT EXISTS idx_seq_enrollments_customer ON sequence_enrollments(customer_id);
