-- ============================================================
-- Migration 0234: Self-improvement tables for the auto-trace agent
-- ============================================================
-- Two tables that turn the auto-trace agent from a one-shot inference
-- pass into a system that learns from super-admin corrections:
--
-- 1. auto_trace_corrections
--    One row per (order, edge type) every time the admin runs the
--    agent and then submits a trace. Stores both the agent's draft
--    and the admin's final geometry so a downstream memo service
--    can compute "common mistakes" and a calibration service can
--    detect over-confident bands.
--
-- 2. traced_index_cache
--    Diverse, bucketed pool of past human traces (the D1 equivalent
--    of src/data/traced-index.ts, refreshed nightly by the cron
--    worker so the bundled static file doesn't need a re-deploy
--    every time a new report completes).
-- ============================================================

CREATE TABLE IF NOT EXISTS auto_trace_corrections (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id              INTEGER NOT NULL,
  edge                  TEXT    NOT NULL,             -- 'eaves'|'hips'|'ridges'
  auto_trace_json       TEXT    NOT NULL,             -- agent's draft segments[]
  final_trace_json      TEXT    NOT NULL,             -- admin's submitted edge geometry
  agent_confidence      INTEGER NOT NULL,             -- 0-100 self-reported by Claude
  -- Comparison metrics — null when the admin chose not to use the agent
  -- output (e.g. cleared + manually traced). Used by the calibrator and
  -- the memo builder to decide which bands are over-confident.
  point_count_delta     INTEGER,                      -- final.length - auto.length
  avg_vertex_offset_ft  REAL,                         -- mean nearest-neighbor distance
  fully_replaced        INTEGER NOT NULL DEFAULT 0,   -- 1 if admin discarded the draft entirely
  edited                INTEGER NOT NULL DEFAULT 0,   -- 1 if final differs from auto in any way
  -- Diagnostic context
  model                 TEXT,                         -- e.g. 'claude-opus-4-7'
  agent_reasoning       TEXT,                         -- short blurb Claude returned
  submitted_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_auto_trace_corrections_edge_submitted
  ON auto_trace_corrections(edge, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_trace_corrections_order
  ON auto_trace_corrections(order_id, submitted_at DESC);

-- ============================================================

CREATE TABLE IF NOT EXISTS traced_index_cache (
  order_id            INTEGER PRIMARY KEY,
  bucket              TEXT,                           -- e.g. 'md/mid' (sqft/segs)
  latitude            REAL,
  longitude           REAL,
  house_sqft          INTEGER,
  roof_pitch_degrees  REAL,
  complexity_class    TEXT,
  segments_count      INTEGER,
  roof_trace_json     TEXT NOT NULL,
  refreshed_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_traced_index_cache_bucket
  ON traced_index_cache(bucket);
