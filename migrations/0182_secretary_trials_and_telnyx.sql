-- ============================================================
-- Migration 0182: Roofer Secretary self-serve trials + Telnyx numbers
-- ============================================================
-- Adds trial period + Square Subscriptions tracking to secretary_subscriptions,
-- Telnyx provider support + customer-facing monthly cost to secretary_phone_pool,
-- and a billing event log so super admin can audit every lifecycle event.
-- ============================================================

-- Trial + Square Subscriptions columns on secretary_subscriptions.
-- status widens informally to: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'paused' | 'pending'
ALTER TABLE secretary_subscriptions ADD COLUMN trial_started_at TEXT;
ALTER TABLE secretary_subscriptions ADD COLUMN trial_ends_at TEXT;
ALTER TABLE secretary_subscriptions ADD COLUMN square_customer_id TEXT;
ALTER TABLE secretary_subscriptions ADD COLUMN square_subscription_id TEXT;
ALTER TABLE secretary_subscriptions ADD COLUMN square_card_id TEXT;
ALTER TABLE secretary_subscriptions ADD COLUMN card_brand TEXT;
ALTER TABLE secretary_subscriptions ADD COLUMN card_last4 TEXT;

-- Superadmin "comp" field (replaces the removed auto-activation path).
-- When set to a future date, customer gets Secretary for free until that date.
ALTER TABLE secretary_subscriptions ADD COLUMN comp_until TEXT;

-- Telnyx support on secretary_phone_pool (alongside existing twilio phone_sid).
ALTER TABLE secretary_phone_pool ADD COLUMN provider TEXT DEFAULT 'twilio';
ALTER TABLE secretary_phone_pool ADD COLUMN telnyx_phone_number_id TEXT;
ALTER TABLE secretary_phone_pool ADD COLUMN telnyx_connection_id TEXT;
ALTER TABLE secretary_phone_pool ADD COLUMN purchased_at TEXT;
ALTER TABLE secretary_phone_pool ADD COLUMN monthly_cost_cents_billed INTEGER DEFAULT 100;

-- Event log for super admin audit: every trial/subscription/phone lifecycle event.
CREATE TABLE IF NOT EXISTS secretary_billing_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  square_event_id TEXT,
  amount_cents INTEGER,
  metadata TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS idx_sbe_customer ON secretary_billing_events(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sbe_event_type ON secretary_billing_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sec_sub_status ON secretary_subscriptions(status, trial_ends_at);
CREATE INDEX IF NOT EXISTS idx_sec_pool_provider ON secretary_phone_pool(provider, status);
