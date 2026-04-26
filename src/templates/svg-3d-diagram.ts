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
}

// ───────────────────────── CONSTANTS ─────────────────────────

const M_PER_DEG_LAT = 111320
const M_TO_FT = 3.28084
const FT2_PER_M2 = 10.7639

// Axonometric tilt: 30° yaw, 30° pitch (industry-standard isometric look).
const YAW_DEG = 30
const PITCH_DEG = 30

// Sun direction for Lambert shading (NW, 45° elevation).
const SUN = (() => {
  const az = 315 * Math.PI / 180  // NW (compass)
  const el = 45 * Math.PI / 180
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
  return pts.map(p => ({
    x: (p.lng - refLng) * 111320 * cosLat,
    y: -(p.lat - refLat) * M_PER_DEG_LAT,
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
 * Build a folded hip-roof mesh from a footprint polygon by extruding each
 * eave edge inward to a centroid raised by ridge height. This is an
 * approximation that looks correct for rectangular footprints (the most
 * common case) and degrades gracefully for L-shapes.
 */
function buildHipMeshFromFootprint(
  eavesXY: { x: number; y: number }[],
  pitch_rise: number,
): Face3[] {
  const n = eavesXY.length
  if (n < 3) return []

  // Centroid (in metres)
  const cx = eavesXY.reduce((s, p) => s + p.x, 0) / n
  const cy = eavesXY.reduce((s, p) => s + p.y, 0) / n

  // Ridge height: half the shorter side × pitch (standard hip-roof geometry).
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of eavesXY) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
  }
  const w = maxX - minX
  const h = maxY - minY
  const shortSideM = Math.min(w, h)
  const ridgeHeightM = (shortSideM / 2) * (pitch_rise / 12)

  // For rectangular footprints, build a true hip roof: 2 trapezoidal long
  // faces + 2 triangular short faces, all meeting at a ridge.
  // For non-rectangular, fan-triangulate to apex.
  const isRect = n === 4
  const faces: Face3[] = []

  if (isRect) {
    // Sort corners CCW starting from bottom-left.
    // Assume input order is already polygon order; build ridge endpoints
    // along the longer axis.
    const longestAxisIsX = w >= h
    const ridgeA = longestAxisIsX
      ? { x: cx - (w - shortSideM) / 2, y: cy, z: ridgeHeightM }
      : { x: cx, y: cy - (h - shortSideM) / 2, z: ridgeHeightM }
    const ridgeB = longestAxisIsX
      ? { x: cx + (w - shortSideM) / 2, y: cy, z: ridgeHeightM }
      : { x: cx, y: cy + (h - shortSideM) / 2, z: ridgeHeightM }

    // Identify which two eave corners are on each side of the ridge.
    const corners = eavesXY.map(p => ({ x: p.x, y: p.y, z: 0 }))
    // Group corners by which ridge endpoint they're closer to.
    const sideA: V3[] = [], sideB: V3[] = []
    for (const c of corners) {
      const dA = (c.x - ridgeA.x) ** 2 + (c.y - ridgeA.y) ** 2
      const dB = (c.x - ridgeB.x) ** 2 + (c.y - ridgeB.y) ** 2
      if (dA < dB) sideA.push(c); else sideB.push(c)
    }
    // Hip-roof faces: 4 triangles or 2 trapezoids+2 triangles depending on grouping.
    // We'll build 4 faces: two opposing trapezoids + two end triangles.
    if (sideA.length >= 2 && sideB.length >= 2) {
      // Long-side faces (2 trapezoids), each sharing a ridge segment.
      // Long side 1: sideA[0], sideB[0], ridgeB, ridgeA
      // Long side 2: sideA[1], sideB[1], ridgeB, ridgeA
      // End faces: hip triangles
      faces.push(
        makeFace([sideA[0], sideB[0], ridgeB, ridgeA], pitch_rise),
        makeFace([sideB[1], sideA[1], ridgeA, ridgeB], pitch_rise),
        makeFace([sideA[0], ridgeA, sideA[1]], pitch_rise),
        makeFace([sideB[0], sideB[1], ridgeB], pitch_rise),
      )
    } else {
      // Pyramid fallback.
      const apex = { x: cx, y: cy, z: ridgeHeightM }
      for (let i = 0; i < n; i++) {
        const a = corners[i], b = corners[(i + 1) % n]
        faces.push(makeFace([a, b, apex], pitch_rise))
      }
    }
  } else {
    // Fan triangulate to a single apex (gives a hip-pyramid look).
    const apex = { x: cx, y: cy, z: ridgeHeightM }
    const corners = eavesXY.map(p => ({ x: p.x, y: p.y, z: 0 }))
    for (let i = 0; i < n; i++) {
      const a = corners[i], b = corners[(i + 1) % n]
      faces.push(makeFace([a, b, apex], pitch_rise))
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
  const dot = normal.x * SUN.x + normal.y * SUN.y + normal.z * SUN.z
  // Map [-1,1] dot → [0.55, 1.35] shade factor (avoids pure black / pure white).
  return 0.95 + dot * 0.40
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
  const W = opts.width ?? 700
  const H = opts.height ?? 420
  const PAD = 36
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

  // Build mesh.
  const pitchRise = 12 * Math.tan(structure.dominant_pitch_deg * Math.PI / 180)
  const faces = buildHipMeshFromFootprint(eavesXY, pitchRise)

  // Project all vertices to screen plane.
  const projected: Face3[] = faces.map(f => ({
    ...f,
    vertices: f.vertices.map(v => {
      const p = projectAxonometric(v)
      return { x: p.x, y: p.y, z: p.depth } as V3
    }),
    centroid: (() => {
      const p = projectAxonometric(f.centroid)
      return { x: p.x, y: p.y, z: p.depth } as V3
    })(),
    normal: (() => {
      // Project normal direction (no translation) for shading purposes —
      // shading uses the original world-space normal vs. SUN, NOT the
      // projected one. Keep original.
      return f.normal
    })(),
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
  svg += `<defs>
    <filter id="ground-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="3.5"/>
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
      .map(p => `${(tx(p.x) + 4).toFixed(1)},${(ty(p.y) + 6).toFixed(1)}`)
      .join(' ')
    svg += `<polygon points="${shadowPts}" fill="rgba(15,23,42,0.20)" filter="url(#ground-shadow)"/>`
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

  // Roof faces (back-to-front).
  for (const f of sortedFaces) {
    const base = pitchBaseColor(f.pitch_rise)
    const shade = shadeColor(base, lambertFactor(f.normal))
    const pts = f.vertices.map(v => `${tx(v.x).toFixed(1)},${ty(v.y).toFixed(1)}`).join(' ')
    svg += `<polygon points="${pts}" fill="${shade}" stroke="#0F172A" stroke-width="0.8" stroke-linejoin="round" stroke-opacity="0.55"/>`
  }

  // Highlight ridges + hips: any shared edge between the topmost two faces
  // OR the topmost edge of each face.
  // Cheap proxy: draw the highest edge of each face in the ridge color.
  for (const f of sortedFaces) {
    let bestEdge: { a: V3; b: V3; avgZ: number } | null = null
    for (let i = 0; i < f.vertices.length; i++) {
      const a = f.vertices[i]
      const b = f.vertices[(i + 1) % f.vertices.length]
      const avgZ = (a.z + b.z) / 2
      // We want to emphasize edges that are at the top of the face — i.e.
      // closer to the camera (smaller projected y). Use centroid as ref.
      const aboveCentroid = avgZ > f.centroid.z
      if (aboveCentroid && (!bestEdge || avgZ > bestEdge.avgZ)) {
        bestEdge = { a, b, avgZ }
      }
    }
    if (bestEdge) {
      svg += `<line x1="${tx(bestEdge.a.x).toFixed(1)}" y1="${ty(bestEdge.a.y).toFixed(1)}" x2="${tx(bestEdge.b.x).toFixed(1)}" y2="${ty(bestEdge.b.y).toFixed(1)}" stroke="${EDGE_COLOR.RIDGE}" stroke-width="1.6" stroke-linecap="round" stroke-opacity="0.85"/>`
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

  // Dimension callouts on the footprint (longest 2 edges only — keeps it readable)
  if (showDimensions) {
    const haversineFt = (a: LatLng, b: LatLng) => {
      const dLat = (b.lat - a.lat) * Math.PI / 180
      const dLng = (b.lng - a.lng) * Math.PI / 180
      const lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180
      const k = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
      return 2 * 6371000 * Math.asin(Math.sqrt(k)) * M_TO_FT
    }
    const edgesWithLen = structure.eaves.map((p, i) => {
      const next = structure.eaves[(i + 1) % structure.eaves.length]
      return { i, len: haversineFt(p, next) }
    }).sort((a, b) => b.len - a.len).slice(0, 2)
    edgesWithLen.forEach(e => {
      const a = groundOutline[e.i]
      const b = groundOutline[(e.i + 1) % groundOutline.length]
      const mx = (tx(a.x) + tx(b.x)) / 2
      const my = (ty(a.y) + ty(b.y)) / 2
      svg += `<text x="${mx.toFixed(1)}" y="${(my + 14).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#0F172A" ${FONT}>${e.len.toFixed(1)} ft</text>`
    })
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
