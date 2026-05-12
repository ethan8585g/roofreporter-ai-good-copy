-- ============================================================
-- Migration 0240: Seed the abandoned-checkout-recovery loop
--
-- Fires every 10 min from the cron-worker. 2-touch sequence
-- (+2h, +24h) targeting square_payments rows stuck in 'pending'.
-- Sender = support@roofmanager.ca per the customer-voice rule.
--
-- agent_configs seeds the cron gate (kept for symmetry with
-- signup_nurture / drips; cron-worker currently runs cart_recovery
-- unconditionally on each tick, but having the row here lets the
-- super admin toggle/configure it via the loop-tracker UI without
-- a code change).
--
-- loop_definitions registers the loop in the catalog so the
-- super-admin dashboard surfaces it with a proper name + schedule
-- + description. expected_period_seconds = 10 min × 60 = 600.
-- ============================================================

INSERT OR IGNORE INTO agent_configs (agent_type, enabled, config_json)
VALUES (
  'cart_recovery',
  1,
  '{
    "schedule": "every 10 min",
    "stages": ["2h", "24h"],
    "sender_email": "support@roofmanager.ca",
    "max_per_stage_per_tick": 50
  }'
);

INSERT OR IGNORE INTO loop_definitions
  (loop_id, name, category, source, schedule_cron, schedule_human,
   expected_period_seconds, owner, endpoint, description)
VALUES
  ('cart_recovery',
   'Abandoned checkout recovery (2h + 24h)',
   'monitor',
   'cf_cron',
   '*/10 * * * *',
   'Every 10 min',
   600,
   'cron_worker',
   'runAbandonedCheckoutRecovery',
   'Two-touch recovery for customers whose Square checkout sat in pending (hit Pay Now, never finished). +2h: "your roof report is one click away" with the resume CTA. +24h: "still want that roof report?" soft followup that invites a reply. Sender = support@roofmanager.ca. Dedup''d per square_payments.id via user_activity_log so each abandoned checkout gets at most one of each stage. Re-checks status at send time so a payment that flips paid/failed between query and send is skipped. Surface for /loop 10m /cart-recovery on-demand fires.');
