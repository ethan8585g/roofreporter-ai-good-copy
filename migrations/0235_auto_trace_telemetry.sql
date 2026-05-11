-- ============================================================
-- Migration 0235: Auto-trace telemetry + per-complexity calibration
-- ============================================================
-- Adds three independent feature columns to auto_trace_corrections.
-- All nullable so existing rows remain valid; new code falls back to
-- the prior global behaviour when the column is null.
--
-- 1. complexity_bucket
--    Snapshot of the property's complexity class (low / mid / hi)
--    taken at the time the agent ran. Lets buildLessonMemo and
--    getCalibrationFactor segment their stats — a 4-segment ranch
--    and a 12-segment dormer house drift in different directions
--    and one global edit-rate averages them out.
--
-- 2. accepted_unchanged
--    Explicit signal that the operator clicked "Accept Auto-Trace
--    As-Is" rather than editing-then-submitting. Replaces the
--    fragile heuristic "0.5ft offset = unchanged" with ground
--    truth. Calibration treats accepted_unchanged=1 as a positive
--    sample regardless of any noise-floor offset.
--
-- 3. edit_duration_ms / vertex_moves / vertex_adds / vertex_deletes
--    Client-side telemetry: time spent in the trace editor + the
--    counts of operator vertex manipulations. Distinguishes
--    "accepted in 4s" from "manually rebuilt for 6 minutes" — both
--    look identical to the legacy `edited` boolean.
-- ============================================================

ALTER TABLE auto_trace_corrections ADD COLUMN complexity_bucket  TEXT;
ALTER TABLE auto_trace_corrections ADD COLUMN accepted_unchanged INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auto_trace_corrections ADD COLUMN edit_duration_ms   INTEGER;
ALTER TABLE auto_trace_corrections ADD COLUMN vertex_moves       INTEGER;
ALTER TABLE auto_trace_corrections ADD COLUMN vertex_adds        INTEGER;
ALTER TABLE auto_trace_corrections ADD COLUMN vertex_deletes     INTEGER;

CREATE INDEX IF NOT EXISTS idx_auto_trace_corrections_edge_bucket_submitted
  ON auto_trace_corrections(edge, complexity_bucket, submitted_at DESC);
