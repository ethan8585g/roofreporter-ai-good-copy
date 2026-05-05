// ============================================================
// Trace Enhancer — Auto-clean a hand-drawn roof trace before
// it hits the measurement engine.
//
// Stage 1 (always on): deterministic geometry rules that catch
//   common digitization noise — collinear runs, sub-1 ft jogs,
//   near-90° corners, ridge endpoints that almost touch a corner
//   or hip, ridge polylines with hairline gaps.
// Stage 2 (when ANTHROPIC_API_KEY is set): a single Claude call
//   that reviews the cleaned trace for high-confidence corrections
//   the deterministic rules can't see (e.g. an obvious unfinished
//   line that ends mid-roof). Only suggestions ≥ 0.85 confidence
//   are auto-applied; the rest become warnings.
//
// Pure functions throughout — they take a trace JSON and return
// a NEW trace JSON. The caller decides whether to persist it.
// ============================================================

import type { LatLng, UiTrace, UiTraceLine } from '../utils/trace-validation'
import { getAnthropicClient, CLAUDE_MODEL, extractJson } from './anthropic-client'

// ── Constants ─────────────────────────────────────────────────

const FT_PER_DEG_LAT = 364_000

// Defaults tuned against real Roof Manager traces. Anything stricter
// starts deleting features people drew on purpose; anything looser
// leaves visible jogs in the 3D mesh.
const DEFAULTS = {
  collinearAngleDeg: 6,    // adjacent eave bearings within 6° → merge
  tinyEdgeFt:        1.2,  // edges shorter than 1.2 ft → drop
  rightAngleSnapDeg: 0,    // disabled — was silently rotating user-drawn corners up to 7°
  ridgeToCornerFt:   3.0,  // ridge endpoint within 3 ft of an eave corner → snap
  ridgeToLineFt:     2.0,  // ridge endpoint within 2 ft of a hip/valley endpoint → join
  ridgeGapFt:        1.5,  // two ridge polylines with endpoints within 1.5 ft → splice
  parallelPairAngleDeg: 5, // opposite edges within 5° of antiparallel → candidate pair
  parallelPairMaxDiffFt: 2.0,  // length gap ≤ 2 ft → equalize
  parallelPairMaxDiffPct: 0.10, // AND length gap ≤ 10% of longer edge
  aiMinConfidence:   0.85, // only apply Claude suggestions at/above this threshold
}

// ── Public types ──────────────────────────────────────────────

export interface TraceChange {
  rule: string                // 'merge_collinear' | 'drop_tiny_edge' | etc.
  layer: 'eaves' | 'ridges' | 'hips' | 'valleys'
  section?: number
  index?: number
  before?: string
  after?: string
  details?: string
}

export interface EnhancementResult {
  trace: UiTrace
  changes: TraceChange[]
  warnings: string[]
  ai_used: boolean
  ai_suggestions_applied: number
  ai_suggestions_skipped: number
}

export interface EnhanceOptions {
  collinearAngleDeg?: number
  tinyEdgeFt?: number
  rightAngleSnapDeg?: number
  ridgeToCornerFt?: number
  ridgeToLineFt?: number
  ridgeGapFt?: number
  parallelPairAngleDeg?: number
  parallelPairMaxDiffFt?: number
  parallelPairMaxDiffPct?: number
  aiEnabled?: boolean
  aiMinConfidence?: number
}

// ── Geometry helpers (planar, ft) ─────────────────────────────

interface XY { x: number; y: number }

function toXY(p: LatLng, refLat: number, refLng: number): XY {
  const ftPerDegLng = FT_PER_DEG_LAT * Math.cos(refLat * Math.PI / 180)
  return {
    x: (p.lng - refLng) * ftPerDegLng,
    y: (p.lat - refLat) * FT_PER_DEG_LAT,
  }
}

function toLatLng(p: XY, refLat: number, refLng: number): LatLng {
  const ftPerDegLng = FT_PER_DEG_LAT * Math.cos(refLat * Math.PI / 180)
  return {
    lat: refLat + p.y / FT_PER_DEG_LAT,
    lng: refLng + p.x / ftPerDegLng,
  }
}

function distFt(a: XY, b: XY): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function bearingDeg(a: XY, b: XY): number {
  return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI
}

function angleDiffDeg(a: number, b: number): number {
  let d = Math.abs(a - b) % 360
  if (d > 180) d = 360 - d
  return d
}

// ── Trace shape utilities ─────────────────────────────────────

function getLinePts(line: UiTraceLine): LatLng[] {
  return Array.isArray(line) ? line : (line && Array.isArray(line.pts) ? line.pts : [])
}

function setLinePts(line: UiTraceLine, pts: LatLng[]): UiTraceLine {
  if (Array.isArray(line)) return pts
  return { ...line, pts }
}

function getEaveSections(trace: UiTrace): LatLng[][] {
  if (Array.isArray(trace.eaves_sections) && trace.eaves_sections.length > 0) {
    return trace.eaves_sections.filter(s => Array.isArray(s) && s.length >= 3)
  }
  if (Array.isArray(trace.eaves)) {
    if (trace.eaves.length > 0 && Array.isArray((trace.eaves as any)[0])) {
      return (trace.eaves as LatLng[][]).filter(s => Array.isArray(s) && s.length >= 3)
    }
    if ((trace.eaves as LatLng[]).length >= 3) return [trace.eaves as LatLng[]]
  }
  return []
}

function setEaveSections(trace: UiTrace, sections: LatLng[][]): UiTrace {
  const out: UiTrace = { ...trace }
  // Preserve the original shape: if input used eaves_sections, write back to it.
  // If input used a flat eaves single-section, write to flat eaves.
  if (Array.isArray(trace.eaves_sections) && trace.eaves_sections.length > 0) {
    out.eaves_sections = sections
  } else if (Array.isArray(trace.eaves) && trace.eaves.length > 0 && Array.isArray((trace.eaves as any)[0])) {
    out.eaves = sections as any
  } else if (sections.length === 1) {
    out.eaves = sections[0]
  } else {
    out.eaves_sections = sections
  }
  return out
}

// ── Rule: merge collinear eave edges ──────────────────────────

export function mergeCollinearEaves(
  pts: LatLng[],
  angleThreshDeg: number,
): { pts: LatLng[]; removed: number } {
  if (pts.length < 4) return { pts, removed: 0 }
  const refLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length
  const refLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length
  const xy = pts.map(p => toXY(p, refLat, refLng))

  let kept = pts.slice()
  let keptXY = xy.slice()
  // Iterate until no more merges happen (handles long collinear runs).
  for (let pass = 0; pass < 3; pass++) {
    const drop = new Set<number>()
    const n = kept.length
    if (n < 4) break
    for (let i = 0; i < n; i++) {
      const prev = (i - 1 + n) % n
      const next = (i + 1) % n
      if (drop.has(prev) || drop.has(next)) continue
      const b1 = bearingDeg(keptXY[prev], keptXY[i])
      const b2 = bearingDeg(keptXY[i], keptXY[next])
      if (angleDiffDeg(b1, b2) < angleThreshDeg) drop.add(i)
    }
    if (drop.size === 0) break
    // Don't drop below 3 vertices — guard catastrophic merges.
    if (kept.length - drop.size < 3) break
    const newKept: LatLng[] = []
    const newKeptXY: XY[] = []
    for (let i = 0; i < kept.length; i++) {
      if (!drop.has(i)) { newKept.push(kept[i]); newKeptXY.push(keptXY[i]) }
    }
    kept = newKept
    keptXY = newKeptXY
  }

  return { pts: kept, removed: pts.length - kept.length }
}

// ── Rule: remove tiny edges ───────────────────────────────────

export function removeTinyEaves(
  pts: LatLng[],
  minFt: number,
): { pts: LatLng[]; removed: number } {
  if (pts.length < 4) return { pts, removed: 0 }
  const refLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length
  const refLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length
  let work = pts.slice()
  let removed = 0
  for (let pass = 0; pass < 3; pass++) {
    if (work.length < 4) break
    let dropIdx = -1
    let shortest = Infinity
    for (let i = 0; i < work.length; i++) {
      const a = toXY(work[i], refLat, refLng)
      const b = toXY(work[(i + 1) % work.length], refLat, refLng)
      const len = distFt(a, b)
      if (len < minFt && len < shortest) { shortest = len; dropIdx = i }
    }
    if (dropIdx < 0) break
    // Drop the SECOND point of the short edge (so the polygon "snaps" to
    // the prior corner). This preserves the larger surrounding shape.
    const next = (dropIdx + 1) % work.length
    work.splice(next, 1)
    removed++
  }
  return { pts: work, removed }
}

// ── Rule: snap near-90° corners to 90° ────────────────────────

export function snapRightAngles(
  pts: LatLng[],
  threshDeg: number,
): { pts: LatLng[]; snapped: number } {
  if (pts.length < 4) return { pts, snapped: 0 }
  const refLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length
  const refLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length
  const xy = pts.map(p => toXY(p, refLat, refLng))
  const out = xy.slice()
  let snapped = 0
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const prev = out[(i - 1 + n) % n]
    const here = out[i]
    const next = out[(i + 1) % n]
    // Vectors from corner.
    const v1x = prev.x - here.x, v1y = prev.y - here.y
    const v2x = next.x - here.x, v2y = next.y - here.y
    const len1 = Math.hypot(v1x, v1y)
    const len2 = Math.hypot(v2x, v2y)
    if (len1 < 0.5 || len2 < 0.5) continue
    const dot = v1x * v2x + v1y * v2y
    const cos = dot / (len1 * len2)
    const ang = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI
    const deviation = Math.abs(ang - 90)
    // Deadband: a corner that's already within 0.1° of 90° is "perfect enough".
    // Without this, perfect rectangles get reported as snapped.
    if (deviation < 0.1 || deviation > threshDeg) continue
    // Rotate the v2 direction so the angle becomes exactly 90°.
    // Easier: project `next` onto a line perpendicular to v1 through `here`,
    // preserving |v2|. New direction = perpendicular to v1 (right-hand if
    // current cross is positive, else left-hand).
    const cross = v1x * v2y - v1y * v2x
    const sign = cross >= 0 ? 1 : -1
    // Perp(v1) = (-v1y, v1x) (90° CCW). Apply sign.
    const perpX = -v1y * sign / len1
    const perpY =  v1x * sign / len1
    out[(i + 1) % n] = {
      x: here.x + perpX * len2,
      y: here.y + perpY * len2,
    }
    snapped++
  }
  if (snapped === 0) return { pts, snapped: 0 }
  return { pts: out.map(p => toLatLng(p, refLat, refLng)), snapped }
}

// ── Rule: equalize near-symmetric opposite edges ──────────────
// Pairs each edge with its closest near-antiparallel mate (within
// `angleThreshDeg` of 180° apart), and if their lengths are within
// both `maxDiffFt` AND `maxDiffPct`, averages them. This catches
// GPS wobble on bilaterally symmetric shapes (sheds, rectangular
// houses with chamfered corners) where opposite eaves should be
// equal but came out 1 ft apart.
//
// Conservative by design: skips any pair where the gap exceeds
// either threshold, so genuinely asymmetric buildings are untouched.
//
// Algorithm:
//  1. Compute each edge's midpoint, bearing, length.
//  2. For each edge i, find best j (j != i) where bearings are
//     within `angleThreshDeg` of 180° apart (antiparallel).
//  3. If pair (i,j) is mutual best AND length gap is within both
//     thresholds, mark for equalization to the average length.
//  4. Apply by moving the SECOND endpoint of each marked edge
//     along its current direction so length equals the target.
//     Each vertex is moved at most once per pass.

export function equalizeParallelPairs(
  pts: LatLng[],
  angleThreshDeg: number,
  maxDiffFt: number,
  maxDiffPct: number,
): { pts: LatLng[]; equalized: number } {
  const n = pts.length
  if (n < 4) return { pts, equalized: 0 }
  const refLat = pts.reduce((s, p) => s + p.lat, 0) / n
  const refLng = pts.reduce((s, p) => s + p.lng, 0) / n
  const xy = pts.map(p => toXY(p, refLat, refLng))

  interface EdgeInfo { i: number; len: number; bearing: number; midX: number; midY: number }
  const edges: EdgeInfo[] = []
  for (let i = 0; i < n; i++) {
    const a = xy[i]
    const b = xy[(i + 1) % n]
    edges.push({
      i,
      len: distFt(a, b),
      bearing: bearingDeg(a, b),
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    })
  }

  // For each edge, find its single best antiparallel partner.
  const partner: number[] = new Array(n).fill(-1)
  for (let i = 0; i < n; i++) {
    let bestJ = -1
    let bestDelta = Infinity
    for (let j = 0; j < n; j++) {
      if (j === i) continue
      // Antiparallel: bearings differ by ~180°.
      const delta = Math.abs(180 - angleDiffDeg(edges[i].bearing, edges[j].bearing))
      if (delta > angleThreshDeg) continue
      if (delta < bestDelta) { bestDelta = delta; bestJ = j }
    }
    partner[i] = bestJ
  }

  // Mutual partners only, length-eligible, and process each pair once.
  const handled = new Set<number>()
  const newXY = xy.slice()
  let equalized = 0
  for (let i = 0; i < n; i++) {
    if (handled.has(i)) continue
    const j = partner[i]
    if (j < 0 || partner[j] !== i) continue
    const li = edges[i].len
    const lj = edges[j].len
    const diff = Math.abs(li - lj)
    const longer = Math.max(li, lj)
    if (longer < 0.5) continue
    if (diff > maxDiffFt) continue
    if (diff / longer > maxDiffPct) continue
    if (diff < 0.05) { handled.add(i); handled.add(j); continue } // already equal
    const target = (li + lj) / 2
    // Move the SECOND vertex of each edge along its current direction
    // so its length becomes `target`. Preserves the start vertex so
    // already-snapped right-angle corners stay anchored on one side.
    for (const k of [i, j]) {
      const a = newXY[k]
      const b = newXY[(k + 1) % n]
      const curLen = Math.hypot(b.x - a.x, b.y - a.y)
      if (curLen < 0.5) continue
      const ux = (b.x - a.x) / curLen
      const uy = (b.y - a.y) / curLen
      newXY[(k + 1) % n] = { x: a.x + ux * target, y: a.y + uy * target }
    }
    handled.add(i); handled.add(j)
    equalized++
  }

  if (equalized === 0) return { pts, equalized: 0 }
  return { pts: newXY.map(p => toLatLng(p, refLat, refLng)), equalized }
}

// ── Rule: snap ridge endpoints to nearby eave corners ─────────

export function snapRidgeEndpointsToCorners(
  ridges: UiTraceLine[],
  eaveSections: LatLng[][],
  snapFt: number,
): { ridges: UiTraceLine[]; snapped: number } {
  if (!ridges || ridges.length === 0 || eaveSections.length === 0) {
    return { ridges: ridges || [], snapped: 0 }
  }
  const allCorners = eaveSections.flat()
  if (allCorners.length === 0) return { ridges, snapped: 0 }
  const refLat = allCorners.reduce((s, p) => s + p.lat, 0) / allCorners.length
  const refLng = allCorners.reduce((s, p) => s + p.lng, 0) / allCorners.length
  const cornersXY = allCorners.map(p => toXY(p, refLat, refLng))

  let snapped = 0
  const out: UiTraceLine[] = ridges.map((line) => {
    const pts = getLinePts(line)
    if (pts.length < 2) return line
    const newPts = pts.slice()
    for (const endIdx of [0, pts.length - 1]) {
      const ep = toXY(pts[endIdx], refLat, refLng)
      let bestDist = Infinity
      let bestIdx = -1
      for (let i = 0; i < cornersXY.length; i++) {
        const d = distFt(ep, cornersXY[i])
        if (d < bestDist) { bestDist = d; bestIdx = i }
      }
      if (bestDist < snapFt && bestIdx >= 0) {
        newPts[endIdx] = allCorners[bestIdx]
        snapped++
      }
    }
    return setLinePts(line, newPts)
  })
  return { ridges: out, snapped }
}

// ── Rule: snap ridge endpoints to nearby hip/valley endpoints ─

export function snapRidgeEndpointsToLines(
  ridges: UiTraceLine[],
  others: UiTraceLine[],
  snapFt: number,
): { ridges: UiTraceLine[]; snapped: number } {
  if (!ridges || ridges.length === 0 || !others || others.length === 0) {
    return { ridges: ridges || [], snapped: 0 }
  }
  const targetEndpoints: LatLng[] = []
  for (const o of others) {
    const pts = getLinePts(o)
    if (pts.length >= 2) {
      targetEndpoints.push(pts[0], pts[pts.length - 1])
    }
  }
  if (targetEndpoints.length === 0) return { ridges, snapped: 0 }
  const refLat = targetEndpoints.reduce((s, p) => s + p.lat, 0) / targetEndpoints.length
  const refLng = targetEndpoints.reduce((s, p) => s + p.lng, 0) / targetEndpoints.length
  const targetsXY = targetEndpoints.map(p => toXY(p, refLat, refLng))

  let snapped = 0
  const out: UiTraceLine[] = ridges.map((line) => {
    const pts = getLinePts(line)
    if (pts.length < 2) return line
    const newPts = pts.slice()
    for (const endIdx of [0, pts.length - 1]) {
      const ep = toXY(pts[endIdx], refLat, refLng)
      let bestDist = Infinity
      let bestIdx = -1
      for (let i = 0; i < targetsXY.length; i++) {
        const d = distFt(ep, targetsXY[i])
        if (d < bestDist) { bestDist = d; bestIdx = i }
      }
      if (bestDist < snapFt && bestIdx >= 0) {
        newPts[endIdx] = targetEndpoints[bestIdx]
        snapped++
      }
    }
    return setLinePts(line, newPts)
  })
  return { ridges: out, snapped }
}

// ── Rule: splice ridge polylines with hairline gaps ───────────

export function closeRidgeGaps(
  ridges: UiTraceLine[],
  gapFt: number,
): { ridges: UiTraceLine[]; spliced: number } {
  if (!ridges || ridges.length < 2) return { ridges: ridges || [], spliced: 0 }
  const all = ridges.map(l => ({ line: l, pts: getLinePts(l).slice() }))
  // Reference frame from the first ridge's first point.
  const first = all[0].pts[0]
  if (!first) return { ridges, spliced: 0 }
  const refLat = first.lat, refLng = first.lng
  let spliced = 0
  // Greedy O(n²) — n is tiny in practice.
  let merged = true
  while (merged) {
    merged = false
    outer: for (let i = 0; i < all.length; i++) {
      if (all[i].pts.length < 2) continue
      for (let j = 0; j < all.length; j++) {
        if (i === j || all[j].pts.length < 2) continue
        const ai = all[i].pts
        const aj = all[j].pts
        // Try all 4 endpoint combinations.
        const aiStart = toXY(ai[0], refLat, refLng)
        const aiEnd   = toXY(ai[ai.length - 1], refLat, refLng)
        const ajStart = toXY(aj[0], refLat, refLng)
        const ajEnd   = toXY(aj[aj.length - 1], refLat, refLng)
        const d_ee = distFt(aiEnd, ajStart)
        const d_es = distFt(aiEnd, ajEnd)
        const d_se = distFt(aiStart, ajStart)
        const d_ss = distFt(aiStart, ajEnd)
        const dmin = Math.min(d_ee, d_es, d_se, d_ss)
        if (dmin > gapFt) continue
        // Splice: orient j so its start matches i's end.
        let jPts = aj
        if (dmin === d_es) jPts = aj.slice().reverse()
        else if (dmin === d_ss) jPts = aj.slice().reverse()
        let newPts: LatLng[]
        if (dmin === d_ee || dmin === d_es) {
          newPts = ai.concat(jPts.slice(1))
        } else {
          newPts = jPts.concat(ai.slice(1))
        }
        all[i] = { line: setLinePts(all[i].line, newPts), pts: newPts }
        all.splice(j, 1)
        spliced++
        merged = true
        break outer
      }
    }
  }
  return { ridges: all.map(a => a.line), spliced }
}

// ── Stage 1: deterministic enhancement ────────────────────────

export function enhanceTrace(trace: UiTrace, opts: EnhanceOptions = {}): EnhancementResult {
  const cfg = { ...DEFAULTS, ...opts }
  const changes: TraceChange[] = []
  const warnings: string[] = []

  if (!trace || typeof trace !== 'object') {
    return { trace, changes, warnings: ['Trace is not an object — skipped enhancement'], ai_used: false, ai_suggestions_applied: 0, ai_suggestions_skipped: 0 }
  }

  // ── Eaves: per-section cleanup ──
  const sections = getEaveSections(trace)
  const newSections: LatLng[][] = []
  for (let s = 0; s < sections.length; s++) {
    let pts = sections[s]
    const beforeLen = pts.length

    const tiny = removeTinyEaves(pts, cfg.tinyEdgeFt)
    if (tiny.removed > 0) {
      changes.push({ rule: 'drop_tiny_edge', layer: 'eaves', section: s, details: `removed ${tiny.removed} sub-${cfg.tinyEdgeFt} ft edges` })
    }
    pts = tiny.pts

    const collin = mergeCollinearEaves(pts, cfg.collinearAngleDeg)
    if (collin.removed > 0) {
      changes.push({ rule: 'merge_collinear', layer: 'eaves', section: s, details: `merged ${collin.removed} near-collinear vertices (within ${cfg.collinearAngleDeg}°)` })
    }
    pts = collin.pts

    if (cfg.rightAngleSnapDeg > 0) {
      const right = snapRightAngles(pts, cfg.rightAngleSnapDeg)
      if (right.snapped > 0) {
        changes.push({ rule: 'snap_right_angle', layer: 'eaves', section: s, details: `snapped ${right.snapped} corners to 90° (within ${cfg.rightAngleSnapDeg}°)` })
      }
      pts = right.pts
    }

    const eq = equalizeParallelPairs(pts, cfg.parallelPairAngleDeg, cfg.parallelPairMaxDiffFt, cfg.parallelPairMaxDiffPct)
    if (eq.equalized > 0) {
      changes.push({ rule: 'equalize_parallel_pair', layer: 'eaves', section: s, details: `equalized ${eq.equalized} near-symmetric edge pair${eq.equalized === 1 ? '' : 's'} (≤${cfg.parallelPairMaxDiffFt} ft / ${Math.round(cfg.parallelPairMaxDiffPct * 100)}% gap, within ${cfg.parallelPairAngleDeg}° of antiparallel)` })
    }
    pts = eq.pts

    if (pts.length < 3) {
      warnings.push(`Section ${s + 1}: cleanup left fewer than 3 points; reverted to original ${beforeLen}-point polygon.`)
      newSections.push(sections[s])
    } else {
      newSections.push(pts)
    }
  }

  let working = sections.length > 0 ? setEaveSections(trace, newSections) : { ...trace }

  // ── Ridges: snap endpoints to corners + lines, splice gaps ──
  if (Array.isArray(working.ridges) && working.ridges.length > 0) {
    let r = working.ridges as UiTraceLine[]

    const toCorner = snapRidgeEndpointsToCorners(r, newSections, cfg.ridgeToCornerFt)
    if (toCorner.snapped > 0) {
      changes.push({ rule: 'snap_ridge_to_corner', layer: 'ridges', details: `snapped ${toCorner.snapped} ridge endpoints to nearest eave corner (within ${cfg.ridgeToCornerFt} ft)` })
    }
    r = toCorner.ridges

    const otherLines = ([] as UiTraceLine[]).concat(
      Array.isArray(working.hips) ? working.hips : [],
      Array.isArray(working.valleys) ? working.valleys : [],
    )
    const toLine = snapRidgeEndpointsToLines(r, otherLines, cfg.ridgeToLineFt)
    if (toLine.snapped > 0) {
      changes.push({ rule: 'snap_ridge_to_line', layer: 'ridges', details: `snapped ${toLine.snapped} ridge endpoints to nearby hip/valley endpoints (within ${cfg.ridgeToLineFt} ft)` })
    }
    r = toLine.ridges

    const splice = closeRidgeGaps(r, cfg.ridgeGapFt)
    if (splice.spliced > 0) {
      changes.push({ rule: 'splice_ridge_gap', layer: 'ridges', details: `spliced ${splice.spliced} ridge polylines whose endpoints were within ${cfg.ridgeGapFt} ft` })
    }
    r = splice.ridges

    working = { ...working, ridges: r }
  }

  return {
    trace: working,
    changes,
    warnings,
    ai_used: false,
    ai_suggestions_applied: 0,
    ai_suggestions_skipped: 0,
  }
}

// ── Stage 2: AI verification (Claude) ─────────────────────────

interface AISuggestion {
  kind: 'snap_ridge_endpoint' | 'extend_ridge' | 'remove_stray_line' | 'note'
  layer: 'ridges' | 'hips' | 'valleys' | 'eaves'
  index: number
  endpoint?: 0 | 1
  to?: { lat: number; lng: number }
  reason: string
  confidence: number
}

function compactTraceForAI(trace: UiTrace): any {
  const sections = getEaveSections(trace)
  const compactLine = (l: UiTraceLine) => {
    const pts = getLinePts(l)
    return pts.map(p => [round6(p.lat), round6(p.lng)])
  }
  return {
    eaves_sections: sections.map(s => s.map(p => [round6(p.lat), round6(p.lng)])),
    ridges:  Array.isArray(trace.ridges)  ? (trace.ridges  as UiTraceLine[]).map(compactLine) : [],
    hips:    Array.isArray(trace.hips)    ? (trace.hips    as UiTraceLine[]).map(compactLine) : [],
    valleys: Array.isArray(trace.valleys) ? (trace.valleys as UiTraceLine[]).map(compactLine) : [],
  }
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

const AI_SYSTEM_PROMPT = `You are a roof tracing reviewer. The user hand-traced a building outline and roof feature lines (ridges, hips, valleys) from a satellite image. The trace was already cleaned by deterministic geometry rules (collinear merging, tiny-edge removal, right-angle snapping, endpoint snapping within 3 ft). Your job is to find ONLY HIGH-CONFIDENCE remaining corrections.

A correction is HIGH-CONFIDENCE when:
- A line's endpoint is clearly meant to reach a specific corner or another line's endpoint, but stops short by 3–8 ft (just outside the deterministic snap radius).
- A short stray line is clearly an accidental click-and-drag (under 4 ft, disconnected from any geometry).
- Two collinear ridge segments should obviously be one line.

DO NOT invent geometry. DO NOT suggest edits to the eave outline (the deterministic rules already handled those). DO NOT suggest moves > 8 ft.

Respond ONLY with valid JSON in this exact shape (no prose, no markdown):
{
  "corrections": [
    {
      "kind": "snap_ridge_endpoint" | "remove_stray_line" | "note",
      "layer": "ridges" | "hips" | "valleys",
      "index": <0-based index in the layer's array>,
      "endpoint": 0 | 1,
      "to": { "lat": <number>, "lng": <number> },
      "reason": "<≤120 chars>",
      "confidence": <0.0-1.0>
    }
  ]
}

Coordinates are [lat, lng] arrays in the input. Confidence < 0.85 will be ignored, so omit anything you're unsure about.`

async function callClaudeForCorrections(trace: UiTrace, apiKey: string): Promise<AISuggestion[]> {
  const client = getAnthropicClient(apiKey)
  const compact = compactTraceForAI(trace)
  const userMsg = `Trace JSON:\n${JSON.stringify(compact)}`
  const resp = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: AI_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
  })
  const textBlock = resp.content.find(b => b.type === 'text') as any
  if (!textBlock || typeof textBlock.text !== 'string') return []
  try {
    const parsed = extractJson<{ corrections?: AISuggestion[] }>(textBlock.text)
    return Array.isArray(parsed.corrections) ? parsed.corrections : []
  } catch {
    return []
  }
}

function applyAISuggestions(
  trace: UiTrace,
  suggestions: AISuggestion[],
  minConfidence: number,
): { trace: UiTrace; applied: AISuggestion[]; skipped: AISuggestion[] } {
  const applied: AISuggestion[] = []
  const skipped: AISuggestion[] = []
  let working = { ...trace }
  for (const s of suggestions) {
    if (typeof s.confidence !== 'number' || s.confidence < minConfidence) {
      skipped.push(s); continue
    }
    if (s.kind === 'snap_ridge_endpoint' && s.layer === 'ridges' && s.to && (s.endpoint === 0 || s.endpoint === 1)) {
      const ridges = Array.isArray(working.ridges) ? (working.ridges as UiTraceLine[]).slice() : []
      const line = ridges[s.index]
      if (!line) { skipped.push(s); continue }
      const pts = getLinePts(line).slice()
      if (pts.length < 2) { skipped.push(s); continue }
      const idx = s.endpoint === 0 ? 0 : pts.length - 1
      pts[idx] = { lat: s.to.lat, lng: s.to.lng }
      ridges[s.index] = setLinePts(line, pts)
      working = { ...working, ridges }
      applied.push(s)
    } else if (s.kind === 'remove_stray_line') {
      const layerKey = s.layer
      const arr = Array.isArray((working as any)[layerKey]) ? ((working as any)[layerKey] as UiTraceLine[]).slice() : null
      if (!arr || s.index < 0 || s.index >= arr.length) { skipped.push(s); continue }
      arr.splice(s.index, 1)
      ;(working as any)[layerKey] = arr
      applied.push(s)
    } else {
      skipped.push(s)
    }
  }
  return { trace: working, applied, skipped }
}

export async function enhanceTraceWithAI(
  trace: UiTrace,
  env: { ANTHROPIC_API_KEY?: string },
  opts: EnhanceOptions = {},
): Promise<EnhancementResult> {
  const stage1 = enhanceTrace(trace, opts)
  const aiEnabled = opts.aiEnabled !== false && !!env.ANTHROPIC_API_KEY
  if (!aiEnabled) return stage1

  try {
    const suggestions = await callClaudeForCorrections(stage1.trace, env.ANTHROPIC_API_KEY!)
    const minConf = opts.aiMinConfidence ?? DEFAULTS.aiMinConfidence
    const { trace: aiTrace, applied, skipped } = applyAISuggestions(stage1.trace, suggestions, minConf)
    const aiChanges: TraceChange[] = applied.map(s => ({
      rule: `ai_${s.kind}`,
      layer: s.layer,
      index: s.index,
      details: `${s.reason} (confidence ${s.confidence.toFixed(2)})`,
    }))
    const aiWarnings = skipped
      .filter(s => typeof s.confidence === 'number' && s.confidence >= 0.6)
      .map(s => `AI flagged but did not apply: ${s.reason} (confidence ${s.confidence.toFixed(2)})`)
    return {
      trace: aiTrace,
      changes: stage1.changes.concat(aiChanges),
      warnings: stage1.warnings.concat(aiWarnings),
      ai_used: true,
      ai_suggestions_applied: applied.length,
      ai_suggestions_skipped: skipped.length,
    }
  } catch (err: any) {
    return {
      ...stage1,
      warnings: stage1.warnings.concat([`AI enhancement failed: ${err?.message || 'unknown error'} (deterministic cleanup applied successfully)`]),
      ai_used: false,
    }
  }
}
