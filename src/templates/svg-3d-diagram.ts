// ============================================================
// 3D-LOOK ROOF DIAGRAM — Phase 1
// Axonometric SVG with computed Lambert lighting + per-structure
// rendering. Replaces the flat top-down view with a true 3D
// massing model that prints crisply (pure vector, no rasterization).
//
// Inputs come from the existing RoofReport — no engine changes.
// Output is a single SVG string per structure.
// ============================================================

import type { RoofReport, RoofSegment } from '../types'
import { detectDisjointEaves } from '../utils/disjoint-eaves'

// ───────────────────────── TYPES ─────────────────────────

export interface LatLng { lat: number; lng: number }

export interface StructurePartition {
  /** 1-based index ("Structure 1") */
  index: number
  /** "Main House" / "Detached Garage" / "Lower Eave" / etc. */
  label: string
  /** Section kind tag — drives label assignment + per-card styling. 'lower_tier'
   *  marks a visible lower-eave lip beneath an upper-story roof. */
  kind?: 'main' | 'lower_tier'
  /** WGS84 footprint polygon (closed, 3+ points) */
  eaves: LatLng[]
  /** Internal lines that fall inside this footprint */
  ridges: LatLng[][]
  hips: LatLng[][]
  valleys: LatLng[][]
  /** Rakes (gable edges) inside this footprint */
  rakes: LatLng[][]
  /** Computed footprint sqft (Shoelace) */
  footprint_sqft: number
  /** Pitch-corrected sloped area sqft */
  true_area_sqft: number
  /** Perimeter ft */
  perimeter_ft: number
  /** Dominant pitch in degrees (inherited from report) */
  dominant_pitch_deg: number
  dominant_pitch_label: string
  /** Share of total true area (0..1) — used for material allocation */
  area_share: number
  /** Per-structure linear feet for each edge type (haversine on the trace) */
  eave_lf: number
  ridge_lf: number
  hip_lf: number
  valley_lf: number
  rake_lf: number
  /** Dormer polygons whose centroid sits inside this structure's eaves. */
  dormers?: Array<{
    polygon: LatLng[]
    pitch_rise: number
    label?: string
  }>
}

// ───────────────────────── CONSTANTS ─────────────────────────

const M_PER_DEG_LAT = 111320
const M_TO_FT = 3.28084
const FT2_PER_M2 = 10.7639

// Axonometric tilt: 0° yaw + 30° pitch.
// Yaw 0 keeps NORTH at the top of the diagram and EAST on the right —
// the same orientation as the Google Maps Static satellite tile on page 1.
// Any non-zero yaw rotates the diagram relative to the satellite, which
// makes it look "backwards" because the user instinctively compares the two.
// Pitch 30° gives the 3D mass without tipping past visual readability.
const YAW_DEG = 0
const PITCH_DEG = 30

// Two-light Lambert shading: a strong KEY sun from the NW and a softer FILL
// from the SE so the back side of the roof never goes dead-flat dark.
const SUN_KEY = (() => {
  const az = 315 * Math.PI / 180  // NW
  const el = 45 * Math.PI / 180
  return {
    x: Math.cos(el) * Math.sin(az),
    y: Math.cos(el) * Math.cos(az),
    z: Math.sin(el),
  }
})()
const SUN_FILL = (() => {
  const az = 135 * Math.PI / 180  // SE
  const el = 25 * Math.PI / 180
  return {
    x: Math.cos(el) * Math.sin(az),
    y: Math.cos(el) * Math.cos(az),
    z: Math.sin(el),
  }
})()

const EDGE_COLOR: Record<string, string> = {
  EAVE:   '#0F766E',
  RIDGE:  '#991B1B',
  HIP:    '#C2410C',
  VALLEY: '#1D4ED8',
  RAKE:   '#6D28D9',
}

// Per-pitch base color ramp; gets shaded by Lambert. Lighter mid-tones
// than the prior palette so the widened Lambert range (see lambertFactor
// below) has actual headroom to read — the old palette landed every
// residential roof in dark-grey territory where face shading vanished
// and adjacent structures looked identical (RM-20260512-5044 reproducer).
const PITCH_BAND_COLOR: Array<[number, string]> = [
  [2, '#D1D5D7'],    // flat → light warm slate
  [4, '#A8AEB1'],    // low-slope
  [7, '#878F93'],    // mid (typical residential 4-7/12 lands here)
  [10, '#6A7174'],   // standard
  [99, '#4A5053'],   // steep → dark charcoal
]

// Per-structure tint colors — blended at ~12% over each face so the two
// structures in a multi-building trace READ as distinct at a glance,
// even when their geometry is similar. Cycles through warm/cool/green/
// terracotta so up to 4 structures get visually-different palettes.
const STRUCTURE_TINT: string[] = [
  '#6B8FA8',  // cool slate-blue (default — main house)
  '#A88660',  // warm tan (garage / second structure)
  '#7B9472',  // muted green (third)
  '#A56B6B',  // muted terracotta (fourth)
]

// ───────────────────────── GEOM HELPERS ─────────────────────────

function shoelaceFt2(poly: { x: number; y: number }[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length
    a += poly[i].x * poly[j].y - poly[j].x * poly[i].y
  }
  return Math.abs(a) / 2 * FT2_PER_M2
}

function perimeterFt(poly: { x: number; y: number }[]): number {
  let p = 0
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length
    p += Math.hypot(poly[j].x - poly[i].x, poly[j].y - poly[i].y) * M_TO_FT
  }
  return p
}

function pointInPolygon(pt: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y
    const xj = poly[j].x, yj = poly[j].y
    const intersect = ((yi > pt.y) !== (yj > pt.y))
      && (pt.x < ((xj - xi) * (pt.y - yi)) / ((yj - yi) || 1e-9) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

function midLatLng(line: LatLng[]): LatLng {
  const mid = line[Math.floor(line.length / 2)]
  return mid || line[0]
}

function projectLatLngToMeters(pts: LatLng[], cosLat: number, refLat: number, refLng: number) {
  // Standard math convention: +x = east, +y = north. Combined with
  // projectAxonometric's screen-y flip, yaw=0 gives a north-up east-right
  // view that matches Google Maps Static (which is always north-up).
  return pts.map(p => ({
    x: (p.lng - refLng) * 111320 * cosLat,
    y: (p.lat - refLat) * M_PER_DEG_LAT,
  }))
}

// ───────────────────────── STRUCTURE PARTITION ─────────────────────────

/**
 * Split a roof report into per-structure partitions. Picks the *largest by
 * area* as primary (not by point count, which was the old bug source).
 * Internal lines (ridge/hip/valley/rake) are assigned by point-in-polygon
 * test on the line's midpoint. Lines that fall outside every polygon stay
 * with the largest structure as a safety net.
 */
export function splitStructures(report: RoofReport): StructurePartition[] {
  const rt: any = (report as any).roof_trace
  if (!rt) return []

  // Resolve eaves polygons: prefer eaves_sections, fall back to eaves[].
  let sections: LatLng[][] = []
  if (Array.isArray(rt.eaves_sections) && rt.eaves_sections.length > 0) {
    sections = rt.eaves_sections.filter((s: any) => Array.isArray(s) && s.length >= 3)
  } else if (Array.isArray(rt.eaves) && rt.eaves.length >= 3) {
    sections = [rt.eaves]
  } else if (Array.isArray(rt.eaves_outline) && rt.eaves_outline.length >= 3) {
    sections = [rt.eaves_outline]
  }
  if (sections.length === 0) return []

  // Auto-detect: if the user traced two structures into a single polygon
  // without clicking "add structure", split it back into per-structure
  // sub-polygons. Returns the original polygon untouched when the trace
  // is genuinely a single shape.
  if (sections.length === 1) {
    const split = detectDisjointEaves(sections[0])
    if (split.length > 1) sections = split
  }

  // Common projection origin = centroid of all eave points across sections.
  const allPts = sections.flat()
  const refLat = allPts.reduce((s, p) => s + p.lat, 0) / allPts.length
  const refLng = allPts.reduce((s, p) => s + p.lng, 0) / allPts.length
  const cosLat = Math.cos(refLat * Math.PI / 180)

  const slopeMult = report.area_multiplier && report.area_multiplier > 1
    ? report.area_multiplier
    : 1
  const dominantPitchDeg = report.roof_pitch_degrees
    || (report.segments && report.segments[0]?.pitch_degrees)
    || 20
  const dominantPitchLabel = report.roof_pitch_ratio
    || (report.segments && report.segments[0]?.pitch_ratio)
    || `${(12 * Math.tan(dominantPitchDeg * Math.PI / 180)).toFixed(1)}:12`

  // Build candidate partitions, area-sorted descending. Kind is captured
  // per-section so the post-sort label/styling can distinguish lower-tier
  // lips from regular detached structures.
  type Cand = {
    eaves: LatLng[]
    eavesXY: { x: number; y: number }[]
    footprint_sqft: number
    perimeter_ft: number
    kind: 'main' | 'lower_tier'
  }
  const sectionKinds: Array<'main' | 'lower_tier'> = Array.isArray(rt.eaves_section_kinds)
    ? rt.eaves_section_kinds.map((k: any) => k === 'lower_tier' ? 'lower_tier' : 'main')
    : []
  const cands: Cand[] = sections.map((eaves, i) => {
    const xy = projectLatLngToMeters(eaves, cosLat, refLat, refLng)
    return {
      eaves,
      eavesXY: xy,
      footprint_sqft: shoelaceFt2(xy),
      perimeter_ft: perimeterFt(xy),
      kind: sectionKinds[i] || 'main',
    }
  }).sort((a, b) => b.footprint_sqft - a.footprint_sqft)

  // Assign each internal line to the structure containing its midpoint.
  const ridges: LatLng[][][] = cands.map(() => [])
  const hips: LatLng[][][] = cands.map(() => [])
  const valleys: LatLng[][][] = cands.map(() => [])
  const rakes: LatLng[][][] = cands.map(() => [])

  const assignLine = (bucket: LatLng[][][]) => (line: LatLng[]) => {
    if (!line || line.length < 2) return
    const mid = midLatLng(line)
    const midXY = projectLatLngToMeters([mid], cosLat, refLat, refLng)[0]
    let chosen = 0
    for (let i = 0; i < cands.length; i++) {
      if (pointInPolygon(midXY, cands[i].eavesXY)) { chosen = i; break }
    }
    bucket[chosen].push(line)
  }
  ;(rt.ridges || []).forEach(assignLine(ridges))
  ;(rt.hips || []).forEach(assignLine(hips))
  ;(rt.valleys || []).forEach(assignLine(valleys))
  ;(rt.rakes || []).forEach(assignLine(rakes))

  // Route each dormer polygon to whichever structure contains its centroid,
  // so multi-structure traces don't end up rendering a dormer on the wrong
  // building. Mirrors the 2D template's dormersForPartition logic.
  const dormersPerStruct: Array<Array<{ polygon: LatLng[]; pitch_rise: number; label?: string }>> = cands.map(() => [])
  const rtDormers: any[] = Array.isArray((rt as any).dormers) ? (rt as any).dormers : []
  for (const d of rtDormers) {
    if (!d || !Array.isArray(d.polygon) || d.polygon.length < 3) continue
    const cx = d.polygon.reduce((s: number, p: LatLng) => s + p.lat, 0) / d.polygon.length
    const cy = d.polygon.reduce((s: number, p: LatLng) => s + p.lng, 0) / d.polygon.length
    const midXY = projectLatLngToMeters([{ lat: cx, lng: cy }], cosLat, refLat, refLng)[0]
    let chosen = 0
    for (let i = 0; i < cands.length; i++) {
      if (pointInPolygon(midXY, cands[i].eavesXY)) { chosen = i; break }
    }
    dormersPerStruct[chosen].push({
      polygon: d.polygon,
      pitch_rise: typeof d.pitch_rise === 'number' ? d.pitch_rise : 0,
      label: typeof d.label === 'string' ? d.label : undefined,
    })
  }

  const totalFootprint = cands.reduce((s, c) => s + c.footprint_sqft, 0) || 1
  const labels = ['Main House', 'Detached Garage', 'Detached Structure', 'Additional Structure', 'Additional Structure', 'Additional Structure']

  const haversineFt = (a: LatLng, b: LatLng) => {
    const dLat = (b.lat - a.lat) * Math.PI / 180
    const dLng = (b.lng - a.lng) * Math.PI / 180
    const lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180
    const k = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
    return 2 * 6371000 * Math.asin(Math.sqrt(k)) * (1 / 0.3048)
  }
  const polylineLF = (lines: LatLng[][]) => {
    let total = 0
    for (const line of lines) {
      for (let i = 0; i < line.length - 1; i++) total += haversineFt(line[i], line[i + 1])
    }
    return total
  }
  const eaveLF = (poly: LatLng[]) => {
    let total = 0
    for (let i = 0; i < poly.length; i++) total += haversineFt(poly[i], poly[(i + 1) % poly.length])
    return total
  }

  // Independent counters so lower-tier lips read "Lower Eave 1, 2…" while
  // main extras follow the legacy "Main House / Detached Garage / …" track.
  let lowerEaveN = 0
  let mainN = 0
  return cands.map((c, i) => {
    const trueArea = c.footprint_sqft * slopeMult
    const partitionLabel = c.kind === 'lower_tier'
      ? `Lower Eave ${++lowerEaveN}`
      : (labels[mainN] || `Structure ${mainN + 1}`)
    if (c.kind !== 'lower_tier') mainN++
    return {
      index: i + 1,
      label: partitionLabel,
      kind: c.kind,
      eaves: c.eaves,
      ridges: ridges[i],
      hips: hips[i],
      valleys: valleys[i],
      rakes: rakes[i],
      footprint_sqft: Math.round(c.footprint_sqft),
      true_area_sqft: Math.round(trueArea),
      perimeter_ft: Math.round(c.perimeter_ft * 10) / 10,
      dominant_pitch_deg: dominantPitchDeg,
      dominant_pitch_label: dominantPitchLabel,
      area_share: c.footprint_sqft / totalFootprint,
      eave_lf: Math.round(eaveLF(c.eaves) * 10) / 10,
      ridge_lf: Math.round(polylineLF(ridges[i]) * 10) / 10,
      hip_lf: Math.round(polylineLF(hips[i]) * 10) / 10,
      valley_lf: Math.round(polylineLF(valleys[i]) * 10) / 10,
      rake_lf: Math.round(polylineLF(rakes[i]) * 10) / 10,
      dormers: dormersPerStruct[i].length ? dormersPerStruct[i] : undefined,
    }
  })
}

// ───────────────────────── EAVE SIMPLIFICATION ─────────────────────────

/**
 * Local denoising pass for the projected metres-frame eave polygon used by
 * the mesh builder. The server-side trace enhancer applies the same idea on
 * the raw lat/lng — this is a defensive second pass so even legacy traces
 * stored before the enhancer shipped render cleanly.
 *
 * Drops sub-`minEdgeM` edges (digitization wiggles) and merges adjacent
 * edges whose bearings differ by less than `angleThreshDeg` (collinear runs
 * the user dragged through with extra clicks). Refuses to drop below 3
 * vertices.
 */
function simplifyEavesXY(
  pts: { x: number; y: number }[],
  angleThreshDeg = 8,
  minEdgeM = 0.6,
  anchorXYs: { x: number; y: number }[] = [],
  anchorTolM = 0.6,
): { x: number; y: number }[] {
  if (pts.length < 4) return pts
  let work = pts.slice()

  // Anchors are ridge/hip/valley endpoints in the same local-meters frame as
  // pts. We refuse to collapse any vertex within `anchorTolM` of one — the
  // mesh builder needs those corners intact so internal lines attach
  // correctly. Without this guard the upper-left of an L-shape gets eaten
  // when a tiny digitization jog sits next to a hip endpoint, and the 3D
  // axo renders that mass as visually detached (Foxhaven order 295).
  const anchorTolSq = anchorTolM * anchorTolM
  const isAnchored = (p: { x: number; y: number }) => {
    for (const a of anchorXYs) {
      const dx = a.x - p.x, dy = a.y - p.y
      if (dx * dx + dy * dy <= anchorTolSq) return true
    }
    return false
  }

  // Tiny-edge pass.
  for (let pass = 0; pass < 3; pass++) {
    if (work.length < 4) break
    let dropIdx = -1
    let shortest = Infinity
    for (let i = 0; i < work.length; i++) {
      const a = work[i]
      const b = work[(i + 1) % work.length]
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      // Picking which endpoint to remove: the unanchored one. If both anchored,
      // skip the pair entirely.
      const removeIdx = (i + 1) % work.length
      if (len < minEdgeM && len < shortest && !isAnchored(work[removeIdx])) {
        shortest = len; dropIdx = i
      }
    }
    if (dropIdx < 0) break
    work.splice((dropIdx + 1) % work.length, 1)
  }

  // Small-jog smoother — handles runs of 3+ consecutive short edges with
  // alternating ~perpendicular bearings (a true staircase). Replaces the
  // run with its chord when none of the run's interior vertices are
  // anchored. Targets the south-eave staircase on 75 Foxhaven (3.5/6.4/
  // 7.9/6.4/5.6 ft jogs) which the collinear-merge pass below can't touch
  // (90° corners are by definition non-collinear).
  const SHORT_EDGE_M = 2.5
  const MIN_RUN = 3
  for (let pass = 0; pass < 2; pass++) {
    const n = work.length
    if (n < 6) break
    const edgeLen = (i: number) => Math.hypot(work[(i + 1) % n].x - work[i].x, work[(i + 1) % n].y - work[i].y)
    let smoothed = false
    let i = 0
    while (i < n) {
      if (edgeLen(i) >= SHORT_EDGE_M) { i++; continue }
      // Walk forward while edges stay short.
      let j = i
      while (edgeLen(j) < SHORT_EDGE_M && (j - i) < n) j++
      const runLen = j - i + 1   // inclusive of vertex j
      if (runLen >= MIN_RUN + 1) {
        // Vertices i .. j; collapse interior vertices (i+1 .. j-1) if unanchored.
        const interior: number[] = []
        let blocked = false
        for (let k = i + 1; k < j; k++) {
          const idx = k % n
          if (isAnchored(work[idx])) { blocked = true; break }
          interior.push(idx)
        }
        if (!blocked && interior.length > 0) {
          const set = new Set(interior)
          work = work.filter((_, idx) => !set.has(idx))
          smoothed = true
          break  // restart pass — indices shifted
        }
      }
      i = j + 1
    }
    if (!smoothed) break
  }

  // Collinear-merge pass.
  for (let pass = 0; pass < 3; pass++) {
    const n = work.length
    if (n < 4) break
    const drop = new Set<number>()
    for (let i = 0; i < n; i++) {
      if (isAnchored(work[i])) continue
      const prev = (i - 1 + n) % n
      const next = (i + 1) % n
      if (drop.has(prev) || drop.has(next)) continue
      const b1 = Math.atan2(work[i].y - work[prev].y, work[i].x - work[prev].x) * 180 / Math.PI
      const b2 = Math.atan2(work[next].y - work[i].y, work[next].x - work[i].x) * 180 / Math.PI
      let d = Math.abs(b1 - b2) % 360
      if (d > 180) d = 360 - d
      if (d < angleThreshDeg) drop.add(i)
    }
    if (drop.size === 0) break
    if (n - drop.size < 3) break
    work = work.filter((_, i) => !drop.has(i))
  }

  return work
}

// ───────────────────────── SLIVER DETECTION ─────────────────────────

/**
 * A "sliver" face is a long thin polygon — almost always a degenerate
 * artifact, not a real roof plane. Caused by the run-grouping pass when
 * an eave edge gets assigned to a structurally-distant ridge: the projected
 * ridge endpoints collapse near each other while the eave corners stay
 * far away, producing a tall narrow quad/triangle that the renderer then
 * highlights with a ridge-red top edge.
 *
 * The Foxboro Crescent report (00000193) showed two such slivers
 * spanning the polygon interior — ~24 ft tall, ~3 ft wide, ~30–40 sqft.
 *
 * Thresholds chosen so legitimate small hip-end triangles (typically
 * 6–10 ft sides, near-equilateral, 12–25 sqft) are NEVER dropped.
 */
export function isSliverFace(face: { vertices: { x: number; y: number; z: number }[]; area_sqft: number }): boolean {
  const verts = face.vertices
  if (verts.length < 3) return true
  // Use XY bounding box — the world-space coords before axonometric projection.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const v of verts) {
    if (v.x < minX) minX = v.x
    if (v.x > maxX) maxX = v.x
    if (v.y < minY) minY = v.y
    if (v.y > maxY) maxY = v.y
  }
  const w = maxX - minX
  const h = maxY - minY
  const longer = Math.max(w, h)
  const shorter = Math.min(w, h)
  if (shorter < 1e-6) return true              // 1D degenerate
  const aspect = longer / shorter
  // Sliver = long-thin AND small-area. Both conditions required so a
  // legitimate long ridge face (e.g., 30 ft × 6 ft, 180 sqft) survives.
  // For the 7611 183 St NW class of artifact (wider triangular wedges),
  // the footprint-containment filter at the end of buildRoofMesh catches
  // them via centroid-outside-polygon, not this aspect check.
  return aspect > 5 && shorter < 1.2 && face.area_sqft < 50
}

/**
 * Point-in-polygon (ray-casting) on the XY plane. Used to validate that a
 * generated face's centroid actually sits over the eaves footprint — faces
 * whose centroids fall outside the polygon are geometric artifacts (Pass 3
 * quad overshoot, Pass 4 hip-bridge spans) and must be dropped.
 */
function pointInPoly(p: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let inside = false
  const n = poly.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x, yi = poly[i].y
    const xj = poly[j].x, yj = poly[j].y
    const intersect = ((yi > p.y) !== (yj > p.y)) &&
      (p.x < (xj - xi) * (p.y - yi) / ((yj - yi) || 1e-9) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

/**
 * Distance from point to polygon edge (XY). Returns 0 if inside.
 * Used to grant a small tolerance buffer before declaring a face out-of-bounds.
 */
function distToPolyEdge(p: { x: number; y: number }, poly: { x: number; y: number }[]): number {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    const abx = b.x - a.x, aby = b.y - a.y
    const lenSq = abx * abx + aby * aby
    let t = lenSq < 1e-9 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq
    t = Math.max(0, Math.min(1, t))
    const cx = a.x + t * abx, cy = a.y + t * aby
    const d = Math.hypot(p.x - cx, p.y - cy)
    if (d < best) best = d
  }
  return best
}

// ───────────────────────── 3D MESH BUILDER ─────────────────────────

interface V3 { x: number; y: number; z: number }
interface Face3 {
  vertices: V3[]
  pitch_rise: number     // rise per 12
  pitch_deg: number
  /** Outward-facing normal (downslope) */
  normal: V3
  /** sloped area sqft (for color/sort weight) */
  area_sqft: number
  /** centroid for painter's sort */
  centroid: V3
  edges?: { a: V3; b: V3; type: 'EAVE' | 'RIDGE' | 'HIP' | 'VALLEY' | 'RAKE' }[]
}

/**
 * Merge ridge segments that are collinear (or near-collinear) on the same
 * logical spine. Two segments are "co-spinal" when:
 *   - their direction vectors are parallel (|cos θ| > 0.95)
 *   - the perpendicular distance from one segment's midpoint to the other's
 *     infinite line is small (< 1.2 m)
 *
 * For each cluster, replace all member segments with a single segment from
 * the leftmost endpoint to the rightmost (along the cluster's mean axis).
 *
 * Why: compound hip roofs are traced as two parallel ridges with a valley
 * between (the cross-gable saddle). Treating them as one logical ridge in
 * Pass 1 stops the run-grouping pass from flipping eave assignments back
 * and forth, which was the root cause of the cross-roof "translucent
 * triangle" artifacts on report 00000203 (63 Chestermere Crescent).
 */
/**
 * Drop ridge segments that are clearly user-tracing jogs, not real ridges.
 *
 * A "jog" segment is one a user accidentally introduced when clicking the
 * spine in multiple pieces — a tiny perpendicular stub at the joint between
 * two longer collinear ridges. Without dropping it, mergeParallelRidges
 * leaves three logical-spine segments (with one perpendicular stub) standing,
 * and Pass 1's nearest-ridge assignment then pulls eaves toward the
 * perpendicular stub, producing visibly broken faces (order 211 / 58
 * Foxboro Bay was the canonical case — a 1.24m horizontal stub between two
 * 5–7m N–S spine segments dragged right-side eaves into a rogue right block).
 *
 * To qualify as a jog (so it can't accidentally drop a real perpendicular
 * cross-ridge), a segment must satisfy ALL of:
 *   1. length ≤ max(1.5m, 0.25 × longest segment)
 *   2. both endpoints sit within 0.5m of an endpoint of two OTHER segments
 *   3. it is roughly perpendicular (|cos| ≤ 0.5) to both of those neighbours
 *
 * Real perpendicular ridges (T/L houses) are either long enough to fail (1),
 * or only meet one neighbour at one endpoint, so they fail (2).
 */
function dropRidgeJogs(
  segs: { a: { x: number; y: number }; b: { x: number; y: number } }[],
): { a: { x: number; y: number }; b: { x: number; y: number } }[] {
  if (segs.length < 3) return segs
  const ENDPOINT_SNAP_M = 0.5
  const PERP_COS_MAX = 0.5
  const lengths = segs.map(s => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y))
  const longest = Math.max(...lengths)
  const SHORT_MAX = Math.max(1.5, 0.25 * longest)

  const dirOf = (s: { a: { x: number; y: number }; b: { x: number; y: number } }) => {
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y
    const len = Math.hypot(dx, dy) || 1
    return { x: dx / len, y: dy / len }
  }

  const out: typeof segs = []
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    if (lengths[i] > SHORT_MAX) { out.push(s); continue }

    // Find a different segment whose endpoint is near s.a, and another
    // whose endpoint is near s.b. They must be two distinct segments.
    const dirS = dirOf(s)
    let neighbourA = -1, neighbourB = -1
    for (let j = 0; j < segs.length; j++) {
      if (j === i) continue
      const t = segs[j]
      const nearAa = Math.hypot(t.a.x - s.a.x, t.a.y - s.a.y) < ENDPOINT_SNAP_M
      const nearAb = Math.hypot(t.b.x - s.a.x, t.b.y - s.a.y) < ENDPOINT_SNAP_M
      if (neighbourA < 0 && (nearAa || nearAb)) neighbourA = j
      const nearBa = Math.hypot(t.a.x - s.b.x, t.a.y - s.b.y) < ENDPOINT_SNAP_M
      const nearBb = Math.hypot(t.b.x - s.b.x, t.b.y - s.b.y) < ENDPOINT_SNAP_M
      if (neighbourB < 0 && j !== neighbourA && (nearBa || nearBb)) neighbourB = j
    }
    if (neighbourA < 0 || neighbourB < 0) { out.push(s); continue }

    const dirA = dirOf(segs[neighbourA])
    const dirB = dirOf(segs[neighbourB])
    const cosA = Math.abs(dirS.x * dirA.x + dirS.y * dirA.y)
    const cosB = Math.abs(dirS.x * dirB.x + dirS.y * dirB.y)
    if (cosA <= PERP_COS_MAX && cosB <= PERP_COS_MAX) {
      // Skip this jog — both neighbours are roughly perpendicular to it
      // AND they sit at its endpoints, so it's a digitization artifact.
      continue
    }
    out.push(s)
  }
  return out
}

function mergeParallelRidges(
  segs: { a: { x: number; y: number }; b: { x: number; y: number } }[],
): { a: { x: number; y: number }; b: { x: number; y: number } }[] {
  if (segs.length < 2) return segs
  const PARALLEL_COS = 0.95
  // Adaptive perpendicular-distance tolerance. Scales with the mean segment
  // length so two collinear-ish 7m ridges with 1.4m of tracing drift still
  // collapse into one (Foxboro 58 case), while hard-capping at 2.0m so two
  // unrelated parallel ridges on a real compound house never get merged.
  const meanLen = segs.reduce((s, r) => s + Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y), 0) / segs.length
  const PERP_MAX_M = Math.min(2.0, Math.max(1.2, 0.20 * meanLen))
  const used = new Array(segs.length).fill(false)
  const out: { a: { x: number; y: number }; b: { x: number; y: number } }[] = []
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue
    const cluster = [segs[i]]
    used[i] = true
    const aiX = segs[i].b.x - segs[i].a.x, aiY = segs[i].b.y - segs[i].a.y
    const aiLen = Math.hypot(aiX, aiY) || 1
    const dirX = aiX / aiLen, dirY = aiY / aiLen
    for (let j = i + 1; j < segs.length; j++) {
      if (used[j]) continue
      const bjX = segs[j].b.x - segs[j].a.x, bjY = segs[j].b.y - segs[j].a.y
      const bjLen = Math.hypot(bjX, bjY) || 1
      const cos = Math.abs(dirX * bjX + dirY * bjY) / bjLen
      if (cos < PARALLEL_COS) continue
      // Perpendicular distance from segs[j]'s midpoint to segs[i]'s line.
      const mx = (segs[j].a.x + segs[j].b.x) / 2
      const my = (segs[j].a.y + segs[j].b.y) / 2
      const ex = mx - segs[i].a.x, ey = my - segs[i].a.y
      const along = ex * dirX + ey * dirY
      const perpX = ex - along * dirX, perpY = ey - along * dirY
      const perpDist = Math.hypot(perpX, perpY)
      if (perpDist > PERP_MAX_M) continue
      cluster.push(segs[j])
      used[j] = true
    }
    if (cluster.length === 1) {
      out.push(segs[i])
      continue
    }
    // Project all cluster endpoints onto the seed segment's axis and take
    // the extreme along-axis points as the merged segment's endpoints.
    let tMin = Infinity, tMax = -Infinity
    let pMin = segs[i].a, pMax = segs[i].b
    const meanY0 = cluster.reduce((s, c) => s + (c.a.y + c.b.y) / 2, 0) / cluster.length
    const meanX0 = cluster.reduce((s, c) => s + (c.a.x + c.b.x) / 2, 0) / cluster.length
    for (const c of cluster) {
      for (const p of [c.a, c.b]) {
        const t = (p.x - segs[i].a.x) * dirX + (p.y - segs[i].a.y) * dirY
        if (t < tMin) { tMin = t; pMin = p }
        if (t > tMax) { tMax = t; pMax = p }
      }
    }
    // Use mean-perpendicular position so the merged ridge sits between the
    // parallel cluster members (not on top of the seed).
    const seedX0 = segs[i].a.x, seedY0 = segs[i].a.y
    const offsetAlongMin = tMin
    const offsetAlongMax = tMax
    const perpOffsetX = meanX0 - (seedX0 + ((tMin + tMax) / 2) * dirX)
    const perpOffsetY = meanY0 - (seedY0 + ((tMin + tMax) / 2) * dirY)
    out.push({
      a: { x: seedX0 + offsetAlongMin * dirX + perpOffsetX, y: seedY0 + offsetAlongMin * dirY + perpOffsetY },
      b: { x: seedX0 + offsetAlongMax * dirX + perpOffsetX, y: seedY0 + offsetAlongMax * dirY + perpOffsetY },
    })
  }
  return out
}

/**
 * Build a folded roof mesh.
 *
 *   - When user-traced ridges are provided, lift their endpoints to ridge
 *     height and associate each eave edge with the closest ridge segment.
 *     The result respects the actual roof shape the user drew.
 *   - When no ridges are present, fall back to a hip-roof approximation
 *     (longest-axis ridge for rectangles, pyramid for non-rectangles).
 */
function buildRoofMesh(
  rawEavesXY: { x: number; y: number }[],
  pitch_rise: number,
  tracedRidgesXY: { x: number; y: number }[][],
  tracedHipsXY: { x: number; y: number }[][] = [],
  tracedValleysXY: { x: number; y: number }[][] = [],
): Face3[] {
  // Defensive cleanup: collapse near-collinear vertices, drop tiny digitization
  // jogs, and smooth small-jog staircases. Anchor-aware — vertices that
  // anchor a traced ridge/hip/valley endpoint are preserved so the run-
  // grouping pass in `buildRoofMesh` keeps facet connectivity intact.
  // (Without anchor preservation, an L-shape with a tiny perpendicular
  // jog next to a hip corner can render as a visually-detached mass —
  // 75 Foxhaven order 295.)
  const anchorEndpoints: { x: number; y: number }[] = []
  for (const r of tracedRidgesXY) if (r && r.length) { anchorEndpoints.push(r[0], r[r.length - 1]) }
  for (const h of tracedHipsXY)   if (h && h.length) { anchorEndpoints.push(h[0], h[h.length - 1]) }
  for (const v of tracedValleysXY) if (v && v.length) { anchorEndpoints.push(v[0], v[v.length - 1]) }
  const eavesXY = simplifyEavesXY(rawEavesXY, 8, 0.6, anchorEndpoints, 0.6)
  const n = eavesXY.length
  if (n < 3) return []

  // Bounding box → ridge height = (shorter span / 2) × (pitch_rise/12)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of eavesXY) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
  }
  const w = maxX - minX
  const h = maxY - minY
  const shortSideM = Math.min(w, h)
  const ridgeHeightM = (shortSideM / 2) * (pitch_rise / 12)

  // ── PATH A: traced ridges available ──
  // 5-pass algorithm: assign each eave edge to its nearest ridge, smooth
  // singleton runs caused by short jogs in the trace, group consecutive
  // same-assignment edges into runs, emit ONE face per run (the previous
  // one-face-per-edge approach produced a "lightning bolt" zigzag on
  // multi-ridge roofs), and stitch hip triangles at run boundaries using
  // traced hip endpoints when available.
  if (tracedRidgesXY && tracedRidgesXY.length > 0) {
    const rawRidgeSegs: { a: { x: number; y: number }; b: { x: number; y: number } }[] = []
    for (const ridge of tracedRidgesXY) {
      if (!ridge || ridge.length < 2) continue
      for (let i = 0; i < ridge.length - 1; i++) {
        rawRidgeSegs.push({ a: ridge[i], b: ridge[i + 1] })
      }
    }
    // Pre-merge cleanup: drop tiny perpendicular jog segments that the user
    // introduced when clicking a single logical spine in multiple pieces
    // (Foxboro 58 / order 211 — a 1.24m perpendicular stub between two
    // 5–7m N–S spine segments). Real perpendicular ridges survive because
    // they are either long, or only meet one neighbour endpoint.
    const cleanedRidgeSegs = dropRidgeJogs(rawRidgeSegs)
    // Pre-merge: combine collinear / near-parallel ridge segments that sit
    // on the same logical roof spine. Compound hips like 63 Chestermere
    // Crescent are traced as two short parallel ridges with a valley
    // between, but for face assignment they should be ONE long ridge —
    // otherwise each eave edge gets pulled toward its arbitrarily-nearer
    // segment and runs flip back and forth.
    const ridgeSegs = mergeParallelRidges(cleanedRidgeSegs)
    const hipSegs: { a: { x: number; y: number }; b: { x: number; y: number } }[] = []
    for (const hip of tracedHipsXY) {
      if (!hip || hip.length < 2) continue
      for (let i = 0; i < hip.length - 1; i++) hipSegs.push({ a: hip[i], b: hip[i + 1] })
    }
    const valleySegs: { a: { x: number; y: number }; b: { x: number; y: number } }[] = []
    for (const vly of tracedValleysXY) {
      if (!vly || vly.length < 2) continue
      for (let i = 0; i < vly.length - 1; i++) valleySegs.push({ a: vly[i], b: vly[i + 1] })
    }

    if (ridgeSegs.length > 0) {
      const SHARED_APEX_M = 0.6   // run-end projections within this distance → triangle
      const SHORT_EDGE_M = 2.5    // singleton runs shorter than this absorb into neighbours
      const HIP_SNAP_M = 1.0      // hip endpoint match radius
      const VALLEY_SNAP_M = 1.0   // valley proximity for inboard clipping
      // Pass 1 distance guard: an eave edge whose nearest ridge midpoint is
      // farther than this is structurally not "served" by any ridge — its
      // projected ridge endpoints would form a sliver. Treat it as a no-ridge
      // run and apex-fold it locally instead. Calibrated against the
      // shorter span of the polygon so it scales with house size.
      const RIDGE_FAR_M = 0.6 * shortSideM

      const projectOnto = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
        const abx = b.x - a.x, aby = b.y - a.y
        const lenSq = abx * abx + aby * aby
        if (lenSq < 1e-9) return { x: a.x, y: a.y, t: 0, d: Math.hypot(p.x - a.x, p.y - a.y) }
        let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq
        t = Math.max(0, Math.min(1, t))
        const cx = a.x + t * abx, cy = a.y + t * aby
        return { x: cx, y: cy, t, d: Math.hypot(p.x - cx, p.y - cy) }
      }

      // Same orthogonal projection as projectOnto, but onto the INFINITE line
      // through a→b (no t-clamp). Used only for placing run ridge endpoints
      // (pa / pb) so that an eave run's projected ridge tips extend along
      // the ridge axis instead of collapsing onto a segment endpoint.
      // Without this, a short traced ridge inside a long polygon causes
      // every off-the-end eave to fan-collapse onto the ridge tip.
      const projectOntoLine = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
        const abx = b.x - a.x, aby = b.y - a.y
        const lenSq = abx * abx + aby * aby
        if (lenSq < 1e-9) return { x: a.x, y: a.y, t: 0, d: Math.hypot(p.x - a.x, p.y - a.y) }
        const t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq
        const cx = a.x + t * abx, cy = a.y + t * aby
        return { x: cx, y: cy, t, d: Math.hypot(p.x - cx, p.y - cy) }
      }

      const corners: V3[] = eavesXY.map(p => ({ x: p.x, y: p.y, z: 0 }))
      const faces: Face3[] = []

      // ── Pass 1: assign each eave edge to its nearest *parallel* ridge ──
      // Naive nearest-midpoint flips back and forth between two parallel
      // ridges (compound hip roofs at e.g. 63 Chestermere Crescent), creating
      // non-contiguous runs that emit faces crossing each other in 3D.
      //
      // Instead, score each (edge, ridge) pair as
      //   distance × (1 + 2 × perpendicular_factor)
      // where perpendicular_factor goes from 0 (edge parallel to ridge) to 1
      // (edge perpendicular). An eave that runs *parallel* to a ridge belongs
      // to it; an eave running across the ridge axis does not.
      //
      // assigned[i] = -1 means "no ridge close enough to be structurally
      // valid" — that edge gets a local apex face in Pass 3 instead of a
      // ridge-projected quad (which would be a sliver across the polygon).
      const assigned: number[] = new Array(n)
      const edgeLen: number[] = new Array(n)
      for (let i = 0; i < n; i++) {
        const a = corners[i]
        const b = corners[(i + 1) % n]
        edgeLen[i] = Math.hypot(b.x - a.x, b.y - a.y)
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const eaveDx = b.x - a.x, eaveDy = b.y - a.y
        const eaveLen = Math.hypot(eaveDx, eaveDy) || 1
        let best = 0
        let bestScore = Infinity
        let bestRawDist = Infinity
        for (let j = 0; j < ridgeSegs.length; j++) {
          const rs = ridgeSegs[j]
          const proj = projectOnto(mid, rs.a, rs.b)
          // Perpendicularity: |eave · ridge| / (|eave| × |ridge|) → 1 = parallel, 0 = perpendicular
          const ridgeDx = rs.b.x - rs.a.x, ridgeDy = rs.b.y - rs.a.y
          const ridgeLen = Math.hypot(ridgeDx, ridgeDy) || 1
          const cos = Math.abs(eaveDx * ridgeDx + eaveDy * ridgeDy) / (eaveLen * ridgeLen)
          const perpFactor = 1 - cos                       // 0 parallel … 1 perpendicular
          const score = proj.d * (1 + 2 * perpFactor)
          if (score < bestScore) { bestScore = score; best = j; bestRawDist = proj.d }
        }
        assigned[i] = bestRawDist > RIDGE_FAR_M ? -1 : best
      }

      // ── Pass 1.5: smooth singleton runs ──
      // Short eave segments sandwiched between two long edges with the same
      // ridge assignment are almost always polygon-trace jogs (3–4 ft
      // step-overs). Reassigning them to the dominant neighbour ridge
      // collapses the jog into the surrounding run. Three passes catch the
      // case where the singleton's neighbours are themselves singletons that
      // get cleaned up only on the second pass.
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < n; i++) {
          const prev = (i - 1 + n) % n
          const next = (i + 1) % n
          if (assigned[i] === assigned[prev] || assigned[i] === assigned[next]) continue
          if (assigned[prev] !== assigned[next]) continue
          if (edgeLen[i] >= SHORT_EDGE_M) continue
          assigned[i] = assigned[prev]
        }
      }

      // ── Pass 2: group consecutive same-assignment edges into runs ──
      type Run = { ridgeIdx: number; edgeIdxs: number[] }
      const runs: Run[] = []
      const startBreak = (() => {
        for (let i = 0; i < n; i++) {
          if (assigned[i] !== assigned[(i - 1 + n) % n]) return i
        }
        return 0
      })()
      let cursor = startBreak
      let visited = 0
      while (visited < n) {
        const ridgeIdx = assigned[cursor]
        const run: Run = { ridgeIdx, edgeIdxs: [] }
        while (visited < n && assigned[cursor] === ridgeIdx) {
          run.edgeIdxs.push(cursor)
          cursor = (cursor + 1) % n
          visited++
        }
        runs.push(run)
      }

      // ── Pass 3: emit one face per run ──
      type RunGeom = { firstCornerIdx: number; lastCornerIdx: number; ridgeA: V3; ridgeB: V3 }
      const runGeoms: RunGeom[] = []
      for (const run of runs) {
        const firstEdge = run.edgeIdxs[0]
        const lastEdge = run.edgeIdxs[run.edgeIdxs.length - 1]
        const firstCornerIdx = firstEdge
        const lastCornerIdx = (lastEdge + 1) % n

        const eaveCorners: V3[] = []
        for (const ei of run.edgeIdxs) eaveCorners.push(corners[ei])
        eaveCorners.push(corners[lastCornerIdx])

        // ── No-ridge run: every assigned ridge was structurally too far.
        // Lift the run's eave midpoint to ridge height as a local apex and
        // emit triangles. This produces an honest "tented" look instead of
        // a sliver stretching across the polygon.
        if (run.ridgeIdx === -1) {
          let mx = 0, my = 0
          for (const c of eaveCorners) { mx += c.x; my += c.y }
          mx /= eaveCorners.length; my /= eaveCorners.length
          const apex: V3 = { x: mx, y: my, z: ridgeHeightM }
          for (let k = 0; k < eaveCorners.length - 1; k++) {
            faces.push(makeFace([eaveCorners[k], eaveCorners[k + 1], apex], pitch_rise))
          }
          runGeoms.push({ firstCornerIdx, lastCornerIdx, ridgeA: apex, ridgeB: apex })
          continue
        }

        // ── Pass 5: valley-aware inboard clipping ──
        // If a traced valley is significantly closer to the run's eave
        // midpoints than the assigned ridge, use the valley as the inboard
        // edge. Prevents two faces flanking a valley from extending past
        // each other and overlapping.
        let inboardSeg = ridgeSegs[run.ridgeIdx]
        if (valleySegs.length > 0) {
          let bestRidgeDist = Infinity
          let bestValleyDist = Infinity
          let bestValleySeg = valleySegs[0]
          for (const ei of run.edgeIdxs) {
            const ma = corners[ei]
            const mb = corners[(ei + 1) % n]
            const mid = { x: (ma.x + mb.x) / 2, y: (ma.y + mb.y) / 2 }
            const rp = projectOnto(mid, inboardSeg.a, inboardSeg.b)
            if (rp.d < bestRidgeDist) bestRidgeDist = rp.d
            for (const vs of valleySegs) {
              const vp = projectOnto(mid, vs.a, vs.b)
              if (vp.d < bestValleyDist) { bestValleyDist = vp.d; bestValleySeg = vs }
            }
          }
          // Relaxed from 0.7× to 1.1× — for compound hip roofs (63 Chestermere)
          // the cross-gable eaves sit roughly equidistant from the assigned
          // ridge and the connecting valley. Preferring the valley keeps that
          // face folded inboard instead of bridging across the polygon to a
          // far ridge and producing a giant rogue face.
          if (bestValleyDist < VALLEY_SNAP_M * 2 && bestValleyDist < bestRidgeDist * 1.1) {
            inboardSeg = bestValleySeg
          }
        }

        // Use line-projection (not segment-projection) so eave corners that
        // lie past the end of a short traced ridge extend along the ridge
        // axis instead of collapsing onto its tip. Trapezoid faces, not fan.
        const pa = projectOntoLine(corners[firstCornerIdx], inboardSeg.a, inboardSeg.b)
        const pb = projectOntoLine(corners[lastCornerIdx], inboardSeg.a, inboardSeg.b)
        const ridgeA: V3 = { x: pa.x, y: pa.y, z: ridgeHeightM }
        const ridgeB: V3 = { x: pb.x, y: pb.y, z: ridgeHeightM }

        const isTriangle = Math.hypot(ridgeA.x - ridgeB.x, ridgeA.y - ridgeB.y) < SHARED_APEX_M
        // Pass 3 quad guard: when the projected ridge segment is dramatically
        // wider than the eave run that's supposed to feed it, the resulting
        // quad overshoots the structure boundary and visually overlaps the
        // adjacent face. Fall back to apex triangles built from the run's
        // own midpoint instead — honest geometry, no overshoot.
        let runEaveLen = 0
        for (const ei of run.edgeIdxs) runEaveLen += edgeLen[ei]
        const projRidgeLen = Math.hypot(ridgeA.x - ridgeB.x, ridgeA.y - ridgeB.y)
        // Ridge-endpoint containment guard: if either projected ridge tip
        // sits outside the eaves polygon (>1m beyond), the resulting quad
        // will overshoot the structure — emit apex triangles instead. This
        // is what was producing the huge cross-roof "translucent triangle"
        // artifacts on parallel-ridge compound hips (63 Chestermere).
        const ridgeAOutside = !pointInPoly(ridgeA, eavesXY) && distToPolyEdge(ridgeA, eavesXY) > 1
        const ridgeBOutside = !pointInPoly(ridgeB, eavesXY) && distToPolyEdge(ridgeB, eavesXY) > 1
        const ridgeOutside = ridgeAOutside || ridgeBOutside
        const overshoot = (!isTriangle && runEaveLen > 0.1 && projRidgeLen > runEaveLen * 2) || ridgeOutside
        if (isTriangle || overshoot) {
          const apex: V3 = overshoot
            ? (() => {
                let mx = 0, my = 0
                for (const c of eaveCorners) { mx += c.x; my += c.y }
                return { x: mx / eaveCorners.length, y: my / eaveCorners.length, z: ridgeHeightM }
              })()
            : { x: (ridgeA.x + ridgeB.x) / 2, y: (ridgeA.y + ridgeB.y) / 2, z: ridgeHeightM }
          if (eaveCorners.length === 2) {
            faces.push(makeFace([eaveCorners[0], eaveCorners[1], apex], pitch_rise))
          } else {
            for (let k = 0; k < eaveCorners.length - 1; k++) {
              faces.push(makeFace([eaveCorners[k], eaveCorners[k + 1], apex], pitch_rise))
            }
          }
          // When we collapsed an overshooting quad to apex triangles, the run's
          // ridge endpoints are now both at the apex — record that so Pass 4
          // doesn't try to bridge a phantom gap with a rogue triangle.
          if (overshoot) {
            runGeoms.push({ firstCornerIdx, lastCornerIdx, ridgeA: apex, ridgeB: apex })
            continue
          }
        } else {
          faces.push(makeFace([...eaveCorners, ridgeB, ridgeA], pitch_rise))
        }

        runGeoms.push({ firstCornerIdx, lastCornerIdx, ridgeA, ridgeB })
      }

      // ── Pass 4: hip triangles at run boundaries ──
      // When two adjacent runs meet at corner C, the previous run's ridgeB
      // and the next run's ridgeA may differ (different ridges, no apex).
      // A traced hip should bridge the gap; use its actual upper endpoint
      // when available so the face matches what the user drew.
      if (runGeoms.length > 1) {
        for (let i = 0; i < runGeoms.length; i++) {
          const prev = runGeoms[i]
          const next = runGeoms[(i + 1) % runGeoms.length]
          if (prev.lastCornerIdx !== next.firstCornerIdx) continue
          const C = corners[prev.lastCornerIdx]
          const rEnd = prev.ridgeB
          const rStart = next.ridgeA
          const gap = Math.hypot(rEnd.x - rStart.x, rEnd.y - rStart.y)
          if (gap < SHARED_APEX_M) continue

          let apex: V3 | null = null
          for (const hs of hipSegs) {
            const dA = Math.hypot(hs.a.x - C.x, hs.a.y - C.y)
            const dB = Math.hypot(hs.b.x - C.x, hs.b.y - C.y)
            if (Math.min(dA, dB) >= HIP_SNAP_M) continue
            const upper = dA < dB ? hs.b : hs.a
            const upperToEnd = Math.hypot(upper.x - rEnd.x, upper.y - rEnd.y)
            const upperToStart = Math.hypot(upper.x - rStart.x, upper.y - rStart.y)
            if (Math.min(upperToEnd, upperToStart) < HIP_SNAP_M * 2) {
              apex = { x: upper.x, y: upper.y, z: ridgeHeightM }
              break
            }
          }

          if (apex) {
            const tA = makeFace([C, rEnd, apex], pitch_rise)
            const tB = makeFace([C, apex, rStart], pitch_rise)
            if (!isSliverFace(tA)) faces.push(tA)
            if (!isSliverFace(tB)) faces.push(tB)
          } else {
            // Pass 4 hip-triangle distance guard: if either projected ridge
            // endpoint is far from corner C, the fallback triangle spans an
            // implausibly large region (the artifact in 7611 183 St NW).
            // Better to leave a small visual gap than emit a rogue face.
            const HIP_TRI_MAX_M = 0.5 * shortSideM
            const dToEnd = Math.hypot(rEnd.x - C.x, rEnd.y - C.y)
            const dToStart = Math.hypot(rStart.x - C.x, rStart.y - C.y)
            if (dToEnd <= HIP_TRI_MAX_M && dToStart <= HIP_TRI_MAX_M) {
              const tri = makeFace([C, rEnd, rStart], pitch_rise)
              if (!isSliverFace(tri)) faces.push(tri)
            }
          }
        }
      }

      // Final safety net: drop any face that survived the per-pass guards
      // but still came out as a degenerate sliver, OR whose centroid sits
      // outside the eaves polygon (the Pass 3 / Pass 4 overshoot signature).
      // The 0.5m tolerance keeps legitimate ridge-line apex faces whose
      // centroids land just barely off-edge due to projection rounding.
      return faces.filter(f => {
        if (isSliverFace(f)) return false
        const c = { x: f.centroid.x, y: f.centroid.y }
        if (pointInPoly(c, eavesXY)) return true
        return distToPolyEdge(c, eavesXY) <= 0.5
      })
    }
  }

  // ── PATH B: no ridges → hip-roof from footprint ──
  // Treat the polygon as "near-rectangular" when its area fills ≥ 85% of its
  // axis-aligned bounding box. This catches the common case where the user
  // traced a rectangular building with a couple of extra clicks on a long
  // edge (n=5..8 but visually a rectangle). Building the hip from the bbox
  // gives a single ridge along the long axis instead of a pyramid apex (which
  // is what the old `n !== 4` branch produced — visibly wrong on the
  // McDermid Dr report's main house).
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const corners: V3[] = eavesXY.map(p => ({ x: p.x, y: p.y, z: 0 }))
  const polyAreaM2 = (() => {
    let a = 0
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      a += eavesXY[i].x * eavesXY[j].y - eavesXY[j].x * eavesXY[i].y
    }
    return Math.abs(a) / 2
  })()
  const bboxAreaM2 = w * h
  const fillRatio = bboxAreaM2 > 1e-6 ? polyAreaM2 / bboxAreaM2 : 0
  const isNearRect = fillRatio >= 0.85
  const faces: Face3[] = []

  if (isNearRect) {
    const longestAxisIsX = w >= h
    const ridgeA: V3 = longestAxisIsX
      ? { x: cx - (w - shortSideM) / 2, y: cy, z: ridgeHeightM }
      : { x: cx, y: cy - (h - shortSideM) / 2, z: ridgeHeightM }
    const ridgeB: V3 = longestAxisIsX
      ? { x: cx + (w - shortSideM) / 2, y: cy, z: ridgeHeightM }
      : { x: cx, y: cy + (h - shortSideM) / 2, z: ridgeHeightM }

    // Walk the polygon and group each corner with the closer ridge endpoint.
    // For n > 4 (rectangle traced with extra mid-edge clicks) this still
    // produces two long sides + two hip ends — the only thing we lose is
    // perfect alignment of those mid-edge clicks with the ridge, which is
    // imperceptible at report scale.
    const sideA: V3[] = [], sideB: V3[] = []
    for (const c of corners) {
      const dA = (c.x - ridgeA.x) ** 2 + (c.y - ridgeA.y) ** 2
      const dB = (c.x - ridgeB.x) ** 2 + (c.y - ridgeB.y) ** 2
      if (dA < dB) sideA.push(c); else sideB.push(c)
    }
    if (sideA.length >= 2 && sideB.length >= 2) {
      // Long sides: connect first/last corners of each side to the ridge.
      faces.push(
        makeFace([sideA[0], sideB[0], ridgeB, ridgeA], pitch_rise),
        makeFace([sideB[sideB.length - 1], sideA[sideA.length - 1], ridgeA, ridgeB], pitch_rise),
        // Hip ends: triangle from the two end-most same-side corners to the ridge end.
        makeFace([sideA[0], ridgeA, sideA[sideA.length - 1]], pitch_rise),
        makeFace([sideB[0], sideB[sideB.length - 1], ridgeB], pitch_rise),
      )
    } else {
      // Degenerate split → pyramid fallback.
      const apex: V3 = { x: cx, y: cy, z: ridgeHeightM }
      for (let i = 0; i < n; i++) {
        faces.push(makeFace([corners[i], corners[(i + 1) % n], apex], pitch_rise))
      }
    }
  } else {
    // Truly non-rectangular (L/T/U/odd shapes) — pyramid to centroid is the
    // honest fallback. Without traced ridges we can't infer the spine
    // reliably, and the visible-side faces still read as a pitched roof mass.
    const apex: V3 = { x: cx, y: cy, z: ridgeHeightM }
    for (let i = 0; i < n; i++) {
      faces.push(makeFace([corners[i], corners[(i + 1) % n], apex], pitch_rise))
    }
  }
  return faces
}

// Same height computation buildRoofMesh uses for ridge tops, factored out so
// the renderer can place the footprint coverage base at the correct z.
function ridgeHeightFromMesh(eavesXY: { x: number; y: number }[], pitch_rise: number): number {
  if (eavesXY.length < 3) return 0
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of eavesXY) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
  }
  const shortSideM = Math.min(maxX - minX, maxY - minY)
  return (shortSideM / 2) * (pitch_rise / 12)
}

function makeFace(vertices: V3[], pitch_rise: number): Face3 {
  const cx = vertices.reduce((s, v) => s + v.x, 0) / vertices.length
  const cy = vertices.reduce((s, v) => s + v.y, 0) / vertices.length
  const cz = vertices.reduce((s, v) => s + v.z, 0) / vertices.length
  const u = { x: vertices[1].x - vertices[0].x, y: vertices[1].y - vertices[0].y, z: vertices[1].z - vertices[0].z }
  const v = { x: vertices[2].x - vertices[0].x, y: vertices[2].y - vertices[0].y, z: vertices[2].z - vertices[0].z }
  // Normal = u × v
  let nx = u.y * v.z - u.z * v.y
  let ny = u.z * v.x - u.x * v.z
  let nz = u.x * v.y - u.y * v.x
  const len = Math.hypot(nx, ny, nz) || 1
  nx /= len; ny /= len; nz /= len
  // Force outward-up (z > 0)
  if (nz < 0) { nx = -nx; ny = -ny; nz = -nz }

  // Sloped area: shoelace of polygon projected to its own plane → roughly
  // half the magnitude of the normal cross product before normalising.
  // For triangles this is exact; for quads we approximate as 2× tri.
  const triArea = len / 2 * FT2_PER_M2
  const area_sqft = vertices.length === 3 ? triArea : triArea * 2

  const pitch_deg = Math.acos(Math.max(0, Math.min(1, nz))) * 180 / Math.PI

  return {
    vertices,
    pitch_rise,
    pitch_deg,
    normal: { x: nx, y: ny, z: nz },
    area_sqft,
    centroid: { x: cx, y: cy, z: cz },
  }
}

// ───────────────────────── AXONOMETRIC PROJECTION ─────────────────────────

function projectAxonometric(p: V3): { x: number; y: number; depth: number } {
  // Yaw around Z, then pitch around X (camera tilt down).
  const ry = YAW_DEG * Math.PI / 180
  const rx = PITCH_DEG * Math.PI / 180
  // Rotate around Z (yaw)
  const x1 = p.x * Math.cos(ry) - p.y * Math.sin(ry)
  const y1 = p.x * Math.sin(ry) + p.y * Math.cos(ry)
  const z1 = p.z
  // Rotate around X (pitch — camera looks down)
  const x2 = x1
  const y2 = y1 * Math.cos(rx) + z1 * Math.sin(rx)
  const z2 = -y1 * Math.sin(rx) + z1 * Math.cos(rx)
  // Y is screen-down positive, so flip
  return { x: x2, y: -y2, depth: z2 }
}

// ───────────────────────── COLOR / LIGHTING ─────────────────────────

function pitchBaseColor(pitchRise: number): string {
  for (const [thresh, color] of PITCH_BAND_COLOR) {
    if (pitchRise <= thresh) return color
  }
  return PITCH_BAND_COLOR[PITCH_BAND_COLOR.length - 1][1]
}

function shadeColor(hex: string, factor: number, tintHex?: string): string {
  // factor 0..1.7 (1.0 = unchanged, <1 = darker, >1 = lighter)
  // Optional tintHex blends a structure-specific color over the result at
  // ~12% strength so multiple buildings on the same report read distinct
  // even when their geometry is similar.
  const c = hex.replace('#', '')
  const r = parseInt(c.slice(0, 2), 16)
  const g = parseInt(c.slice(2, 4), 16)
  const b = parseInt(c.slice(4, 6), 16)
  const f = Math.max(0.3, Math.min(1.7, factor))
  const tint = Math.max(-1, Math.min(1, (factor - 1.0) * 1.4))
  const warmR = tint > 0 ? 1 + tint * 0.06 : 1 + tint * 0.02
  const warmG = tint > 0 ? 1 + tint * 0.03 : 1 + tint * 0.01
  const warmB = tint > 0 ? 1 - tint * 0.04 : 1 - tint * 0.06
  let rr = r * f * warmR, gg = g * f * warmG, bb = b * f * warmB
  if (tintHex) {
    const t = tintHex.replace('#', '')
    const tr = parseInt(t.slice(0, 2), 16)
    const tg = parseInt(t.slice(2, 4), 16)
    const tb = parseInt(t.slice(4, 6), 16)
    const mix = 0.12
    rr = rr * (1 - mix) + tr * mix
    gg = gg * (1 - mix) + tg * mix
    bb = bb * (1 - mix) + tb * mix
  }
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  return `rgb(${clamp(rr)},${clamp(gg)},${clamp(bb)})`
}

function lambertFactor(normal: V3): number {
  const dotKey  = normal.x * SUN_KEY.x  + normal.y * SUN_KEY.y  + normal.z * SUN_KEY.z
  const dotFill = normal.x * SUN_FILL.x + normal.y * SUN_FILL.y + normal.z * SUN_FILL.z
  // Wider range (0.55 floor, ~1.65 ceiling) than the prior 0.78/1.41 so
  // face orientation actually reads — the old curve compressed everything
  // into a narrow band of dark grey, hiding ridge/hip/valley geometry.
  return 0.55 + Math.max(0, dotKey) * 0.85 + Math.max(0, dotFill) * 0.25
}

// ───────────────────────── MAIN GENERATOR ─────────────────────────

/**
 * Generate a 3D-look axonometric SVG for a single structure.
 * Pure SVG — prints crisply, no rasterization.
 */
export function generateAxonometricRoofSVG(
  structure: StructurePartition,
  opts: { width?: number; height?: number; showShadow?: boolean; showCompass?: boolean; showDimensions?: boolean; structureIndex?: number } = {},
): string {
  const W = opts.width ?? 1200
  const H = opts.height ?? 750
  const PAD = 48
  const showShadow = opts.showShadow !== false
  const showCompass = opts.showCompass !== false
  const showDimensions = opts.showDimensions !== false
  // Per-structure tint cycles through STRUCTURE_TINT so adjacent
  // buildings on the same report don't render as visual duplicates.
  // structureIndex is passed by generateAllStructureSVGs (and omitted
  // for single-structure callers like the visualizer page, which gets
  // the neutral default).
  const tintHex = typeof opts.structureIndex === 'number'
    ? STRUCTURE_TINT[opts.structureIndex % STRUCTURE_TINT.length]
    : undefined

  if (!structure.eaves || structure.eaves.length < 3) {
    return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;background:#fff"><text x="${W/2}" y="${H/2}" text-anchor="middle" fill="#999" font-size="14" font-family="Inter,sans-serif">Insufficient geometry</text></svg>`
  }

  // Project to local metres centred on this structure.
  const refLat = structure.eaves.reduce((s, p) => s + p.lat, 0) / structure.eaves.length
  const refLng = structure.eaves.reduce((s, p) => s + p.lng, 0) / structure.eaves.length
  const cosLat = Math.cos(refLat * Math.PI / 180)
  const eavesXY = projectLatLngToMeters(structure.eaves, cosLat, refLat, refLng)
  const tracedRidgesXY = (structure.ridges || []).map(r => projectLatLngToMeters(r, cosLat, refLat, refLng))
  const tracedHipsXY = (structure.hips || []).map(hp => projectLatLngToMeters(hp, cosLat, refLat, refLng))
  const tracedValleysXY = (structure.valleys || []).map(v => projectLatLngToMeters(v, cosLat, refLat, refLng))

  // Build mesh — uses traced ridges when available so the roof shape
  // matches what the user actually drew (instead of guessing from the bbox).
  const pitchRise = 12 * Math.tan(structure.dominant_pitch_deg * Math.PI / 180)
  const faces = buildRoofMesh(eavesXY, pitchRise, tracedRidgesXY, tracedHipsXY, tracedValleysXY)

  // Project all vertices to screen plane. Keep the world-space copy too so
  // ridge length callouts can be measured in metres before being formatted.
  type ProjFace = Face3 & { worldVertices: V3[] }
  const projected: ProjFace[] = faces.map(f => ({
    ...f,
    worldVertices: f.vertices,
    vertices: f.vertices.map(v => {
      const p = projectAxonometric(v)
      return { x: p.x, y: p.y, z: p.depth } as V3
    }),
    centroid: (() => {
      const p = projectAxonometric(f.centroid)
      return { x: p.x, y: p.y, z: p.depth } as V3
    })(),
    normal: f.normal,
  }))

  // Footprint outline (z=0) projected for shadow + ground reference.
  const groundOutline = eavesXY.map(p => projectAxonometric({ x: p.x, y: p.y, z: 0 }))

  // Compute screen-space bbox for fit.
  const all: { x: number; y: number }[] = []
  projected.forEach(f => f.vertices.forEach(v => all.push({ x: v.x, y: v.y })))
  groundOutline.forEach(p => all.push({ x: p.x, y: p.y }))
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of all) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
  }
  const drawW = W - PAD * 2
  const drawH = H - PAD * 2 - 28  // reserve bottom strip for label
  const sx = drawW / Math.max(1e-3, maxX - minX)
  const sy = drawH / Math.max(1e-3, maxY - minY)
  const sc = Math.min(sx, sy)
  const oX = PAD + (drawW - (maxX - minX) * sc) / 2 - minX * sc
  const oY = PAD + (drawH - (maxY - minY) * sc) / 2 - minY * sc
  const tx = (x: number) => oX + x * sc
  const ty = (y: number) => oY + y * sc

  // Screen-space sliver filter: a real-world face can render as a degenerate
  // sliver after axonometric projection foreshortening (e.g. a face whose
  // long axis lines up with the camera tilt collapses to a thin strip).
  // Drop any face whose post-projection screen bbox has aspect > 8 AND
  // shorter side < 18 px — the visual artifact threshold above which the
  // human eye unmistakably reads the face as wrong.
  const screenFiltered = projected.filter(f => {
    let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity
    for (const v of f.vertices) {
      const sx = oX + v.x * sc, sy = oY + v.y * sc
      if (sx < mnx) mnx = sx
      if (sx > mxx) mxx = sx
      if (sy < mny) mny = sy
      if (sy > mxy) mxy = sy
    }
    const wPx = mxx - mnx, hPx = mxy - mny
    const longer = Math.max(wPx, hPx), shorter = Math.min(wPx, hPx)
    if (shorter < 0.5) return false                    // 1D / off-screen
    return !(longer / shorter > 8 && shorter < 18)
  })

  // Painter's sort — back-to-front by centroid screen-Y (smaller y = farther
  // away in our axonometric).
  const sortedFaces = [...screenFiltered].sort((a, b) => a.centroid.y - b.centroid.y)

  // ─── BUILD SVG ───

  const FONT = `font-family="Inter,system-ui,-apple-system,sans-serif"`
  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;background:#fff" preserveAspectRatio="xMidYMid meet">`

  // SVG defs (filters, gradients)
  // - ground-shadow: blurred silhouette under the building.
  // - face-ao: blur applied to a darkened-stroke pass laid down BEFORE the
  //   real face polygons. Where two faces share an edge, the dark blurred
  //   strokes accumulate, producing a soft ambient-occlusion crease at hips,
  //   ridges and valleys — the depth cue the old flat-Lambert lacked.
  svg += `<defs>
    <filter id="ground-shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="7"/>
    </filter>
    <filter id="face-ao" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur stdDeviation="1.7"/>
    </filter>
    <linearGradient id="bg-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#F8FAFC"/>
      <stop offset="100%" stop-color="#FFFFFF"/>
    </linearGradient>
    <linearGradient id="wall-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#F1F5F9"/>
      <stop offset="100%" stop-color="#CBD5E1"/>
    </linearGradient>
  </defs>`

  // Background
  svg += `<rect width="${W}" height="${H}" fill="url(#bg-grad)"/>`

  // Ground plane subtle
  svg += `<line x1="${PAD}" y1="${H - 32}" x2="${W - PAD}" y2="${H - 32}" stroke="#E2E8F0" stroke-width="0.5" stroke-dasharray="2,3"/>`

  // Drop shadow under building (silhouette of footprint, blurred + offset).
  if (showShadow) {
    const shadowPts = groundOutline
      .map(p => `${(tx(p.x) + 9).toFixed(1)},${(ty(p.y) + 14).toFixed(1)}`)
      .join(' ')
    svg += `<polygon points="${shadowPts}" fill="rgba(15,23,42,0.22)" filter="url(#ground-shadow)"/>`
  }

  // Faux walls — extrude the silhouette downward to the ground line in a
  // muted grey so the building reads as a 3D mass, not a floating roof.
  // Build wall quads from each ground outline edge to 0.6m below for visual
  // weight.
  // (For simplicity we render the eave outline AT z=0 as the wall top; we
  // don't actually have wall heights, so we draw a thin "skirt" below it.)
  const wallSkirtPx = 8
  for (let i = 0; i < groundOutline.length; i++) {
    const a = groundOutline[i]
    const b = groundOutline[(i + 1) % groundOutline.length]
    const x1 = tx(a.x), y1 = ty(a.y)
    const x2 = tx(b.x), y2 = ty(b.y)
    svg += `<polygon points="${x1.toFixed(1)},${y1.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)} ${x2.toFixed(1)},${(y2 + wallSkirtPx).toFixed(1)} ${x1.toFixed(1)},${(y1 + wallSkirtPx).toFixed(1)}" fill="url(#wall-grad)" stroke="#94A3B8" stroke-width="0.6"/>`
  }

  // Footprint coverage base: lift the entire eave polygon to ridge height
  // and paint it in the dominant pitch tone before any per-face polygon is
  // drawn. Acts as a safety net for complex multi-ridge roofs where the
  // eave-walk algorithm can't classify every interior region (e.g. the
  // central cross-gable saddle on multi-wing houses) — without this, those
  // regions render as bare background white. With this, an unclassified
  // region just reads as a uniform pitched plane, which is honest given we
  // don't have a face polygon for it.
  const baseShade = shadeColor(pitchBaseColor(pitchRise), lambertFactor({ x: 0, y: 0, z: 1 }), tintHex)
  const basePts = eavesXY
    .map(p => projectAxonometric({ x: p.x, y: p.y, z: ridgeHeightFromMesh(eavesXY, pitchRise) }))
    .map(p => `${tx(p.x).toFixed(1)},${ty(p.y).toFixed(1)}`)
    .join(' ')
  svg += `<polygon points="${basePts}" fill="${baseShade}" stroke="#0F172A" stroke-width="0.6" stroke-linejoin="round" stroke-opacity="0.4"/>`

  // Ambient-occlusion underlay: dark blurred strokes that accumulate where
  // adjacent faces share an edge, producing soft creases at hips, ridges and
  // valleys without any per-edge logic. Dialed down from width=4/op=0.45 to
  // width=2/op=0.22 — the previous values were overpowering the face colors,
  // collapsing everything to the same dark silhouette.
  svg += `<g filter="url(#face-ao)">`
  for (const f of sortedFaces) {
    const pts = f.vertices.map(v => `${tx(v.x).toFixed(1)},${ty(v.y).toFixed(1)}`).join(' ')
    svg += `<polygon points="${pts}" fill="none" stroke="#0F172A" stroke-width="2.0" stroke-linejoin="round" stroke-opacity="0.22"/>`
  }
  svg += `</g>`

  // Roof faces (back-to-front).
  for (const f of sortedFaces) {
    const base = pitchBaseColor(f.pitch_rise)
    const shade = shadeColor(base, lambertFactor(f.normal), tintHex)
    const pts = f.vertices.map(v => `${tx(v.x).toFixed(1)},${ty(v.y).toFixed(1)}`).join(' ')
    svg += `<polygon points="${pts}" fill="${shade}" stroke="#0F172A" stroke-width="1.0" stroke-linejoin="round" stroke-opacity="0.7"/>`
  }

  // Highlight ridges + hips: any shared edge between the topmost two faces
  // OR the topmost edge of each face.
  // Pick the highest world-z edge per face (true ridge), draw it bold in
  // ridge red, and remember its world endpoints for the callout pass below.
  type RidgeRender = { aProj: V3; bProj: V3; aWorld: V3; bWorld: V3; lengthFt: number }
  const ridgeRenders: RidgeRender[] = []
  for (const f of sortedFaces) {
    let bestEdgeIdx = -1
    let bestAvgZ = -Infinity
    const verts = f.vertices
    const wverts = (f as ProjFace).worldVertices
    const worldCentroidZ = wverts.reduce((s, v) => s + v.z, 0) / wverts.length
    for (let i = 0; i < verts.length; i++) {
      const aw = wverts[i]
      const bw = wverts[(i + 1) % wverts.length]
      const avgZ = (aw.z + bw.z) / 2
      if (avgZ > worldCentroidZ + 1e-3 && avgZ > bestAvgZ) {
        bestAvgZ = avgZ
        bestEdgeIdx = i
      }
    }
    if (bestEdgeIdx >= 0) {
      const a = verts[bestEdgeIdx]
      const b = verts[(bestEdgeIdx + 1) % verts.length]
      const aw = wverts[bestEdgeIdx]
      const bw = wverts[(bestEdgeIdx + 1) % wverts.length]
      const lengthFt = Math.hypot(bw.x - aw.x, bw.y - aw.y, bw.z - aw.z) * M_TO_FT
      svg += `<line x1="${tx(a.x).toFixed(1)}" y1="${ty(a.y).toFixed(1)}" x2="${tx(b.x).toFixed(1)}" y2="${ty(b.y).toFixed(1)}" stroke="${EDGE_COLOR.RIDGE}" stroke-width="1.8" stroke-linecap="round" stroke-opacity="0.9"/>`
      ridgeRenders.push({ aProj: a, bProj: b, aWorld: aw, bWorld: bw, lengthFt })
    }
  }

  // Eave perimeter on top of walls
  const eavePts = groundOutline
    .map(p => `${tx(p.x).toFixed(1)},${ty(p.y).toFixed(1)}`)
    .join(' ')
  svg += `<polygon points="${eavePts}" fill="none" stroke="${EDGE_COLOR.EAVE}" stroke-width="2.0" stroke-linejoin="round" stroke-opacity="0.95"/>`

  // ── DORMER RAISED VOLUMES ──
  // Each traced dormer becomes a small gabled mass sitting on top of the
  // main roof. The base of the dormer is lifted to roughly the middle of
  // the main slope so it reads as "poking out" of the parent roof; the
  // dormer's own gable rises above that base by its pitch × shorter-span.
  // PCA on the polygon gives the ridge axis, then a Sutherland-Hodgman-
  // style split bisects the polygon into two slope faces. Same NW-key /
  // SE-fill Lambert shading as the main mesh so the lighting is coherent.
  if (structure.dormers && structure.dormers.length > 0) {
    const mainRidgeHeightM = ridgeHeightFromMesh(eavesXY, pitchRise)
    const baseZ = mainRidgeHeightM * 0.45
    type DormerFace = { vertices: V3[]; projVerts: V3[]; centroidY: number; normal: V3; pitch_rise: number }
    const dormerFaces: DormerFace[] = []
    const dormerOverlayDraws: string[] = []
    for (const d of structure.dormers) {
      if (!d.polygon || d.polygon.length < 3) continue
      const dXY = projectLatLngToMeters(d.polygon, cosLat, refLat, refLng)
      if (dXY.length < 3) continue
      // Polygon centroid in world metres.
      const cxD = dXY.reduce((s, p) => s + p.x, 0) / dXY.length
      const cyD = dXY.reduce((s, p) => s + p.y, 0) / dXY.length
      // PCA principal axis = ridge direction.
      let cxx = 0, cyy = 0, cxy = 0
      for (const p of dXY) {
        const dx = p.x - cxD, dy = p.y - cyD
        cxx += dx * dx; cyy += dy * dy; cxy += dx * dy
      }
      const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy)
      const ax = Math.cos(theta), ay = Math.sin(theta)
      const px = -ay, py = ax  // perpendicular
      // Shorter span (perpendicular extent) controls the dormer's own ridge height.
      let pMin = Infinity, pMax = -Infinity
      let tMin = Infinity, tMax = -Infinity
      for (const p of dXY) {
        const tProj = (p.x - cxD) * ax + (p.y - cyD) * ay
        const pProj = (p.x - cxD) * px + (p.y - cyD) * py
        if (tProj < tMin) tMin = tProj
        if (tProj > tMax) tMax = tProj
        if (pProj < pMin) pMin = pProj
        if (pProj > pMax) pMax = pProj
      }
      const shorterSpanM = pMax - pMin
      const dormerPitchRise = d.pitch_rise > 0 ? d.pitch_rise : pitchRise
      const dormerOwnHeightM = (shorterSpanM / 2) * (dormerPitchRise / 12)
      const apexZ = baseZ + dormerOwnHeightM
      // Ridge endpoints inset 6% so the gable corners stay clear of the cheek edges.
      const ridgeInset = (tMax - tMin) * 0.06
      const r1: V3 = { x: cxD + (tMin + ridgeInset) * ax, y: cyD + (tMin + ridgeInset) * ay, z: apexZ }
      const r2: V3 = { x: cxD + (tMax - ridgeInset) * ax, y: cyD + (tMax - ridgeInset) * ay, z: apexZ }
      // Split polygon by the perpendicular-axis line (through centroid, perpendicular = ridge direction).
      // perpDot > 0 → "left half"; < 0 → "right half".
      const perpDot = (p: { x: number; y: number }) => (p.x - cxD) * px + (p.y - cyD) * py
      const leftHalf: { x: number; y: number }[] = []
      const rightHalf: { x: number; y: number }[] = []
      let crossCount = 0
      for (let i = 0; i < dXY.length; i++) {
        const a = dXY[i], b = dXY[(i + 1) % dXY.length]
        const pa = perpDot(a), pb = perpDot(b)
        if (pa >= 0) leftHalf.push(a); else rightHalf.push(a)
        if ((pa >= 0 && pb < 0) || (pa < 0 && pb >= 0)) {
          const tt = pa / (pa - pb)
          const ix = a.x + tt * (b.x - a.x)
          const iy = a.y + tt * (b.y - a.y)
          leftHalf.push({ x: ix, y: iy })
          rightHalf.push({ x: ix, y: iy })
          crossCount++
        }
      }
      const canSplit = crossCount === 2 && leftHalf.length >= 2 && rightHalf.length >= 2
      if (canSplit) {
        // Each half becomes a slope face: half vertices at base_z + the two ridge points at apex_z.
        const buildSlopeFace = (half: { x: number; y: number }[], ridgeFirst: V3, ridgeSecond: V3): DormerFace => {
          // Order: half vertices in their polygon-walk order, then second ridge point,
          // then first — closes the loop on the ridge spine.
          const worldVerts: V3[] = half.map(p => ({ x: p.x, y: p.y, z: baseZ }))
          worldVerts.push(ridgeSecond, ridgeFirst)
          // Surface normal via face triangle (vertices 0,1,2 are enough for the plane).
          const v0 = worldVerts[0], v1 = worldVerts[1], v2 = worldVerts[worldVerts.length - 1]
          const u = { x: v1.x - v0.x, y: v1.y - v0.y, z: v1.z - v0.z }
          const v = { x: v2.x - v0.x, y: v2.y - v0.y, z: v2.z - v0.z }
          let nx = u.y * v.z - u.z * v.y
          let ny = u.z * v.x - u.x * v.z
          let nz = u.x * v.y - u.y * v.x
          const nl = Math.hypot(nx, ny, nz) || 1
          nx /= nl; ny /= nl; nz /= nl
          if (nz < 0) { nx = -nx; ny = -ny; nz = -nz }
          const projVerts: V3[] = worldVerts.map(wv => {
            const proj = projectAxonometric(wv)
            return { x: proj.x, y: proj.y, z: proj.depth }
          })
          const cyAvg = projVerts.reduce((s, p) => s + p.y, 0) / projVerts.length
          return { vertices: worldVerts, projVerts, centroidY: cyAvg, normal: { x: nx, y: ny, z: nz }, pitch_rise: dormerPitchRise }
        }
        dormerFaces.push(buildSlopeFace(leftHalf, r1, r2))
        dormerFaces.push(buildSlopeFace(rightHalf, r2, r1))
      } else {
        // Fallback: triangle dormer or non-convex — render as a single lifted flat patch.
        // Still better than absorbing into the main mesh.
        const worldVerts: V3[] = dXY.map(p => ({ x: p.x, y: p.y, z: baseZ + dormerOwnHeightM * 0.6 }))
        const projVerts = worldVerts.map(wv => {
          const proj = projectAxonometric(wv)
          return { x: proj.x, y: proj.y, z: proj.depth }
        })
        const cyAvg = projVerts.reduce((s, p) => s + p.y, 0) / projVerts.length
        dormerFaces.push({ vertices: worldVerts, projVerts, centroidY: cyAvg, normal: { x: 0, y: 0, z: 1 }, pitch_rise: dormerPitchRise })
      }
      // Pitch pill on top of the dormer ridge.
      if (canSplit && showDimensions) {
        const rMid: V3 = { x: (r1.x + r2.x) / 2, y: (r1.y + r2.y) / 2, z: apexZ }
        const m = projectAxonometric(rMid)
        const lbl = (d.label || 'Dormer').replace(/^Dormer\s+/, 'D-')
        const pitchLbl = `${(dormerPitchRise % 1 === 0) ? dormerPitchRise.toFixed(0) : dormerPitchRise.toFixed(1)}:12`
        const pillW = Math.max(44, lbl.length * 5.4 + 18)
        dormerOverlayDraws.push(
          `<g transform="translate(${tx(m.x).toFixed(1)},${ty(m.y).toFixed(1)})">` +
          `<rect x="${(-pillW / 2).toFixed(1)}" y="-11" width="${pillW.toFixed(1)}" height="22" rx="11" fill="#6d28d9" stroke="#fff" stroke-width="0.9"/>` +
          `<text x="0" y="-1.5" text-anchor="middle" font-size="8" font-weight="800" fill="#fff" ${FONT}>${lbl}</text>` +
          `<text x="0" y="8" text-anchor="middle" font-size="7.5" font-weight="700" fill="#fff" fill-opacity="0.96" ${FONT}>${pitchLbl}</text>` +
          `</g>`
        )
      }
    }

    // Painter's sort dormer faces back-to-front, then draw.
    dormerFaces.sort((a, b) => a.centroidY - b.centroidY)
    for (const face of dormerFaces) {
      const pointsStr = face.projVerts.map(v => `${tx(v.x).toFixed(1)},${ty(v.y).toFixed(1)}`).join(' ')
      const base = pitchBaseColor(face.pitch_rise)
      const lit = lambertFactor(face.normal)
      // Subtle lavender tint so dormers remain visually distinct from the main mesh.
      const fill = shadeColor(base, lit, '#7C3AED')
      svg += `<polygon points="${pointsStr}" fill="${fill}" stroke="#4C1D95" stroke-width="0.8" stroke-linejoin="round" stroke-opacity="0.55"/>`
    }
    // Ridge line per dormer (drawn after faces so it sits on top).
    for (const d of structure.dormers) {
      if (!d.polygon || d.polygon.length < 3) continue
      const dXY = projectLatLngToMeters(d.polygon, cosLat, refLat, refLng)
      if (dXY.length < 3) continue
      const cxD = dXY.reduce((s, p) => s + p.x, 0) / dXY.length
      const cyD = dXY.reduce((s, p) => s + p.y, 0) / dXY.length
      let cxx = 0, cyy = 0, cxy = 0
      for (const p of dXY) {
        const dx = p.x - cxD, dy = p.y - cyD
        cxx += dx * dx; cyy += dy * dy; cxy += dx * dy
      }
      const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy)
      const ax = Math.cos(theta), ay = Math.sin(theta)
      const px = -ay, py = ax
      let pMin = Infinity, pMax = -Infinity, tMin = Infinity, tMax = -Infinity
      for (const p of dXY) {
        const tp = (p.x - cxD) * ax + (p.y - cyD) * ay
        const pp = (p.x - cxD) * px + (p.y - cyD) * py
        if (tp < tMin) tMin = tp
        if (tp > tMax) tMax = tp
        if (pp < pMin) pMin = pp
        if (pp > pMax) pMax = pp
      }
      const shorterSpanM = pMax - pMin
      const dormerPitchRise = d.pitch_rise > 0 ? d.pitch_rise : pitchRise
      const dormerOwnHeightM = (shorterSpanM / 2) * (dormerPitchRise / 12)
      const apexZ = baseZ + dormerOwnHeightM
      const ridgeInset = (tMax - tMin) * 0.06
      const r1: V3 = { x: cxD + (tMin + ridgeInset) * ax, y: cyD + (tMin + ridgeInset) * ay, z: apexZ }
      const r2: V3 = { x: cxD + (tMax - ridgeInset) * ax, y: cyD + (tMax - ridgeInset) * ay, z: apexZ }
      const p1 = projectAxonometric(r1), p2 = projectAxonometric(r2)
      svg += `<line x1="${tx(p1.x).toFixed(1)}" y1="${ty(p1.y).toFixed(1)}" x2="${tx(p2.x).toFixed(1)}" y2="${ty(p2.y).toFixed(1)}" stroke="${EDGE_COLOR.RIDGE}" stroke-width="1.6" stroke-linecap="round" stroke-opacity="0.95"/>`
    }
    // Overlay pills last so they sit above everything.
    for (const d of dormerOverlayDraws) svg += d
  }

  // Compass (top-right)
  if (showCompass) {
    const cx = W - 38, cy = 38
    // North up arrow
    svg += `<g transform="translate(${cx},${cy})">
      <circle r="16" fill="#fff" stroke="#CBD5E1" stroke-width="1"/>
      <path d="M 0 -11 L 5 6 L 0 3 L -5 6 Z" fill="#DC2626"/>
      <text x="0" y="-18" text-anchor="middle" font-size="9" font-weight="700" fill="#475569" ${FONT}>N</text>
    </g>`
  }

  // Dimension callouts on every eave edge (with collision avoidance for
  // very short edges — e.g. dormer returns).
  if (showDimensions) {
    const haversineFt = (a: LatLng, b: LatLng) => {
      const dLat = (b.lat - a.lat) * Math.PI / 180
      const dLng = (b.lng - a.lng) * Math.PI / 180
      const lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180
      const k = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
      return 2 * 6371000 * Math.asin(Math.sqrt(k)) * M_TO_FT
    }

    for (let i = 0; i < structure.eaves.length; i++) {
      const a = structure.eaves[i]
      const b = structure.eaves[(i + 1) % structure.eaves.length]
      const lenFt = haversineFt(a, b)
      if (lenFt < 2) continue   // skip noise

      const pa = groundOutline[i]
      const pb = groundOutline[(i + 1) % groundOutline.length]
      const x1 = tx(pa.x), y1 = ty(pa.y)
      const x2 = tx(pb.x), y2 = ty(pb.y)
      const segPx = Math.hypot(x2 - x1, y2 - y1)
      if (segPx < 26) continue   // skip if too short to label cleanly

      // Outward-pointing offset (perpendicular to the edge, away from the
      // building centroid) so labels don't sit on top of the roof body.
      const cx = groundOutline.reduce((s, p) => s + tx(p.x), 0) / groundOutline.length
      const cy = groundOutline.reduce((s, p) => s + ty(p.y), 0) / groundOutline.length
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
      const ex = mx - cx, ey = my - cy
      const elen = Math.hypot(ex, ey) || 1
      const offset = 14
      const lx = mx + (ex / elen) * offset
      const ly = my + (ey / elen) * offset

      svg += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="9" font-weight="700" fill="#0F172A" ${FONT} stroke="#fff" stroke-width="2.5" paint-order="stroke">${lenFt.toFixed(1)} ft</text>`
    }
  }

  // Ridge length callouts. Two faces sharing a ridge will both report the
  // same edge — dedup on midpoint hash before drawing so we don't stack
  // two identical labels on top of each other.
  if (showDimensions && ridgeRenders.length > 0) {
    const seen = new Set<string>()
    for (const r of ridgeRenders) {
      if (r.lengthFt < 3) continue
      const mxw = (r.aWorld.x + r.bWorld.x) / 2
      const myw = (r.aWorld.y + r.bWorld.y) / 2
      const key = `${mxw.toFixed(2)},${myw.toFixed(2)},${r.lengthFt.toFixed(1)}`
      if (seen.has(key)) continue
      seen.add(key)
      const mx = (tx(r.aProj.x) + tx(r.bProj.x)) / 2
      const my = (ty(r.aProj.y) + ty(r.bProj.y)) / 2
      // Lift the label upward a few pixels so it sits above the ridge line
      // (ridges are by definition the highest screen-y of their face, so a
      // small negative y offset is a safe direction).
      const ly = my - 9
      svg += `<text x="${mx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="9" font-weight="700" fill="${EDGE_COLOR.RIDGE}" ${FONT} stroke="#fff" stroke-width="2.5" paint-order="stroke">${r.lengthFt.toFixed(1)} ft</text>`
    }
  }

  // Bottom label strip — gated by showDimensions so the customer-facing
  // diagram never reveals area / pitch.
  if (showDimensions) {
    const labelY = H - 10
    svg += `<text x="${W/2}" y="${labelY}" text-anchor="middle" font-size="10" font-weight="700" fill="#0F172A" ${FONT}>${structure.label} — ${structure.true_area_sqft.toLocaleString()} sqft @ ${structure.dominant_pitch_label}</text>`
  }

  svg += `</svg>`
  return svg
}

// ───────────────────────── MULTI-STRUCTURE WRAPPER ─────────────────────────

/**
 * Render every structure in the report as its own axonometric SVG.
 * Returns one SVG string per structure. Caller decides whether to stack them
 * vertically, render them side-by-side, or paginate.
 */
export function generateAllStructureSVGs(
  report: RoofReport,
  opts: { width?: number; height?: number; showShadow?: boolean; showCompass?: boolean; showDimensions?: boolean } = {},
): { partition: StructurePartition; svg: string }[] {
  const partitions = splitStructures(report)
  return partitions.map((p, i) => ({
    partition: p,
    svg: generateAxonometricRoofSVG(p, { ...opts, structureIndex: i }),
  }))
}

/**
 * Allocate aggregate materials proportionally per structure based on each
 * structure's roof-area share. The engine doesn't currently run per-structure,
 * so this is the pragmatic split for the report.
 */
export function allocateMaterialsToStructures(
  report: RoofReport,
  partitions: StructurePartition[],
): { index: number; label: string; share: number; squares: number; bundles: number; underlayment_rolls: number; ice_water_sqft: number; ridge_cap_lf: number; starter_strip_lf: number; drip_edge_lf: number; valley_flashing_lf: number; nails_lbs: number }[] {
  const tm: any = (report as any).trace_measurement?.materials_estimate || {}
  const fallbackBundles = Math.ceil((report.total_true_area_sqft || 0) / 100 * 3 * 1.05)
  const totalSquares = (tm.shingles_squares_gross || (report.total_true_area_sqft || 0) / 100)
  const totalBundles = (tm.shingles_bundles || fallbackBundles)
  const totalUnderlay = (tm.underlayment_rolls || Math.ceil((report.total_true_area_sqft || 0) / 400))
  const totalIWB = (tm.ice_water_shield_sqft || 0)
  const totalRidgeCap = (tm.ridge_cap_lf || ((report.edge_summary?.total_ridge_ft || 0) + (report.edge_summary?.total_hip_ft || 0)))
  const totalStarter = (tm.starter_strip_lf || ((report.edge_summary?.total_eave_ft || 0) + (report.edge_summary?.total_rake_ft || 0)))
  const totalDrip = (tm.drip_edge_total_lf || ((report.edge_summary?.total_eave_ft || 0) + (report.edge_summary?.total_rake_ft || 0)))
  const totalValley = (tm.valley_flashing_lf || (report.edge_summary?.total_valley_ft || 0))
  const totalNails = (tm.roofing_nails_lbs || Math.ceil((report.total_true_area_sqft || 0) / 100 * 2.5))

  return partitions.map(p => ({
    index: p.index,
    label: p.label,
    share: p.area_share,
    squares: Math.round(totalSquares * p.area_share * 10) / 10,
    bundles: Math.ceil(totalBundles * p.area_share),
    underlayment_rolls: Math.max(1, Math.ceil(totalUnderlay * p.area_share)),
    ice_water_sqft: Math.round(totalIWB * p.area_share),
    ridge_cap_lf: Math.round(totalRidgeCap * p.area_share),
    starter_strip_lf: Math.round(totalStarter * p.area_share),
    drip_edge_lf: Math.round(totalDrip * p.area_share),
    valley_flashing_lf: Math.round(totalValley * p.area_share),
    nails_lbs: Math.ceil(totalNails * p.area_share),
  }))
}
