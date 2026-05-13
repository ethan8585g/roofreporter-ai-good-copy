-- ============================================================
-- Migration 0242: Solar segments cache on orders
-- ============================================================
-- Caches the Google Solar API roof-segment response per order so
-- the super-admin trace modal can paint the per-plane pitch
-- overlay without re-calling the Solar API on every open.
--
-- Two columns:
--   solar_segments_json       — the segments[] payload (label,
--                               pitch_degrees, azimuth_degrees,
--                               area_m2, center, bbox) plus
--                               building_bbox + imagery_quality.
--                               NULL means "never fetched."
--                               '[]' means "fetched, no coverage."
--   solar_segments_fetched_at — ISO timestamp of the last fetch.
--                               Lets future code add a TTL or
--                               surface "stale" badges.
--
-- Cache invalidation: the endpoint accepts ?refresh=1 to force a
-- re-fetch. We don't auto-expire on time — Solar API roof geometry
-- only changes if the building changes, and the admin can always
-- refresh manually if they suspect drift.
-- ============================================================

ALTER TABLE orders ADD COLUMN solar_segments_json TEXT;
ALTER TABLE orders ADD COLUMN solar_segments_fetched_at TEXT;
