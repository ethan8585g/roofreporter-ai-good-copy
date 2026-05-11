// ============================================================
// Auto-Trace Learning — corrections logger + memo + calibration
// ============================================================
// Three closely-coupled pieces that turn the one-shot agent into one
// that adapts to super-admin edits:
//
//   1. logCorrection() — called inside POST /submit-trace. Diffs the
//      most recent auto-trace draft (from user_activity_log) against
//      the final submitted geometry per edge type. Writes one row per
//      edge to auto_trace_corrections.
//
//   2. buildLessonMemo() — called inside runAutoTrace() before the
//      Claude vision call. Aggregates the last N corrections for the
//      given edge type and returns a short paragraph of "things you
//      historically get wrong on this edge" that goes into the system
//      prompt.
//
//   3. getCalibrationFactor() — multiplier in [0.5, 1.0] applied to
//      the model's self-reported confidence. Brings high-confidence-
//      but-heavily-edited bands back down so the UI badge doesn't lie.
//
// All three are tolerant of a missing table — they no-op silently
// when migration 0234 hasn't run yet, so the agent stays usable
// during the rollout window.
// ============================================================

import type { Bindings } from '../types'
import type { AutoTraceEdge } from './auto-trace-agent'
import type { LatLng } from '../utils/trace-validation'

// ── 1. Diff + log ──────────────────────────────────────────────

interface AutoTraceLogRecord {
  edge: AutoTraceEdge
  segments: LatLng[][]
  confidence: number
  reasoning: string
  model: string
  /** Complexity bucket the agent computed at run-time. Carried back into
   *  auto_trace_corrections so calibration can segment without re-deriving. */
  complexityBucket?: string
  /** Stable UUID minted by runAutoTrace. Migration 0236 added the column;
   *  rows logged before the migration won't have it. */
  runId?: string
}

/** Pull every auto-trace draft logged for this order in the last 2 hours. The
 *  super-admin may have run the agent multiple times (eaves, then hips, then
 *  ridges) before clicking Submit — we want all of them so we can diff each. */
async function fetchRecentAutoTraces(env: Bindings, orderId: number): Promise<AutoTraceLogRecord[]> {
  try {
    const rows = await env.DB.prepare(`
      SELECT details FROM user_activity_log
      WHERE action = 'admin_auto_trace'
        AND created_at > datetime('now', '-2 hours')
        AND json_extract(details, '$.order_id') = ?
      ORDER BY id DESC
      LIMIT 12
    `).bind(orderId).all<{ details: string }>()
    const out: AutoTraceLogRecord[] = []
    const seenEdges = new Set<string>()
    for (const row of rows.results || []) {
      try {
        const d = JSON.parse(row.details)
        // Most recent run per edge type wins (the log stores both runs
        // when the admin clicks the button twice).
        if (seenEdges.has(d.edge)) continue
        if (d.edge !== 'eaves' && d.edge !== 'hips' && d.edge !== 'ridges' && d.edge !== 'valleys') continue
        out.push({
          edge: d.edge,
          segments: Array.isArray(d.segments) ? d.segments : [],
          confidence: Number(d.confidence) || 0,
          reasoning: String(d.reasoning || ''),
          model: String(d.model || ''),
          complexityBucket: typeof d.complexity_bucket === 'string' ? d.complexity_bucket : undefined,
          runId: typeof d.run_id === 'string' ? d.run_id : undefined,
        })
        seenEdges.add(d.edge)
      } catch { /* corrupt log row — skip */ }
    }
    return out
  } catch { return [] }
}

/** Pull auto-trace drafts by EXACT run_id list — the deterministic path
 *  introduced by migration 0236. When the client echoes accepted run_ids
 *  back on /submit-trace, this replaces the fuzzy 2h log-window match.
 *  Falls back to caller-resolved 2h match when no run_ids are supplied. */
async function fetchAutoTracesByRunIds(env: Bindings, orderId: number, runIds: string[]): Promise<AutoTraceLogRecord[]> {
  if (runIds.length === 0) return []
  // Sanitize — accept only UUID-shaped ids to keep the LIKE clause safe.
  const clean = runIds.filter(id => /^[a-zA-Z0-9_-]{8,64}$/.test(id))
  if (clean.length === 0) return []
  try {
    const placeholders = clean.map(() => '?').join(',')
    const rows = await env.DB.prepare(`
      SELECT details FROM user_activity_log
      WHERE action = 'admin_auto_trace'
        AND json_extract(details, '$.order_id') = ?
      ORDER BY id DESC
      LIMIT 50
    `).bind(orderId).all<{ details: string }>()
    const wanted = new Set(clean)
    const out: AutoTraceLogRecord[] = []
    const seenEdges = new Set<string>()
    for (const row of rows.results || []) {
      try {
        const d = JSON.parse(row.details)
        if (!d?.run_id || !wanted.has(String(d.run_id))) continue
        if (seenEdges.has(d.edge)) continue
        if (d.edge !== 'eaves' && d.edge !== 'hips' && d.edge !== 'ridges' && d.edge !== 'valleys') continue
        out.push({
          edge: d.edge,
          segments: Array.isArray(d.segments) ? d.segments : [],
          confidence: Number(d.confidence) || 0,
          reasoning: String(d.reasoning || ''),
          model: String(d.model || ''),
          complexityBucket: typeof d.complexity_bucket === 'string' ? d.complexity_bucket : undefined,
          runId: typeof d.run_id === 'string' ? d.run_id : undefined,
        })
        seenEdges.add(d.edge)
      } catch { /* corrupt — skip */ }
    }
    // Reference `placeholders` so the linter doesn't trip on the unused
    // template above (kept for symmetry with future IN-clause migration).
    void placeholders
    return out
  } catch (e: any) {
    console.warn('[auto-trace-learning] runId fetch failed:', e?.message)
    return []
  }
}

/** Optional client-side telemetry from the trace editor — distinguishes
 *  "accepted in 4s" from "rebuilt over 6 minutes". Migration 0235 adds the
 *  columns; missing fields are stored as NULL. */
export interface SubmitTelemetry {
  /** Set when the operator clicked an explicit "Accept Auto-Trace As-Is"
   *  button. Ground-truth positive signal — overrides the noise-floor
   *  edited heuristic. */
  acceptedUnchanged?: boolean
  /** Milliseconds the operator spent in the trace editor for this order. */
  editDurationMs?: number
  /** Counts of operator-level vertex operations. */
  vertexMoves?: number
  vertexAdds?: number
  vertexDeletes?: number
  /** Property's complexity class at log time (low/mid/hi). Snapshotted so
   *  calibration can segment without re-deriving later. */
  complexityBucket?: string
  /** Accepted run_ids — if supplied, logCorrections uses deterministic
   *  by-id linking instead of the fuzzy 2h log-window match. One per edge
   *  type the operator actually used. */
  acceptedRunIds?: { eaves?: string; hips?: string; ridges?: string; valleys?: string }
}

/** Hook called from POST /submit-trace. `finalTrace` is the validated UiTrace
 *  about to be persisted. We compare against any auto-trace drafts logged for
 *  this order in the last 2h and write one correction row per edge. Non-fatal —
 *  any failure is swallowed so the customer's submit path stays unblocked. */
export async function logCorrections(
  env: Bindings,
  orderId: number,
  finalTrace: any,
  telemetry?: SubmitTelemetry,
): Promise<void> {
  try {
    // Prefer deterministic by-run_id matching when the client echoed
    // accepted run_ids back; fall back to the 2h window match. The
    // by-id path solves multi-admin handoffs, > 2h sessions, and re-
    // submit-after-prior-submit attribution bugs.
    const runIds: string[] = []
    if (telemetry?.acceptedRunIds) {
      for (const v of Object.values(telemetry.acceptedRunIds)) if (typeof v === 'string' && v) runIds.push(v)
    }
    const drafts = runIds.length > 0
      ? await fetchAutoTracesByRunIds(env, orderId, runIds)
      : await fetchRecentAutoTraces(env, orderId)
    if (drafts.length === 0) return  // admin didn't use the agent — nothing to learn from

    const acceptedUnchanged = telemetry?.acceptedUnchanged === true ? 1 : 0

    for (const draft of drafts) {
      const finalSegments = extractFinalSegments(finalTrace, draft.edge)
      const metrics = diffSegments(draft.segments, finalSegments)
      // If the operator explicitly accepted as-is, override the noise-floor
      // `edited` boolean — they told us it was fine, trust that over the
      // 2ft heuristic.
      const editedFinal = acceptedUnchanged ? 0 : (metrics.edited ? 1 : 0)
      await env.DB.prepare(`
        INSERT INTO auto_trace_corrections (
          order_id, edge, auto_trace_json, final_trace_json,
          agent_confidence, point_count_delta, avg_vertex_offset_ft,
          fully_replaced, edited, model, agent_reasoning,
          complexity_bucket, accepted_unchanged,
          edit_duration_ms, vertex_moves, vertex_adds, vertex_deletes,
          run_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        orderId,
        draft.edge,
        JSON.stringify(draft.segments).slice(0, 50_000),
        JSON.stringify(finalSegments).slice(0, 50_000),
        draft.confidence,
        metrics.point_count_delta,
        metrics.avg_vertex_offset_ft,
        metrics.fully_replaced ? 1 : 0,
        editedFinal,
        draft.model,
        draft.reasoning.slice(0, 500),
        // Prefer client telemetry when supplied; fall back to the bucket
        // the agent stamped onto the audit row at run-time.
        telemetry?.complexityBucket || draft.complexityBucket || null,
        acceptedUnchanged,
        Number.isFinite(telemetry?.editDurationMs as any) ? Math.round(telemetry!.editDurationMs as any) : null,
        Number.isFinite(telemetry?.vertexMoves as any) ? Math.round(telemetry!.vertexMoves as any) : null,
        Number.isFinite(telemetry?.vertexAdds as any) ? Math.round(telemetry!.vertexAdds as any) : null,
        Number.isFinite(telemetry?.vertexDeletes as any) ? Math.round(telemetry!.vertexDeletes as any) : null,
        draft.runId || null,
      ).run()
    }
  } catch (e: any) {
    // Most likely cause: migration 0234/0235 hasn't run yet on this
    // environment. Silent — the agent itself still works without learning.
    console.warn('[auto-trace-learning] logCorrections skipped:', e?.message)
  }
}

function extractFinalSegments(trace: any, edge: AutoTraceEdge): LatLng[][] {
  if (!trace || typeof trace !== 'object') return []
  if (edge === 'eaves') {
    if (Array.isArray(trace.eaves_sections) && trace.eaves_sections.length > 0) {
      return trace.eaves_sections.filter((s: any) => Array.isArray(s) && s.length >= 3)
    }
    if (Array.isArray(trace.eaves)) {
      if (trace.eaves.length > 0 && Array.isArray(trace.eaves[0])) {
        return trace.eaves.filter((s: any) => Array.isArray(s) && s.length >= 3)
      }
      if (trace.eaves.length >= 3) return [trace.eaves]
    }
    return []
  }
  const lines = edge === 'ridges' ? trace.ridges
              : edge === 'valleys' ? trace.valleys
              : trace.hips
  if (!Array.isArray(lines)) return []
  return lines
    .map((l: any) => Array.isArray(l) ? l : (l && Array.isArray(l.pts) ? l.pts : null))
    .filter((pts: any): pts is LatLng[] => Array.isArray(pts) && pts.length >= 2)
}

interface DiffMetrics {
  point_count_delta: number
  avg_vertex_offset_ft: number | null
  fully_replaced: boolean
  edited: boolean
}

function diffSegments(draft: LatLng[][], final: LatLng[][]): DiffMetrics {
  const draftPoints = draft.flat()
  const finalPoints = final.flat()
  if (draftPoints.length === 0) {
    return { point_count_delta: finalPoints.length, avg_vertex_offset_ft: null, fully_replaced: false, edited: finalPoints.length > 0 }
  }
  if (finalPoints.length === 0) {
    return { point_count_delta: -draftPoints.length, avg_vertex_offset_ft: null, fully_replaced: true, edited: true }
  }
  // Per-vertex nearest-neighbor distance — gives an aggregate sense of "how
  // far the admin moved things" without needing edge correspondence. Coarse
  // but exactly what we need for "is the agent in the right neighborhood".
  let totalFt = 0
  for (const p of draftPoints) {
    let best = Infinity
    for (const q of finalPoints) {
      const d = greatCircleFt(p, q)
      if (d < best) best = d
    }
    totalFt += best
  }
  const avgOffset = totalFt / draftPoints.length
  // "Fully replaced" heuristic: <30% of the admin's points are within 3 ft of
  // any agent vertex — meaning the admin redrew the geometry from scratch.
  let nearCount = 0
  for (const q of finalPoints) {
    for (const p of draftPoints) {
      if (greatCircleFt(p, q) < 3) { nearCount++; break }
    }
  }
  const fully_replaced = (nearCount / Math.max(finalPoints.length, 1)) < 0.30
  // 2 ft threshold (was 0.5 ft) — anything below 2 ft is at or under GPS
  // jitter + Static-Maps pixel-snapping noise. A trace where the admin
  // accepted the agent's polygon as-is can still show 1-1.5 ft of "drift"
  // purely from coordinate quantization; treating that as `edited=1`
  // collapsed the calibration factor to its 0.6 floor permanently.
  const edited = avgOffset > 2.0 || Math.abs(finalPoints.length - draftPoints.length) > 0
  return {
    point_count_delta: finalPoints.length - draftPoints.length,
    avg_vertex_offset_ft: Math.round(avgOffset * 100) / 100,
    fully_replaced,
    edited,
  }
}

function greatCircleFt(a: LatLng, b: LatLng): number {
  const R_FT = 20_902_231  // earth radius in feet
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const lat1 = a.lat * Math.PI / 180
  const lat2 = b.lat * Math.PI / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R_FT * Math.asin(Math.sqrt(x))
}

// ── 2. Lesson memo — fed into Claude's system prompt ───────────

export async function buildLessonMemo(env: Bindings, edge: AutoTraceEdge, complexityBucket?: string): Promise<string> {
  let rows: Array<{
    point_count_delta: number | null
    avg_vertex_offset_ft: number | null
    fully_replaced: number
    edited: number
    agent_confidence: number
    age_days: number | null
  }>
  // Try bucket-filtered first; fall back to global when the bucket sample
  // is thin (< 5 rows). Pure complexity is what predicts trace difficulty —
  // a 4-segment ranch and a 12-segment dormer house drift differently.
  try {
    if (complexityBucket) {
      const bucketRes = await env.DB.prepare(`
        SELECT point_count_delta, avg_vertex_offset_ft, fully_replaced, edited, agent_confidence,
               CAST((julianday('now') - julianday(submitted_at)) AS REAL) AS age_days
        FROM auto_trace_corrections
        WHERE edge = ? AND complexity_bucket = ?
        ORDER BY submitted_at DESC
        LIMIT 50
      `).bind(edge, complexityBucket).all<any>()
      rows = bucketRes.results || []
      if (rows.length < 5) {
        // Not enough bucket-specific samples — pull global instead.
        const globalRes = await env.DB.prepare(`
          SELECT point_count_delta, avg_vertex_offset_ft, fully_replaced, edited, agent_confidence,
                 CAST((julianday('now') - julianday(submitted_at)) AS REAL) AS age_days
          FROM auto_trace_corrections
          WHERE edge = ?
          ORDER BY submitted_at DESC
          LIMIT 50
        `).bind(edge).all<any>()
        rows = globalRes.results || []
      }
    } else {
      const res = await env.DB.prepare(`
        SELECT point_count_delta, avg_vertex_offset_ft, fully_replaced, edited, agent_confidence,
               CAST((julianday('now') - julianday(submitted_at)) AS REAL) AS age_days
        FROM auto_trace_corrections
        WHERE edge = ?
        ORDER BY submitted_at DESC
        LIMIT 50
      `).bind(edge).all<any>()
      rows = res.results || []
    }
  } catch { return '' }
  if (rows.length === 0) return ''

  // Recency weight: exp(-age_days / 30). Sample from today has weight ~1.0,
  // one month ago ~0.37, three months ago ~0.05. Past ~90 days contributes
  // near-zero — closer to "fresh signal" than "lifetime average".
  const weights = rows.map(r => Math.exp(-Math.max(0, Number(r.age_days) || 0) / 30))
  const sumW = weights.reduce((s, w) => s + w, 0) || 1
  const weightedSum = (vals: number[]) =>
    vals.reduce((s, v, i) => s + v * weights[i], 0) / sumW

  const n = rows.length
  const editedW = weightedSum(rows.map(r => r.edited ? 1 : 0))
  const fullyW = weightedSum(rows.map(r => r.fully_replaced ? 1 : 0))
  const offsetVals = rows.map(r => Number(r.avg_vertex_offset_ft || 0))
  const offsetW = weightedSum(offsetVals)
  const pointDeltaVals = rows.map(r => Number(r.point_count_delta || 0))
  const pointDeltaW = weightedSum(pointDeltaVals)

  const lines: string[] = []
  lines.push(`HISTORICAL ${edge.toUpperCase()} CORRECTION DATA (last ${n} super-admin reviews; recency-weighted toward fresh submissions):`)
  lines.push(`- Edit rate: ${Math.round(100 * editedW)}% — fraction of recent traces that required at least one vertex move.`)
  if (fullyW > 0) {
    lines.push(`- Full redraws: ${Math.round(100 * fullyW)}% — fraction where the admin discarded your output entirely.`)
  }
  if (offsetW > 0) {
    lines.push(`- Average vertex shift: ${offsetW.toFixed(1)} ft.`)
  }
  if (Math.abs(pointDeltaW) >= 1) {
    if (pointDeltaW > 0) {
      lines.push(`- You consistently UNDER-COUNT vertices by ~${Math.round(pointDeltaW)} per trace. Look harder for jogs, bump-outs, and small corners you may be smoothing over.`)
    } else {
      lines.push(`- You consistently OVER-COUNT vertices by ~${Math.abs(Math.round(pointDeltaW))} per trace. Stop putting points on straight edges — corners only.`)
    }
  }
  // Surface a positive signal too — pure self-flagellation collapses
  // confidence and worsens output. If recent edit rate is low, say so.
  if (editedW < 0.35 && n >= 5) {
    lines.push(`- You've been landing recent ${edge} traces well — the admin accepted or only lightly tweaked the majority. Keep doing what you're doing on this type.`)
  }
  lines.push('Use this as a self-correction signal — adjust your tendencies for THIS request based on the pattern above.')
  return lines.join('\n')
}

// ── 3. Confidence calibration ──────────────────────────────────

/** Returns a multiplier in [0.5, 1.0] derived from historical edit rate.
 *  Surfaced as a diagnostic ONLY — the displayed confidence is no longer
 *  multiplied by it (that destroyed the high-confidence-but-edited signal).
 *
 *  Logic (was: hard `if (n<10) return 1.0` cliff with no recency weighting):
 *    - Beta-Bernoulli shrinkage: editRate = (edited + 2) / (n + 4). This is
 *      Bayesian smoothing with a uniform Beta(2,2) prior, so we always have
 *      a meaningful estimate even at N=1 instead of waiting for N≥10. As N
 *      grows, the prior wears off naturally.
 *    - Recency weighting: SUM(exp(-age_days/30)) instead of COUNT(*). A
 *      trace edited 6 months ago shouldn't outvote one edited yesterday.
 *    - Output: 1 - (editRate × 0.4), floored at 0.5. Matches the old shape
 *      so downstream consumers see no abrupt change. */
export async function getCalibrationFactor(env: Bindings, edge: AutoTraceEdge, complexityBucket?: string): Promise<number> {
  try {
    // Bucket-filtered query first when a bucket is supplied. Fall back to
    // global when the bucket's effective N (recency-weighted) is < 3 — at
    // that point the Beta(2,2) prior dominates and global gives a better
    // signal anyway.
    if (complexityBucket) {
      const bRes = await env.DB.prepare(`
        SELECT SUM(exp(-(julianday('now') - julianday(submitted_at)) / 30.0)) AS n_w,
               SUM(CASE WHEN edited = 1 THEN exp(-(julianday('now') - julianday(submitted_at)) / 30.0) ELSE 0 END) AS edited_w
        FROM auto_trace_corrections
        WHERE edge = ? AND complexity_bucket = ?
          AND submitted_at > datetime('now', '-90 days')
      `).bind(edge, complexityBucket).first<{ n_w: number; edited_w: number }>()
      const bN = Number(bRes?.n_w || 0)
      if (bN >= 3) {
        const bEdited = Number(bRes?.edited_w || 0)
        const editRate = (bEdited + 2) / (bN + 4)
        return Math.max(0.5, Math.min(1.0, 1.0 - editRate * 0.4))
      }
    }
    const res = await env.DB.prepare(`
      SELECT SUM(exp(-(julianday('now') - julianday(submitted_at)) / 30.0)) AS n_w,
             SUM(CASE WHEN edited = 1 THEN exp(-(julianday('now') - julianday(submitted_at)) / 30.0) ELSE 0 END) AS edited_w
      FROM auto_trace_corrections
      WHERE edge = ?
        AND submitted_at > datetime('now', '-90 days')
    `).bind(edge).first<{ n_w: number; edited_w: number }>()
    const n = Number(res?.n_w || 0)
    const edited = Number(res?.edited_w || 0)
    // Beta(2,2) prior — smooth from N=0 instead of an N<10 cliff.
    const editRate = (edited + 2) / (n + 4)
    return Math.max(0.5, Math.min(1.0, 1.0 - editRate * 0.4))
  } catch {
    return 1.0
  }
}
