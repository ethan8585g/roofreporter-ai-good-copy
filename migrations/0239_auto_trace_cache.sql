-- ============================================================
-- Migration 0239: Auto-trace polygon cache
-- ============================================================
-- Per-(lat, lng, edge) cache of returned auto-trace polygons so
-- re-running the auto-trace on the same property doesn't repeat
-- the Solar API + Opus vision call. Two cost wins per hit:
--   * $0.05-0.10 Anthropic API charge skipped
--   * ~5-12s wall-clock latency dropped to <100ms (D1 lookup)
--
-- Cache key: rounded lat/lng at 5 decimal places (≈ 1.1m × cos(lat)
-- horizontal precision) + edge type. Exact-match only — operators
-- clicking the same property twice will collide on the rounded key;
-- clicks at different houses won't. Future v2 could add a "within
-- N meters" fallback query using stored exact lat/lng if hit rates
-- prove insufficient.
--
-- TTL: 30 days. Operator-submitted corrections invalidate the
-- relevant cache entry (handled by the trace-submit endpoint, not
-- here). Without invalidation, 30 days bounds the staleness window
-- for buildings that get demolished / rebuilt / extended.
-- ============================================================

CREATE TABLE IF NOT EXISTS auto_trace_cache (
  lat_key       REAL    NOT NULL,                      -- input.lat rounded to 5 decimals
  lng_key       REAL    NOT NULL,                      -- input.lng rounded to 5 decimals
  edge          TEXT    NOT NULL,                      -- 'eaves' | 'hips' | 'ridges' | 'valleys'
  lat_exact     REAL    NOT NULL,                      -- input.lat as supplied (audit / fuzzy v2)
  lng_exact     REAL    NOT NULL,                      -- input.lng as supplied
  result_json   TEXT    NOT NULL,                      -- AutoTraceResult sans debug_images
  polygon_source TEXT,                                  -- 'model' | 'edmonton-municipal-lidar' | 'osm-overpass'
  cached_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT    NOT NULL,                      -- cached_at + 30 days
  PRIMARY KEY (lat_key, lng_key, edge)
);

CREATE INDEX IF NOT EXISTS idx_auto_trace_cache_expiry
  ON auto_trace_cache(expires_at);
