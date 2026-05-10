-- ============================================================
-- Migration 0231: Seed the drip-campaigns agent config
--
-- Drips run in DRY-RUN mode by default — they evaluate eligible
-- customers and write to drip_campaign_state, but DON'T send the
-- email. Flip dry_run=false in the config_json (via super admin)
-- to go live.
-- ============================================================

INSERT OR IGNORE INTO agent_configs (agent_type, enabled, config_json)
VALUES (
  'drips',
  1, -- enabled (i.e. cron will run the evaluator daily)
  '{
    "dry_run": true,
    "sender_email": "sales@roofmanager.ca",
    "sender_name": "Christine at Roof Manager",
    "cooldown_days": 90,
    "max_per_run": 50,
    "campaigns_enabled": ["stuck_signup_60d", "at_risk_churn_30d", "trial_ends_3d"]
  }'
);
