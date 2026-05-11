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
        if (d.edge !== 'eaves' && d.edge !== 'hips' && d.edge !== 'ridges') continue
        out.push({
          edge: d.edge,
          segments: Array.isArray(d.segments) ? d.segments : [],
          confidence: Number(d.confidence) || 0,
          reasoning: String(d.reasoning || ''),
          model: String(d.model || ''),
        })
        seenEdges.add(d.edge)
      } catch { /* corrupt log row — skip */ }
    }
    return out
  } catch { return [] }
}

/** Hook called from POST /submit-trace. `finalTrace` is the validated UiTrace
 *  about to be persisted. We compare against any auto-trace drafts logged for
 *  this order in the last 2h and write one correction row per edge. Non-fatal —
 *  any failure is swallowed so the customer's submit path stays unblocked. */
export async function logCorrections(
  env: Bindings,
  orderId: number,
  finalTrace: any
): Promise<void> {
  try {
    const drafts = await fetchRecentAutoTraces(env, orderId)
    if (drafts.length === 0) return  // admin didn't use the agent — nothing to learn from

    for (const draft of drafts) {
      const finalSegments = extractFinalSegments(finalTrace, draft.edge)
      const metrics = diffSegments(draft.segments, finalSegments)
      await env.DB.prepare(`
        INSERT INTO auto_trace_corrections (
          order_id, edge, auto_trace_json, final_trace_json,
          agent_confidence, point_count_delta, avg_vertex_offset_ft,
          fully_replaced, edited, model, agent_reasoning
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        orderId,
        draft.edge,
        JSON.stringify(draft.segments).slice(0, 50_000),
        JSON.stringify(finalSegments).slice(0, 50_000),
        draft.confidence,
        metrics.point_count_delta,
        metrics.avg_vertex_offset_ft,
        metrics.fully_replaced ? 1 : 0,
        metrics.edited ? 1 : 0,
        draft.model,
        draft.reasoning.slice(0, 500),
      ).run()
    }
  } catch (e: any) {
    // Most likely cause: migration 0234 hasn't run yet on this environment.
    // Silent — the auto-trace agent itself still works without learning.
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
  const lines = edge === 'ridges' ? trace.ridges : trace.hips
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
  const edited = avgOffset > 0.5 || Math.abs(finalPoints.length - draftPoints.length) > 0
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

export async function buildLessonMemo(env: Bindings, edge: AutoTraceEdge): Promise<string> {
  let rows: Array<{
    point_count_delta: number | null
    avg_vertex_offset_ft: number | null
    fully_replaced: number
    edited: number
    agent_confidence: number
  }>
  try {
    const res = await env.DB.prepare(`
      SELECT point_count_delta, avg_vertex_offset_ft, fully_replaced, edited, agent_confidence
      FROM auto_trace_corrections
      WHERE edge = ?
      ORDER BY submitted_at DESC
      LIMIT 50
    `).bind(edge).all<any>()
    rows = res.results || []
  } catch { return '' }
  if (rows.length === 0) return ''

  const n = rows.length
  const edited = rows.filter(r => r.edited).length
  const fullyReplaced = rows.filter(r => r.fully_replaced).length
  const avgOffset = rows
    .map(r => r.avg_vertex_offset_ft)
    .filter((v): v is number => typeof v === 'number')
    .reduce((s, v, _, arr) => s + v / arr.length, 0)
  const pointDeltas = rows
    .map(r => r.point_count_delta)
    .filter((v): v is number => typeof v === 'number')
  const avgPointDelta = pointDeltas.length > 0
    ? pointDeltas.reduce((s, v) => s + v, 0) / pointDeltas.length
    : 0

  const lines: string[] = []
  lines.push(`HISTORICAL ${edge.toUpperCase()} CORRECTION DATA (last ${n} super-admin reviews of your output):`)
  lines.push(`- Edit rate: ${Math.round(100 * edited / n)}% (${edited}/${n}) — these traces required at least one vertex move.`)
  if (fullyReplaced > 0) {
    lines.push(`- Full redraws: ${Math.round(100 * fullyReplaced / n)}% (${fullyReplaced}/${n}) — admin discarded your output entirely.`)
  }
  if (avgOffset > 0) {
    lines.push(`- Average vertex shift: ${avgOffset.toFixed(1)} ft.`)
  }
  if (Math.abs(avgPointDelta) >= 1) {
    if (avgPointDelta > 0) {
      lines.push(`- You consistently UNDER-COUNT vertices by ~${Math.round(avgPointDelta)} per trace. Look harder for jogs, bump-outs, and small corners you may be smoothing over.`)
    } else {
      lines.push(`- You consistently OVER-COUNT vertices by ~${Math.abs(Math.round(avgPointDelta))} per trace. Stop putting points on straight edges — corners only.`)
    }
  }
  lines.push('Use this as a self-correction signal — adjust your tendencies for THIS request based on the pattern above.')
  return lines.join('\n')
}

// ── 3. Confidence calibration ──────────────────────────────────

/** Returns a multiplier in [0.5, 1.0] to apply to the model's self-reported
 *  confidence before returning it to the UI. Logic:
 *    - If <10 recent samples: 1.0 (not enough data yet).
 *    - Otherwise: 1 - (edit_rate × 0.4). 100% edit rate → 0.6 multiplier;
 *      0% edit rate → 1.0. Floor 0.5 so even consistently-edited bands keep
 *      some signal value.
 *  The calibrator does NOT subtract from confidence directly because Claude's
 *  baseline confidence is itself useful (a high confidence + 50% edit rate
 *  means "model thinks it's right but historically wasn't" — useful to the UI). */
export async function getCalibrationFactor(env: Bindings, edge: AutoTraceEdge): Promise<number> {
  try {
    const res = await env.DB.prepare(`
      SELECT COUNT(*) AS n,
             SUM(CASE WHEN edited = 1 THEN 1 ELSE 0 END) AS edited
      FROM auto_trace_corrections
      WHERE edge = ?
        AND submitted_at > datetime('now', '-90 days')
    `).bind(edge).first<{ n: number; edited: number }>()
    const n = Number(res?.n || 0)
    const edited = Number(res?.edited || 0)
    if (n < 10) return 1.0
    const editRate = edited / n
    return Math.max(0.5, Math.min(1.0, 1.0 - editRate * 0.4))
  } catch {
    return 1.0
  }
}
