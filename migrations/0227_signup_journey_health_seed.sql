-- ============================================================
-- Wire signup_journey + signup_health into the cron worker
-- Seeds rows in agent_configs (the gate the cron uses) and in
-- loop_definitions (the catalog the loop tracker UI shows).
-- After this migration, the cron worker fires:
--   • signup_journey  every hour at :00  (synthetic logged-in walk)
--   • signup_health   daily at 10:00 UTC (digest of platform health)
-- ============================================================

INSERT OR IGNORE INTO agent_configs (agent_type, enabled) VALUES ('signup_journey', 1);
INSERT OR IGNORE INTO agent_configs (agent_type, enabled) VALUES ('signup_health',  1);

INSERT OR IGNORE INTO loop_definitions
  (loop_id, name, category, source, schedule_cron, schedule_human,
   expected_period_seconds, owner, endpoint, description, enabled)
VALUES
  ('signup_journey',
   'Signup journey synthetic walk',
   'health', 'cf_cron', '0 * * * *', 'Every hour at :00',
   3600, 'cron_worker', 'runSignupJourney',
   'Mints a synthetic logged-in customer session and walks every /customer/* page + the major auth''d APIs + a few toggle round-trips. Emails dead ends to support if any.',
   1),
  ('signup_health',
   'Signup health daily digest',
   'health', 'cf_cron', '0 10 * * *', 'Daily 10:00 UTC',
   86400, 'cron_worker', 'runSignupHealthCheck',
   'Probes signup surface + Gmail transport + funnel regression + backend secrets + surface scans + reports + payments. Always emails the summary.',
   1);
