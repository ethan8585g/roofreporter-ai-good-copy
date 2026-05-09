-- 0225_ads_health_seed.sql
-- Register the new ads_health loop in both agent_configs (cron-worker gate)
-- and loop_definitions (super-admin dashboard catalog). Once these rows exist,
-- the cron-worker will fire scan_ads_health every 4 hours, and the dashboard
-- will surface it next to scan_health/scan_reports automatically.

-- Cron-worker gate. Seeded enabled=1 so the 4h schedule fires immediately.
-- Toggle off via /super-admin/loop-tracker → catalog → toggle if needed.
INSERT OR IGNORE INTO agent_configs (agent_type, enabled, config_json)
VALUES ('scan_ads_health', 1, '{"schedule":"every 4h at :00","sections":10}');

-- Dashboard catalog row. The dashboard discovers loops from this table; the
-- "Run now" button only renders when source='cf_cron' AND loop_id LIKE 'scan_%',
-- so we honour that naming convention. expected_period_seconds = 4h × 3600.
INSERT OR IGNORE INTO loop_definitions
  (loop_id, name, category, source, schedule_cron, schedule_human,
   expected_period_seconds, owner, endpoint, description)
VALUES
  ('ads_health', 'Ads + analytics health (Meta + Google)', 'health', 'cf_cron',
   '0 */4 * * *', 'Every 4h at :00', 14400, 'cron_worker', 'runAdsHealthCheck',
   'Probes pixel-in-HTML presence, GA4 MP debug, Meta CAPI test event, gclid/UTM capture rates, CAPI status mix, conversion drift. Fires email to christinegourley04@gmail.com on warn/fail.');
