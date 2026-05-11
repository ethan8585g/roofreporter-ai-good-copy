-- ============================================================
-- Migration 0237: Locked seed set for the auto-trace accuracy harness
-- ============================================================
-- Replaces "run the agent on whatever orders happen to be in D1" with
-- a deterministic eval suite: ~60 orders split into three pools, the
-- same orders evaluated every harness run so before/after comparisons
-- are paired and reproducible.
--
-- pool semantics:
--   'baseline'  — 20 orders the harness scores on every CI/A-B run.
--                 You can iterate against this; it's the dev set.
--   'holdout_a' — 20 orders never touched during development. Hit it
--                 quarterly to validate that improvements are real and
--                 not eval-set overfit. NEVER inspect the per-order
--                 results manually.
--   'holdout_b' — 20-order backup holdout for when holdout_a gets
--                 contaminated (anyone looked at any individual order
--                 → it's tainted, swap to b).
--
-- CRITICAL: the trace-training-data.ts retriever + the cache refresh
-- MUST exclude eval_seed_set.order_id from their queries — otherwise
-- the agent gets to retrieve its own eval answers as few-shot examples
-- and the IoU score becomes a memorization metric.
-- ============================================================

CREATE TABLE IF NOT EXISTS eval_seed_set (
  order_id      INTEGER PRIMARY KEY,
  pool          TEXT    NOT NULL,       -- 'baseline' | 'holdout_a' | 'holdout_b'
  sqft_bucket   TEXT,                   -- 'sm' | 'md' | 'lg' | 'xl'
  seg_bucket    TEXT,                   -- 'low' | 'mid' | 'hi'
  source        TEXT,                   -- 'admin' | 'self'
  added_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  -- Frozen at time of inclusion so we can spot drift later.
  frozen_house_sqft     INTEGER,
  frozen_segments_count INTEGER
);

CREATE INDEX IF NOT EXISTS idx_eval_seed_set_pool ON eval_seed_set(pool);
