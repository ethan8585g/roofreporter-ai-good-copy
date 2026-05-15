-- ============================================================
-- Add stage-2 (+24h) tracking to the abandoned-signup recovery
-- sequence. Stage 1 (+1h) already uses recovery_sent /
-- recovery_sent_at from migration 0249. Stage 2 needs its own
-- column so the cron sweep can target rows that already received
-- the +1h nudge >24h ago and haven't been touched since.
-- ============================================================

ALTER TABLE signup_attempts ADD COLUMN recovery_sent_24h INTEGER NOT NULL DEFAULT 0;
ALTER TABLE signup_attempts ADD COLUMN recovery_sent_24h_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_signup_attempts_recovery_24h
  ON signup_attempts(recovery_sent_24h, recovery_sent, created_at);

-- ============================================================
-- Register the 2-step abandoned-signup sequence in
-- sequence_definitions so /super-admin/email-sequences surfaces
-- per-step open/click analytics. The cron-worker drives the actual
-- sends directly (not via processDueEnrollments); this row exists
-- purely as a dashboard surface that groups email_sends rows with
-- kind = 'signup_recovery_nudge' / 'signup_recovery_nudge_24h'.
-- ============================================================
INSERT OR IGNORE INTO sequence_definitions
  (sequence_type, name, description, kind, steps_json, default_category, default_from, enabled)
VALUES (
  'signup_recovery',
  'Abandoned Signup Recovery',
  '2-touch sequence for users who requested a verification code but never completed signup. Driven by cron-worker runAbandonedSignupRecovery; this row exists so the dashboard surfaces per-step analytics.',
  'builtin',
  '[{"step_index":0,"label":"+1h nudge","delay_seconds":3600,"handler":"signup_recovery_nudge"},{"step_index":1,"label":"+24h nudge","delay_seconds":86400,"handler":"signup_recovery_nudge_24h"}]',
  'cart',
  'sales@roofmanager.ca',
  1
);

-- ============================================================
-- Disable the 3 sequences that don't belong in the approved set.
-- Code paths stay intact; the cron-worker gate (this migration's
-- companion code change) checks agent_configs.enabled before each
-- run. Re-enable from /super-admin if needed.
-- ============================================================
INSERT INTO agent_configs (agent_type, enabled, config_json) VALUES
  ('signup_nurture', 0, '{"disabled_reason":"Consolidated email-sequence inventory 2026-05-14 — only report delivery + abandoned-signup + future weekly marketing"}'),
  ('cart_recovery',  0, '{"disabled_reason":"Consolidated email-sequence inventory 2026-05-14 — cart will fold into weekly marketing when built"}'),
  ('drips',          0, '{"disabled_reason":"Consolidated email-sequence inventory 2026-05-14 — drips out of scope"}')
ON CONFLICT(agent_type) DO UPDATE SET
  enabled = 0,
  config_json = excluded.config_json,
  updated_at = datetime('now');

-- Also flip the sequence_definitions enabled flag so the dashboard
-- shows them as paused.
UPDATE sequence_definitions
  SET enabled = 0, updated_at = datetime('now')
  WHERE sequence_type IN ('signup_nurture','cart_recovery','drip_stuck_signup_60d','drip_at_risk_churn_30d','drip_trial_ends_3d');
