// ============================================================
// Traced Index — bundled few-shot training pool for the auto-trace agent
// ============================================================
// REGENERATE: `npx tsx scripts/build-traced-index.ts` against a recent
// D1 export. The script reads scripts/export-traced-reports.sql, pulls
// the top-30 most-traced reports (by recency × completeness), and
// rewrites this file. Checked in so the worker bundle always has a
// known-good few-shot pool even when D1 is unavailable.
//
// DO NOT hand-edit — the export script overwrites the array below.
// ============================================================

export interface TracedIndexEntry {
  order_id: number
  latitude: number | null
  longitude: number | null
  house_sqft: number | null
  roof_pitch_degrees: number | null
  complexity_class: string | null
  segments_count: number | null
  roof_trace_json: string
}

// Initial seed is empty — the live D1 pool covers all retrieval until
// the export script runs. Auto-trace works fine with an empty static
// index (services/trace-training-data.ts treats the two pools as
// independent).
export const TRACED_INDEX: TracedIndexEntry[] = []
