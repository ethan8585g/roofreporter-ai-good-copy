-- ============================================================
-- Migration 0236: Stable run_id for auto-trace correlation
-- ============================================================
-- Replaces the fuzzy "any auto-trace run for this order in the last
-- 2 hours" log-window match with a deterministic UUID minted by
-- runAutoTrace() and echoed back from the client on submit.
--
-- The 2h window broke on:
--   - Multi-admin handoffs (admin A draws, admin B submits)
--   - Re-runs after a prior submit (wrong draft attributed)
--   - Slow admin sessions that span > 2h
--   - Stale drafts beyond 2h (silently never recorded)
--
-- With a UUID-keyed correction row we can correlate exactly the
-- draft → submit pair the operator actually used.
--
-- Column is nullable so old rows (pre-migration) and existing 2h-
-- match path remain valid; the new run_id-keyed path is added
-- alongside in services/auto-trace-learning.ts.
-- ============================================================

ALTER TABLE auto_trace_corrections ADD COLUMN run_id TEXT;

CREATE INDEX IF NOT EXISTS idx_auto_trace_corrections_run_id
  ON auto_trace_corrections(run_id);
