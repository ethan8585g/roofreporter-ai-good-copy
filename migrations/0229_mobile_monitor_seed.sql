-- ============================================================
-- Wire mobile_monitor into the cron worker + loop tracker.
-- Seeds rows in agent_configs (the gate the cron uses) and in
-- loop_definitions (the catalog the loop tracker UI shows).
-- After this migration, the cron worker fires:
--   • mobile_monitor  every 12h at 00:00 + 12:00 UTC
--     (Browser Rendering walk of public webfront + customer module
--     at iPhone viewport)
-- ============================================================

INSERT OR IGNORE INTO agent_configs (agent_type, enabled, config_json)
VALUES ('scan_mobile_monitor', 1, '{"schedule":"every 12h at :00","viewport":"375x667","ua":"iOS Safari 17"}');

INSERT OR IGNORE INTO loop_definitions
  (loop_id, name, category, source, schedule_cron, schedule_human,
   expected_period_seconds, owner, endpoint, description, enabled)
VALUES
  ('mobile_monitor',
   'Mobile webfront + customer module health',
   'health', 'cf_cron', '0 0,12 * * *', 'Every 12h at 00:00 + 12:00 UTC',
   43200, 'cron_worker', 'runMobileMonitor',
   'Loads each public marketing page + customer portal page in a real Cloudflare browser at iPhone viewport (375x667 @ 2x DPR, iOS Safari UA) and emails any breakage to support. Catches mobile-specific layout/JS regressions that desktop fetches miss.',
   1);
