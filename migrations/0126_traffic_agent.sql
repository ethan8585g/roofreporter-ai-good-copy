-- ============================================================
-- Migration 0126: Traffic Analyst Agent
-- Registers the traffic agent in agent_configs.
-- No new tables needed — agent reads from site_analytics (0018)
-- and writes insights to platform_insights (0125) + agent_memory (0125).
-- ============================================================

INSERT OR IGNORE INTO agent_configs (agent_type, enabled, config_json) VALUES
  ('traffic', 0, '{"lookback_hours":24,"min_sessions":3,"max_events_analyzed":500}');
