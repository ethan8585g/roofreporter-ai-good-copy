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
  /** "Main House" / "Detached Garage" / etc. */
  label: string
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
  RIDGE:  '#B91C1C',
  HIP:    '#C2410C',
  VALLEY: '#1D4ED8',
  RAKE:   '#6D28D9',
}

// Per-pitch base color ramp; gets shaded by Lambert.
const PITCH_BAND_COLOR: Array<[number, string]> = [
  [2, '#94A3B8'],    // flat → slate
  [4, '#64748B'],    // low-slope
  [7, '#475569'],    // mid
  [10, '#334155'],   // standard
  [99, '#1E293B'],   // steep
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

  // Build candidate partitions, area-sorted descending.
  type Cand = { eaves: LatLng[]; eavesXY: { x: number; y: number }[]; footprint_sqft: number; perimeter_ft: number }
  const cands: Cand[] = sections.map(eaves => {
    const xy = projectLatLngToMeters(eaves, cosLat, refLat, refLng)
    return {
      eaves,
      eavesXY: xy,
      footprint_sqft: shoelaceFt2(xy),
      perimeter_ft: perimeterFt(xy),
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

  return cands.map((c, i) => {
    const trueArea = c.footprint_sqft * slopeMult
    return {
      index: i + 1,
      label: labels[i] || `Structure ${i + 1}`,
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
    }
  })
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
 * Build a folded roof mesh.
 *
 *   - When user-traced ridges are provided, lift their endpoints to ridge
 *     height and associate each eave edge with the closest ridge segment.
 *     The result respects the actual roof shape the user drew.
 *   - When no ridges are present, fall back to a hip-roof approximation
 *     (longest-axis ridge for rectangles, pyramid for non-rectangles).
 */
function buildRoofMesh(
  eavesXY: { x: number; y: number }[],
  pitch_rise: number,
  tracedRidgesXY: { x: number; y: number }[][],
  tracedHipsXY: { x: number; y: number }[][] = [],
  tracedValleysXY: { x: number; y: number }[][] = [],
): Face3[] {
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
    const ridgeSegs: { a: { x: number; y: number }; b: { x: number; y: number } }[] = []
    for (const ridge of tracedRidgesXY) {
      if (!ridge || ridge.length < 2) continue
      for (let i = 0; i < ridge.length - 1; i++) {
        ridgeSegs.push({ a: ridge[i], b: ridge[i + 1] })
      }
    }
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
      const SHORT_EDGE_M = 2.0    // singleton runs shorter than this absorb into neighbours
      const HIP_SNAP_M = 1.0      // hip endpoint match radius
      const VALLEY_SNAP_M = 1.0   // valley proximity for inboard clipping

      const projectOnto = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
        const abx = b.x - a.x, aby = b.y - a.y
        const lenSq = abx * abx + aby * aby
        if (lenSq < 1e-9) return { x: a.x, y: a.y, t: 0, d: Math.hypot(p.x - a.x, p.y - a.y) }
        let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq
        t = Math.max(0, Math.min(1, t))
        const cx = a.x + t * abx, cy = a.y + t * aby
        return { x: cx, y: cy, t, d: Math.hypot(p.x - cx, p.y - cy) }
      }

      const corners: V3[] = eavesXY.map(p => ({ x: p.x, y: p.y, z: 0 }))
      const faces: Face3[] = []

      // ── Pass 1: assign each eave edge to its nearest ridge segment ──
      const assigned: number[] = new Array(n)
      const edgeLen: number[] = new Array(n)
      for (let i = 0; i < n; i++) {
        const a = corners[i]
        const b = corners[(i + 1) % n]
        edgeLen[i] = Math.hypot(b.x - a.x, b.y - a.y)
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        let best = 0
        let bestDist = Infinity
        for (let j = 0; j < ridgeSegs.length; j++) {
          const proj = projectOnto(mid, ridgeSegs[j].a, ridgeSegs[j].b)
          if (proj.d < bestDist) { bestDist = proj.d; best = j }
        }
        assigned[i] = best
      }

      // ── Pass 1.5: smooth singleton runs ──
      // Short eave segments sandwiched between two long edges with the same
      // ridge assignment are almost always polygon-trace jogs (3–4 ft
      // step-overs). Reassigning them to the dominant neighbour ridge
      // collapses the jog into the surrounding run.
      for (let pass = 0; pass < 2; pass++) {
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
          if (bestValleyDist < VALLEY_SNAP_M && bestValleyDist < bestRidgeDist * 0.7) {
            inboardSeg = bestValleySeg
          }
        }

        const pa = projectOnto(corners[firstCornerIdx], inboardSeg.a, inboardSeg.b)
        const pb = projectOnto(corners[lastCornerIdx], inboardSeg.a, inboardSeg.b)
        const ridgeA: V3 = { x: pa.x, y: pa.y, z: ridgeHeightM }
        const ridgeB: V3 = { x: pb.x, y: pb.y, z: ridgeHeightM }

        const isTriangle = Math.hypot(ridgeA.x - ridgeB.x, ridgeA.y - ridgeB.y) < SHARED_APEX_M
        if (isTriangle) {
          const apex: V3 = { x: (ridgeA.x + ridgeB.x) / 2, y: (ridgeA.y + ridgeB.y) / 2, z: ridgeHeightM }
          if (eaveCorners.length === 2) {
            faces.push(makeFace([eaveCorners[0], eaveCorners[1], apex], pitch_rise))
          } else {
            for (let k = 0; k < eaveCorners.length - 1; k++) {
              faces.push(makeFace([eaveCorners[k], eaveCorners[k + 1], apex], pitch_rise))
            }
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
            faces.push(makeFace([C, rEnd, apex], pitch_rise))
            faces.push(makeFace([C, apex, rStart], pitch_rise))
          } else {
            faces.push(makeFace([C, rEnd, rStart], pitch_rise))
          }
        }
      }

      return faces
    }
  }

  // ── PATH B: no ridges → hip-roof from footprint ──
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const isRect = n === 4
  const faces: Face3[] = []

  if (isRect) {
    const longestAxisIsX = w >= h
    const ridgeA: V3 = longestAxisIsX
      ? { x: cx - (w - shortSideM) / 2, y: cy, z: ridgeHeightM }
      : { x: cx, y: cy - (h - shortSideM) / 2, z: ridgeHeightM }
    const ridgeB: V3 = longestAxisIsX
      ? { x: cx + (w - shortSideM) / 2, y: cy, z: ridgeHeightM }
      : { x: cx, y: cy + (h - shortSideM) / 2, z: ridgeHeightM }
    const corners: V3[] = eavesXY.map(p => ({ x: p.x, y: p.y, z: 0 }))
    const sideA: V3[] = [], sideB: V3[] = []
    for (const c of corners) {
      const dA = (c.x - ridgeA.x) ** 2 + (c.y - ridgeA.y) ** 2
      const dB = (c.x - ridgeB.x) ** 2 + (c.y - ridgeB.y) ** 2
      if (dA < dB) sideA.push(c); else sideB.push(c)
    }
    if (sideA.length >= 2 && sideB.length >= 2) {
      faces.push(
        makeFace([sideA[0], sideB[0], ridgeB, ridgeA], pitch_rise),
        makeFace([sideB[1], sideA[1], ridgeA, ridgeB], pitch_rise),
        makeFace([sideA[0], ridgeA, sideA[1]], pitch_rise),
        makeFace([sideB[0], sideB[1], ridgeB], pitch_rise),
      )
    } else {
      const apex: V3 = { x: cx, y: cy, z: ridgeHeightM }
      for (let i = 0; i < n; i++) {
        faces.push(makeFace([corners[i], corners[(i + 1) % n], apex], pitch_rise))
      }
    }
  } else {
    const apex: V3 = { x: cx, y: cy, z: ridgeHeightM }
    const corners: V3[] = eavesXY.map(p => ({ x: p.x, y: p.y, z: 0 }))
    for (let i = 0; i < n; i++) {
      faces.push(makeFace([corners[i], corners[(i + 1) % n], apex], pitch_rise))
    }
  }
  return faces
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

function shadeColor(hex: string, factor: number): string {
  // factor 0..1.5 (1.0 = unchanged, <1 = darker, >1 = lighter)
  const c = hex.replace('#', '')
  const r = parseInt(c.slice(0, 2), 16)
  const g = parseInt(c.slice(2, 4), 16)
  const b = parseInt(c.slice(4, 6), 16)
  const f = Math.max(0.3, Math.min(1.6, factor))
  const out = (n: number) => Math.max(0, Math.min(255, Math.round(n * f)))
  return `rgb(${out(r)},${out(g)},${out(b)})`
}

function lambertFactor(normal: V3): number {
  const dotKey  = normal.x * SUN_KEY.x  + normal.y * SUN_KEY.y  + normal.z * SUN_KEY.z
  const dotFill = normal.x * SUN_FILL.x + normal.y * SUN_FILL.y + normal.z * SUN_FILL.z
  // Ambient + clamped key + clamped fill. Ambient floor (0.78) prevents the
  // backlit side from collapsing to pure shadow (which read as dead-flat in
  // the old single-sun model).
  return 0.78 + Math.max(0, dotKey) * 0.45 + Math.max(0, dotFill) * 0.18
}

// ───────────────────────── MAIN GENERATOR ─────────────────────────

/**
 * Generate a 3D-look axonometric SVG for a single structure.
 * Pure SVG — prints crisply, no rasterization.
 */
export function generateAxonometricRoofSVG(
  structure: StructurePartition,
  opts: { width?: number; height?: number; showShadow?: boolean; showCompass?: boolean; showDimensions?: boolean } = {},
): string {
  const W = opts.width ?? 1200
  const H = opts.height ?? 750
  const PAD = 48
  const showShadow = opts.showShadow !== false
  const showCompass = opts.showCompass !== false
  const showDimensions = opts.showDimensions !== false

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

  // Painter's sort — back-to-front by centroid screen-Y (smaller y = farther
  // away in our axonometric).
  const sortedFaces = [...projected].sort((a, b) => a.centroid.y - b.centroid.y)

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
      <feGaussianBlur in="SourceGraphic" stdDeviation="5"/>
    </filter>
    <filter id="face-ao" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur stdDeviation="2.2"/>
    </filter>
    <linearGradient id="bg-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#F8FAFC"/>
      <stop offset="100%" stop-color="#FFFFFF"/>
    </linearGradient>
  </defs>`

  // Background
  svg += `<rect width="${W}" height="${H}" fill="url(#bg-grad)"/>`

  // Ground plane subtle
  svg += `<line x1="${PAD}" y1="${H - 32}" x2="${W - PAD}" y2="${H - 32}" stroke="#E2E8F0" stroke-width="0.5" stroke-dasharray="2,3"/>`

  // Drop shadow under building (silhouette of footprint, blurred + offset).
  if (showShadow) {
    const shadowPts = groundOutline
      .map(p => `${(tx(p.x) + 7).toFixed(1)},${(ty(p.y) + 11).toFixed(1)}`)
      .join(' ')
    svg += `<polygon points="${shadowPts}" fill="rgba(15,23,42,0.28)" filter="url(#ground-shadow)"/>`
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
    svg += `<polygon points="${x1.toFixed(1)},${y1.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)} ${x2.toFixed(1)},${(y2 + wallSkirtPx).toFixed(1)} ${x1.toFixed(1)},${(y1 + wallSkirtPx).toFixed(1)}" fill="#E2E8F0" stroke="#CBD5E1" stroke-width="0.5"/>`
  }

  // Ambient-occlusion underlay: dark blurred strokes that accumulate where
  // adjacent faces share an edge, producing soft creases at hips, ridges and
  // valleys without any per-edge logic.
  svg += `<g filter="url(#face-ao)">`
  for (const f of sortedFaces) {
    const pts = f.vertices.map(v => `${tx(v.x).toFixed(1)},${ty(v.y).toFixed(1)}`).join(' ')
    svg += `<polygon points="${pts}" fill="none" stroke="#0F172A" stroke-width="3.4" stroke-linejoin="round" stroke-opacity="0.55"/>`
  }
  svg += `</g>`

  // Roof faces (back-to-front).
  for (const f of sortedFaces) {
    const base = pitchBaseColor(f.pitch_rise)
    const shade = shadeColor(base, lambertFactor(f.normal))
    const pts = f.vertices.map(v => `${tx(v.x).toFixed(1)},${ty(v.y).toFixed(1)}`).join(' ')
    svg += `<polygon points="${pts}" fill="${shade}" stroke="#0F172A" stroke-width="0.8" stroke-linejoin="round" stroke-opacity="0.55"/>`
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
  svg += `<polygon points="${eavePts}" fill="none" stroke="${EDGE_COLOR.EAVE}" stroke-width="1.6" stroke-linejoin="round" stroke-opacity="0.85"/>`

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

  // Bottom label strip
  const labelY = H - 10
  svg += `<text x="${W/2}" y="${labelY}" text-anchor="middle" font-size="10" font-weight="700" fill="#0F172A" ${FONT}>${structure.label} — ${structure.true_area_sqft.toLocaleString()} sqft @ ${structure.dominant_pitch_label}</text>`

  svg += `</svg>`
  return svg
}

// ───────────────────────── MULTI-STRUCTURE WRAPPER ─────────────────────────

/**
 * Render every structure in the report as its own axonometric SVG.
 * Returns one SVG string per structure. Caller decides whether to stack them
 * vertically, render them side-by-side, or paginate.
 */
export function generateAllStructureSVGs(report: RoofReport): { partition: StructurePartition; svg: string }[] {
  const partitions = splitStructures(report)
  return partitions.map(p => ({ partition: p, svg: generateAxonometricRoofSVG(p) }))
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
