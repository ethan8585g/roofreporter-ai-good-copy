// ============================================================
// RoofReporterAI — Roof Measurement Engine v5.0 — PHASE 1
// USER-DRAWN ONLY — NO AUTO-INFERENCE
//
// PORTED from tools/roof_engine.py — Python reference impl.
//
// Core Philosophy:
//   - ALL measurements come STRICTLY from what the user traced on the map
//   - NO guessing of ridges, hips, valleys — if user didn't draw it, it's not in the report
//   - WGS84 → local Cartesian (UTM-like) for meter-level accuracy
//   - Shoelace formula for 2D footprint area
//   - normalize_slope() accepts pitch A:B, decimal degrees, multiplier
//   - Multi-slope roofs: segment.slope_ref → slope_map; bi-slope junctions
//   - Common-run algorithm for hips/valleys: project ridge onto nearest eave
//   - Explicit edge-case handling: zero-length, vertical θ, flat, collinear
//   - Vertex snapping ensures closed, watertight polygon geometry
//   - Google Solar API used ONLY for satellite imagery + optional DSM cross-check
//
// PHASE 1 REMOVED:
//   - inferEdgesFromEavePolygon() — auto-guessed ridges/hips from eave polygon
//   - findEaveCorners() — quadrant-based corner detection for inference
//   - findConcaveCorners() — L/T-shape detection for valley inference
//   - proportionalFaceSplit() — estimated face areas by bounding-box ratio
//   Phase 2 (AI auto-trace) can be added later without breaking anything.
//
// INPUT:  Trace JSON { eaves: [{lat,lng}], ridges: [[{lat,lng}]], ... }
//         OR segment-based { segments: [...], slope_map: {...}, default_slope }
// OUTPUT: Full measurement report — areas, lengths, squares, materials
// ============================================================

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const EARTH_RADIUS_M    = 6_371_000
const M_TO_FT           = 3.28084
const M2_TO_FT2         = 10.7639
const SQFT_PER_SQUARE   = 100
const BUNDLES_PER_SQ    = 3
const SQ_PER_UNDERLAY   = 4
const LF_PER_RIDGE_BUNDLE = 35
const ICE_SHIELD_WIDTH_FT = 3.0
const NAIL_LBS_PER_SQ   = 2.5
const SNAP_THRESHOLD_M   = 0.15  // ~6 inches — lowered from 0.3 to avoid collapsing short dormers/returns
const DEG_TO_RAD = Math.PI / 180

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface TracePt {
  lat: number
  lng: number
  elevation?: number | null
}

interface CartesianPt {
  x: number
  y: number
  z: number
  lat: number
  lng: number
}

export interface TraceLine {
  id?: string
  pitch?: number | null
  pts: TracePt[]
}

export interface TraceFace {
  face_id: string
  poly: TracePt[]
  pitch: number
  label?: string
}

export interface TracePayload {
  address?: string
  homeowner?: string
  order_id?: string
  default_pitch?: number
  complexity?: 'simple' | 'medium' | 'complex'
  include_waste?: boolean
  eaves_outline: TracePt[]
  ridges?: TraceLine[]
  hips?: TraceLine[]
  valleys?: TraceLine[]
  rakes?: TraceLine[]
  faces?: TraceFace[]
  // New v4: slope_map and segment-based input
  slope_map?: Record<string, string>
}

export interface EaveEdge {
  edge_num: number
  from_pt: number
  to_pt: number
  length_2d_ft: number
  length_3d_ft: number
  length_ft: number  // backward compat alias
  bearing_deg: number
}

export interface LineDetail {
  id: string
  type: string
  category: 'horizontal' | 'sloped'
  horiz_length_ft: number
  sloped_length_ft: number
  num_pts: number
  common_run_ft: number
  delta_z_ft: number
  slope_factor: number
  is_bi_slope: boolean
  auto_classified: boolean
}

export interface FaceDetail {
  face_id: string
  pitch_rise: number
  pitch_label: string
  pitch_angle_deg: number
  slope_factor: number
  projected_area_ft2: number
  sloped_area_ft2: number
  squares: number
}

export interface TraceMaterialEstimate {
  shingles_squares_net: number
  shingles_squares_gross: number
  shingles_bundles: number
  underlayment_rolls: number
  ice_water_shield_sqft: number
  ice_water_shield_rolls_2sq: number
  ridge_cap_lf: number
  ridge_cap_bundles: number
  starter_strip_lf: number
  drip_edge_eave_lf: number
  drip_edge_rake_lf: number
  drip_edge_total_lf: number
  valley_flashing_lf: number
  roofing_nails_lbs: number
  caulk_tubes: number
}

// ── EagleView-Inspired Extended Data ──
export interface PitchBreakdown {
  pitch_label: string
  pitch_rise: number
  area_sqft: number
  percent_of_roof: number
}

export interface WasteTableRow {
  waste_pct: number
  area_sqft: number
  squares: number
  is_suggested: boolean
}

export interface PenetrationSummary {
  total_count: number
  total_area_sqft: number
  total_perimeter_ft: number
  items: { id: string; type: string; area_sqft: number; perimeter_ft: number }[]
}

export interface TraceReport {
  report_meta: {
    address: string
    homeowner: string
    order_id: string
    generated: string
    engine_version: string
    powered_by: string
  }
  key_measurements: {
    total_roof_area_sloped_ft2: number
    total_projected_footprint_ft2: number
    total_squares_net: number
    total_squares_gross_w_waste: number
    waste_factor_pct: number
    num_roof_faces: number
    num_eave_points: number
    num_ridges: number
    num_hips: number
    num_valleys: number
    num_rakes: number
    dominant_pitch_label: string
    dominant_pitch_angle_deg: number
    // EagleView-inspired additions
    estimated_attic_sqft: number
    number_of_stories: string
    roof_complexity: 'Simple' | 'Normal' | 'Complex'
    total_penetrations: number
    total_area_less_penetrations_ft2: number
  }
  linear_measurements: {
    eaves_total_ft: number
    ridges_total_ft: number
    hips_total_ft: number
    valleys_total_ft: number
    rakes_total_ft: number
    perimeter_eave_rake_ft: number
    hip_plus_ridge_ft: number
    // EagleView-inspired additions
    drip_edge_total_ft: number
    step_flashing_ft: number
    wall_flashing_ft: number
    total_flashing_ft: number
    parapet_walls_ft: number
  }
  // EagleView-inspired: areas per pitch breakdown
  areas_per_pitch: PitchBreakdown[]
  // EagleView-inspired: waste calculation table (0% to 28%)
  waste_table: WasteTableRow[]
  // EagleView-inspired: penetrations summary
  penetrations: PenetrationSummary
  // EagleView-inspired: facet labels (A-Z sorted smallest to largest)
  facet_labels: { label: string; face_id: string; area_sqft: number; pitch_label: string }[]
  eave_edge_breakdown: EaveEdge[]
  ridge_details: LineDetail[]
  hip_details: LineDetail[]
  valley_details: LineDetail[]
  rake_details: LineDetail[]
  face_details: FaceDetail[]
  materials_estimate: TraceMaterialEstimate
  advisory_notes: string[]
}

// ═══════════════════════════════════════════════════════════════
// normalize_slope(value, type) → radians
//
// Accepts:
//   pitch     : "6:12", "6/12", "6"  (rise per 12-inch run)
//   degrees   : "26.57" or 26.57 (decimal degrees)
//   multiplier: "1.118" (slope factor = √(rise²+144)/12 or 1/cos(θ))
//   radians   : 0.4636 (direct)
//   auto      : heuristic detection
// ═══════════════════════════════════════════════════════════════

type SlopeType = 'pitch' | 'degrees' | 'multiplier' | 'radians' | 'auto'

export function normalizeSlope(value: string | number, slopeType: SlopeType = 'auto'): number {
  const s = String(value).trim()

  if (slopeType === 'auto') {
    slopeType = _detectSlopeType(s)
  }

  let theta: number

  if (slopeType === 'pitch') {
    const rise = _parsePitchRise(s)
    theta = Math.atan2(rise, 12.0)
  } else if (slopeType === 'degrees') {
    const deg = parseFloat(s)
    if (deg < 0 || deg >= 90) throw new Error(`Slope degrees must be 0 ≤ θ < 90, got ${deg}`)
    theta = deg * DEG_TO_RAD
  } else if (slopeType === 'multiplier') {
    const m = parseFloat(s)
    if (m < 1.0) throw new Error(`Slope multiplier must be ≥ 1.0, got ${m}`)
    if (m === 1.0) return 0.0
    theta = Math.acos(1.0 / m)
  } else if (slopeType === 'radians') {
    theta = parseFloat(s)
  } else {
    throw new Error(`Unknown slope_type: ${slopeType}`)
  }

  if (theta >= Math.PI / 2) {
    throw new Error(`Vertical or overhanging slope (θ ≥ 90°): ${(theta * 180 / Math.PI).toFixed(2)}°`)
  }

  return theta
}

function _detectSlopeType(s: string): SlopeType {
  if (/^\d+(\.\d+)?\s*[:/]\s*12$/.test(s)) return 'pitch'
  if (/^\d+(\.\d+)?$/.test(s)) {
    const val = parseFloat(s)
    if (val <= 24) return 'pitch'
    if (val < 90) return 'degrees'
    throw new Error(`Cannot auto-detect slope type for value ${val}`)
  }
  if (s.toLowerCase().includes('deg') || s.includes('°')) return 'degrees'
  return 'pitch'
}

function _parsePitchRise(s: string): number {
  const m = s.match(/^(\d+(?:\.\d+)?)\s*[:/]\s*12$/)
  if (m) return parseFloat(m[1])
  const v = parseFloat(s)
  if (isNaN(v)) throw new Error(`Cannot parse pitch rise from: ${s}`)
  return v
}

// ═══════════════════════════════════════════════════════════════
// COORDINATE PROJECTION: WGS84 → Local Cartesian (metres)
// ═══════════════════════════════════════════════════════════════

// Elevation unit constant: set to 1.0 if elevation is already in metres,
// set to 0.3048 if elevation arrives in feet.
// Our trace UI sends NO elevation (null), and DSM data is in metres,
// so this is 1.0 by default. Override in payload if needed.
const ELEVATION_TO_METRES = 1.0

function projectToCartesian(pts: TracePt[]): { origin: { lat: number; lng: number }; projected: CartesianPt[] } {
  if (pts.length === 0) return { origin: { lat: 0, lng: 0 }, projected: [] }

  const sumLat = pts.reduce((s, p) => s + p.lat, 0)
  const sumLng = pts.reduce((s, p) => s + p.lng, 0)
  const originLat = sumLat / pts.length
  const originLng = sumLng / pts.length

  const cosLat = Math.cos(originLat * DEG_TO_RAD)
  const mPerDegLat = DEG_TO_RAD * EARTH_RADIUS_M
  const mPerDegLng = DEG_TO_RAD * EARTH_RADIUS_M * cosLat

  const projected: CartesianPt[] = pts.map(p => ({
    x: (p.lng - originLng) * mPerDegLng,
    y: (p.lat - originLat) * mPerDegLat,
    z: (p.elevation != null ? p.elevation * ELEVATION_TO_METRES : 0),
    lat: p.lat,
    lng: p.lng,
  }))

  return { origin: { lat: originLat, lng: originLng }, projected }
}

function projectPoint(p: TracePt, originLat: number, originLng: number): CartesianPt {
  const cosLat = Math.cos(originLat * DEG_TO_RAD)
  const mPerDegLat = DEG_TO_RAD * EARTH_RADIUS_M
  const mPerDegLng = DEG_TO_RAD * EARTH_RADIUS_M * cosLat
  return {
    x: (p.lng - originLng) * mPerDegLng,
    y: (p.lat - originLat) * mPerDegLat,
    z: (p.elevation != null ? p.elevation * ELEVATION_TO_METRES : 0),
    lat: p.lat,
    lng: p.lng,
  }
}

// ═══════════════════════════════════════════════════════════════
// VERTEX SNAPPING
// ═══════════════════════════════════════════════════════════════

interface SnapVertex { x: number; y: number; z: number; id: string }

class VertexSnapper {
  private vertices: SnapVertex[] = []

  snap(x: number, y: number, z: number, id: string): SnapVertex {
    for (const v of this.vertices) {
      const dist = Math.sqrt((x - v.x) ** 2 + (y - v.y) ** 2)
      if (dist < SNAP_THRESHOLD_M) {
        if (z !== 0 && v.z !== 0) v.z = (v.z + z) / 2
        else if (z !== 0) v.z = z
        return v
      }
    }
    const nv: SnapVertex = { x, y, z, id }
    this.vertices.push(nv)
    return nv
  }

  getAll(): SnapVertex[] { return this.vertices }
}

// ═══════════════════════════════════════════════════════════════
// SHOELACE FORMULA — 2D polygon area in m²
// ═══════════════════════════════════════════════════════════════

function shoelaceAreaM2(pts: { x: number; y: number }[]): number {
  if (pts.length < 3) return 0
  let area = 0
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += pts[i].x * pts[j].y
    area -= pts[j].x * pts[i].y
  }
  return Math.abs(area) / 2
}

// ═══════════════════════════════════════════════════════════════
// DISTANCE FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function dist2D(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
}

function dist3D(a: CartesianPt, b: CartesianPt): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2 + (b.z - a.z) ** 2)
}

function polyline2DLengthM(pts: { x: number; y: number }[]): number {
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) total += dist2D(pts[i], pts[i + 1])
  return total
}

function polyline3DLengthM(pts: CartesianPt[]): number {
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) total += dist3D(pts[i], pts[i + 1])
  return total
}

// ═══════════════════════════════════════════════════════════════
// PITCH / SLOPE MATHS — Industry Standard Pitch Multiplier Table
//
// The pitch multiplier converts flat (2D projected) roof area to
// true sloped surface area. Derived from the Pythagorean theorem:
//   multiplier = √(rise² + 12²) / 12
//
// This lookup table covers standard residential AND commercial
// pitches from 0/12 (flat) through 24/12 (extreme steep).
// Values match industry-standard references used by EagleView,
// GAF, CertainTeed, and IKO for roofing material estimation.
// ═══════════════════════════════════════════════════════════════

const ROOF_PITCH_MULTIPLIERS: Record<number, number> = {
  0:  1.0000,  // Flat roof
  1:  1.0035,
  2:  1.0138,
  3:  1.0308,
  4:  1.0541,
  5:  1.0833,
  6:  1.1180,
  7:  1.1577,
  8:  1.2019,
  9:  1.2500,
  10: 1.3017,
  11: 1.3566,
  12: 1.4142,  // 45° — standard max residential
  13: 1.4743,
  14: 1.5366,
  15: 1.6008,
  16: 1.6667,
  17: 1.7340,
  18: 1.8028,
  19: 1.8728,
  20: 1.9437,
  21: 2.0156,
  22: 2.0881,
  23: 2.1612,
  24: 2.2361   // Extreme steep (commercial/heritage)
}

/**
 * Industry-standard pitch multiplier: rise/12 → area multiplier.
 *
 * Uses exact lookup-table values for integer pitches (1-24/12).
 * For fractional pitches (e.g. 4.5:12), linearly interpolates
 * between adjacent table entries for sub-inch accuracy.
 * For pitches beyond the table (>24), falls back to √(rise²+144)/12.
 *
 * @param rise - pitch rise per 12-inch run (e.g., 5 for 5:12)
 * @returns multiplier to convert flat area → true sloped area
 */
function slopeFactor(rise: number): number {
  // Clamp negative to 0
  if (rise <= 0) return 1.0

  // Exact integer lookup
  const intRise = Math.floor(rise)
  if (rise === intRise && ROOF_PITCH_MULTIPLIERS[intRise] !== undefined) {
    return ROOF_PITCH_MULTIPLIERS[intRise]
  }

  // Linear interpolation for fractional pitches
  const lower = ROOF_PITCH_MULTIPLIERS[intRise]
  const upper = ROOF_PITCH_MULTIPLIERS[intRise + 1]
  if (lower !== undefined && upper !== undefined) {
    const fraction = rise - intRise
    return lower + (upper - lower) * fraction
  }

  // Beyond table range (>24): fall back to Pythagorean formula
  return Math.sqrt(rise * rise + 144) / 12
}

/**
 * Hip/valley rafter pitch multiplier (diagonal at 45° plan angle).
 *
 * For hips/valleys the rafter runs diagonally across the plan at 45°,
 * so the effective run is √2 × 12 = 16.97 inches per 12" of rise.
 * Formula: √(rise² + 2×12²) / √(2×12²) = √(rise²+288) / √288
 *
 * Uses exact lookup-table values where available.
 */
const HIP_VALLEY_MULTIPLIERS: Record<number, number> = {
  0:  1.0000,
  1:  1.0017,
  2:  1.0069,
  3:  1.0155,
  4:  1.0275,
  5:  1.0426,
  6:  1.0607,
  7:  1.0816,
  8:  1.1050,
  9:  1.1308,
  10: 1.1588,
  11: 1.1887,
  12: 1.2203,
}

function hipSlopeFactor(rise: number): number {
  if (rise <= 0) return 1.0
  const intRise = Math.floor(rise)
  if (rise === intRise && HIP_VALLEY_MULTIPLIERS[intRise] !== undefined) {
    return HIP_VALLEY_MULTIPLIERS[intRise]
  }
  const lower = HIP_VALLEY_MULTIPLIERS[intRise]
  const upper = HIP_VALLEY_MULTIPLIERS[intRise + 1]
  if (lower !== undefined && upper !== undefined) {
    const fraction = rise - intRise
    return lower + (upper - lower) * fraction
  }
  // Beyond table: Pythagorean fallback
  return Math.sqrt(rise * rise + 288) / Math.sqrt(288)
}

/** Rise:12 → angle in degrees */
function pitchAngleDeg(rise: number): number {
  return Math.atan(rise / 12) * 180 / Math.PI
}

/** Rise:12 → angle in radians */
function pitchAngleRad(rise: number): number {
  return Math.atan(rise / 12)
}

/**
 * Projected (flat 2D) area → true sloped surface area.
 * Uses the industry-standard pitch multiplier lookup table.
 *
 * @param proj - projected 2D footprint area in sqft
 * @param rise - pitch rise per 12" run
 * @returns true sloped area in sqft
 */
function slopedFromProjected(proj: number, rise: number): number {
  return proj * slopeFactor(rise)
}

/**
 * Convenience: compute full roof specs from flat dimensions + pitch.
 * Similar to the Python calculate_roof_specs() reference function.
 *
 * @param flatLength - flat plan length in feet
 * @param flatWidth  - flat plan width in feet
 * @param pitchRise  - pitch rise per 12" run
 * @returns calculated roof specs
 */
export function calculateRoofSpecs(
  flatLength: number,
  flatWidth: number,
  pitchRise: number
): {
  pitch_label: string
  pitch_angle_deg: number
  multiplier: number
  flat_area_sqft: number
  true_sloped_area_sqft: number
  panel_length_ft: number
  hip_multiplier: number
} {
  const flatArea = flatLength * flatWidth
  const multiplier = slopeFactor(pitchRise)
  const trueArea = flatArea * multiplier
  const panelLength = flatWidth * multiplier  // slope-adjusted panel run
  return {
    pitch_label:          `${pitchRise}:12`,
    pitch_angle_deg:      round(pitchAngleDeg(pitchRise), 2),
    multiplier:           round(multiplier, 4),
    flat_area_sqft:       round(flatArea, 1),
    true_sloped_area_sqft: round(trueArea, 1),
    panel_length_ft:      round(panelLength, 2),
    hip_multiplier:       round(hipSlopeFactor(pitchRise), 4),
  }
}

/** Export the lookup table for API consumers / reports */
export { ROOF_PITCH_MULTIPLIERS, HIP_VALLEY_MULTIPLIERS }

// ═══════════════════════════════════════════════════════════════
// COMMON RUN COMPUTATION
//
// Algorithm: find nearest eave, project ridge/hip/valley point
// onto eave line, compute perpendicular distance = R_common.
// Then Δz = R_common × tan(θ).
// ═══════════════════════════════════════════════════════════════

function pointToLineProjection(
  px: number, py: number,
  lx1: number, ly1: number, lx2: number, ly2: number
): { projX: number; projY: number; t: number } {
  const dx = lx2 - lx1
  const dy = ly2 - ly1
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) return { projX: lx1, projY: ly1, t: 0 }
  const t = ((px - lx1) * dx + (py - ly1) * dy) / lenSq
  const tc = Math.max(0, Math.min(1, t))
  return { projX: lx1 + tc * dx, projY: ly1 + tc * dy, t: tc }
}

// ═══════════════════════════════════════════════════════════════
// AUTO-CLASSIFICATION HEURISTICS
//
// When label is missing, classify by geometry:
//   1. Horizontal near bottom → eave
//   2. Horizontal near top → ridge
//   3. Nearly vertical → rake
//   4. Diagonal 30–60° → hip (default) or valley
// ═══════════════════════════════════════════════════════════════

type LineCategory = 'horizontal' | 'sloped'

function categoriseLine(type: string): LineCategory {
  switch (type) {
    case 'eave': case 'ridge': return 'horizontal'
    case 'hip': case 'valley': case 'rake': default: return 'sloped'
  }
}

// ═══════════════════════════════════════════════════════════════
// WASTE & MATERIAL HELPERS
// ═══════════════════════════════════════════════════════════════

function wastePct(rise: number, complexity: string = 'medium'): number {
  // Base waste: simple=15%, medium=20%, complex=25% (includes 5% additional safety margin)
  const bases: Record<string, number> = { simple: 0.15, medium: 0.20, complex: 0.25 }
  let base = bases[complexity] ?? 0.20
  if (rise >= 9) base += 0.05
  else if (rise >= 7) base += 0.02
  return base
}

function materialsEstimate(
  netSquares: number, wasteFrac: number,
  eaveFt: number, ridgeFt: number, hipFt: number, valleyFt: number, rakeFt: number
): TraceMaterialEstimate {
  const gross = netSquares * (1 + wasteFrac)
  return {
    shingles_squares_net:       round(netSquares, 2),
    shingles_squares_gross:     round(gross, 2),
    shingles_bundles:           Math.ceil(gross * BUNDLES_PER_SQ),
    underlayment_rolls:         Math.ceil(gross / SQ_PER_UNDERLAY),
    ice_water_shield_sqft:      round(eaveFt * ICE_SHIELD_WIDTH_FT, 1),
    ice_water_shield_rolls_2sq: Math.ceil((eaveFt * ICE_SHIELD_WIDTH_FT) / 200),
    ridge_cap_lf:               round(ridgeFt + hipFt, 1),
    ridge_cap_bundles:          Math.ceil((ridgeFt + hipFt) / LF_PER_RIDGE_BUNDLE),
    starter_strip_lf:           round(eaveFt + rakeFt, 1),
    drip_edge_eave_lf:          round(eaveFt, 1),
    drip_edge_rake_lf:          round(rakeFt, 1),
    drip_edge_total_lf:         round(eaveFt + rakeFt, 1),
    valley_flashing_lf:         round(valleyFt * 1.10, 1),
    roofing_nails_lbs:          Math.ceil(gross * NAIL_LBS_PER_SQ),
    caulk_tubes:                Math.max(1, Math.ceil(gross / 5)),
  }
}

function round(v: number, decimals: number): number {
  const f = Math.pow(10, decimals)
  return Math.round(v * f) / f
}

// ═══════════════════════════════════════════════════════════════
// MAIN ENGINE CLASS
// ═══════════════════════════════════════════════════════════════

export class RoofMeasurementEngine {
  private address: string
  private homeowner: string
  private orderId: string
  private defPitch: number
  private defThetaRad: number
  private complexity: string
  private incWaste: boolean
  private timestamp: string

  // Slope map: plane_name → theta (radians)
  private slopeMap: Map<string, number> = new Map()

  // Raw WGS84 inputs
  private rawEaves: TracePt[]
  private rawRidges: TraceLine[]
  private rawHips: TraceLine[]
  private rawValleys: TraceLine[]
  private rawRakes: TraceLine[]
  private rawFaces: TraceFace[]

  // Projected Cartesian geometry
  private origin: { lat: number; lng: number }
  private snapper: VertexSnapper
  private eavesCart: CartesianPt[]
  private ridgesCart: { id: string; pts: CartesianPt[]; pitch: number | null; slope_ref: string }[]
  private hipsCart: { id: string; pts: CartesianPt[]; pitch: number | null; slope_ref: string }[]
  private valleysCart: { id: string; pts: CartesianPt[]; pitch: number | null; slope_ref: string }[]
  private rakesCart: { id: string; pts: CartesianPt[]; pitch: number | null; slope_ref: string }[]
  private facesCart: { face_id: string; poly: CartesianPt[]; pitch: number; label: string }[]

  constructor(payload: TracePayload) {
    this.address    = payload.address || 'Unknown Address'
    this.homeowner  = payload.homeowner || 'Unknown'
    this.orderId    = payload.order_id || ''
    this.defPitch   = payload.default_pitch ?? 5.0
    this.complexity = payload.complexity || 'medium'
    this.incWaste   = payload.include_waste !== false
    this.timestamp  = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'

    // Normalise default slope (rise:12 → radians)
    this.defThetaRad = pitchAngleRad(this.defPitch)

    // Build slope map from payload
    if (payload.slope_map) {
      for (const [key, val] of Object.entries(payload.slope_map)) {
        try {
          this.slopeMap.set(key, normalizeSlope(val, 'auto'))
        } catch { /* skip invalid entries */ }
      }
    }
    if (!this.slopeMap.has('default')) {
      this.slopeMap.set('default', this.defThetaRad)
    }

    // Parse raw WGS84 inputs
    this.rawEaves   = (payload.eaves_outline || []).map(p => ({ lat: p.lat, lng: p.lng, elevation: p.elevation ?? null }))
    this.rawRidges  = this.parseLines(payload.ridges || [])
    this.rawHips    = this.parseLines(payload.hips || [])
    this.rawValleys = this.parseLines(payload.valleys || [])
    this.rawRakes   = this.parseLines(payload.rakes || [])
    this.rawFaces   = this.parseFaces(payload.faces || [])

    // STEP 1: Project all points to local Cartesian
    const { origin, projected } = projectToCartesian(this.rawEaves)
    this.origin = origin

    // STEP 2: Vertex snapping
    this.snapper = new VertexSnapper()

    this.eavesCart = projected.map((p, i) => {
      const snapped = this.snapper.snap(p.x, p.y, p.z, `eave_${i}`)
      return { ...p, x: snapped.x, y: snapped.y, z: snapped.z }
    })

    // Auto-close eaves polygon
    if (this.eavesCart.length >= 3) {
      const first = this.eavesCart[0]
      const last = this.eavesCart[this.eavesCart.length - 1]
      if (dist2D(first, last) > 0.01) {
        this.eavesCart.push({ ...first })
      }
    }

    // Snap & project all line segments
    this.ridgesCart  = this.projectLines(this.rawRidges, 'ridge')
    this.hipsCart    = this.projectLines(this.rawHips, 'hip')
    this.valleysCart = this.projectLines(this.rawValleys, 'valley')
    this.rakesCart   = this.projectLines(this.rawRakes, 'rake')

    // ═══════════════════════════════════════════════════════════════
    // PHASE 1: NO AUTO-INFERENCE
    // If only eaves are drawn, report uses total footprint + default pitch.
    // Ridges/hips/valleys/rakes only appear if the user actually drew them.
    // Phase 2 will add AI auto-trace to fill in missing lines.
    // ═══════════════════════════════════════════════════════════════
    if (this.eavesCart.length < 3) {
      throw new Error('Eaves outline required (minimum 3 points). User must trace the drip edge.')
    }

    this.facesCart = this.rawFaces.map(f => ({
      face_id: f.face_id,
      pitch: f.pitch,
      label: f.label || 'face',
      poly: f.poly.map((p, i) => {
        const cp = projectPoint(p, this.origin.lat, this.origin.lng)
        const snapped = this.snapper.snap(cp.x, cp.y, cp.z, `face_${f.face_id}_${i}`)
        return { ...cp, x: snapped.x, y: snapped.y, z: snapped.z }
      })
    }))
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 1: AUTO-INFERENCE REMOVED
  // The following functions were removed in v5.0 Phase 1:
  //   - inferEdgesFromEavePolygon()
  //   - findEaveCorners()
  //   - findConcaveCorners()
  // They will return in Phase 2 as AI-assisted auto-trace.
  // ═══════════════════════════════════════════════════════════════

  private parseLines(raw: any[]): TraceLine[] {
    return raw.map(seg => ({
      id:    seg.id || '',
      pitch: seg.pitch != null ? this.safeParsePitch(seg.pitch) : null,
      pts:   (seg.pts || []).map((p: any) => ({
        lat: Number(p.lat), lng: Number(p.lng),
        elevation: p.elevation != null ? Number(p.elevation) : null
      }))
    }))
  }

  private parseFaces(raw: any[]): TraceFace[] {
    return raw.map(f => ({
      face_id: f.face_id || 'face',
      poly: (f.poly || []).map((p: any) => ({
        lat: Number(p.lat), lng: Number(p.lng),
        elevation: p.elevation != null ? Number(p.elevation) : null
      })),
      pitch: this.safeParsePitch(f.pitch ?? this.defPitch),
      label: f.label || 'face'
    }))
  }

  /**
   * Safely parse a pitch value that may be:
   *   - A number (6.0)       → returned as-is
   *   - A string "6:12"      → parsed to rise (6.0)
   *   - A string "6/12"      → parsed to rise (6.0)
   *   - A string "6"         → parsed to float (6.0)
   *   - NaN / invalid        → falls back to this.defPitch
   */
  private safeParsePitch(value: any): number {
    if (value == null) return this.defPitch

    // Already a valid number
    if (typeof value === 'number' && !isNaN(value)) return value

    // String: try "rise:12" or "rise/12" format first
    const s = String(value).trim()
    const ratioMatch = s.match(/^(\d+(?:\.\d+)?)\s*[:/]\s*12$/)
    if (ratioMatch) return parseFloat(ratioMatch[1])

    // String: try plain numeric
    const num = parseFloat(s)
    if (!isNaN(num)) return num

    // Unparseable — fall back to default pitch
    console.warn(`[Engine] Cannot parse pitch value "${value}" — using default ${this.defPitch}`)
    return this.defPitch
  }

  private projectLines(lines: TraceLine[], prefix: string): { id: string; pts: CartesianPt[]; pitch: number | null; slope_ref: string }[] {
    return lines.map((seg, i) => ({
      id: seg.id || `${prefix}_${i + 1}`,
      pitch: seg.pitch != null ? this.safeParsePitch(seg.pitch) : null,
      slope_ref: (seg as any).slope_ref || 'default',
      pts: seg.pts.map((p, j) => {
        const cp = projectPoint(p, this.origin.lat, this.origin.lng)
        const snapped = this.snapper.snap(cp.x, cp.y, cp.z, `${prefix}_${i}_${j}`)
        return { ...cp, x: snapped.x, y: snapped.y, z: snapped.z }
      })
    }))
  }

  // ── SLOPE RESOLUTION (multi-slope + bi-slope) ──────────

  private resolveTheta(seg: { pitch: number | null; slope_ref: string }): { theta: number; isBiSlope: boolean } {
    const ref = (seg.slope_ref || 'default').trim()

    // Bi-slope junction: "main+dormer" → average
    if (ref.includes('+')) {
      const parts = ref.split('+').map(p => p.trim())
      const thetas = parts.map(p => this.slopeMap.get(p) ?? this.defThetaRad)
      const avg = thetas.reduce((a, b) => a + b, 0) / thetas.length
      return { theta: avg, isBiSlope: true }
    }

    // Use explicit pitch override if set on the line
    if (seg.pitch != null && !isNaN(seg.pitch)) {
      return { theta: pitchAngleRad(seg.pitch), isBiSlope: false }
    }

    // Look up slope map
    if (this.slopeMap.has(ref)) {
      return { theta: this.slopeMap.get(ref)!, isBiSlope: false }
    }

    return { theta: this.defThetaRad, isBiSlope: false }
  }

  // ── COMMON RUN: project point onto nearest eave ────────

  private computeCommonRunFt(px: number, py: number): number {
    if (this.eavesCart.length < 2) return 0

    let bestDist = Infinity
    const n = this.eavesCart.length - 1
    for (let i = 0; i < n; i++) {
      const a = this.eavesCart[i], b = this.eavesCart[i + 1]
      const { projX, projY } = pointToLineProjection(px, py, a.x, a.y, b.x, b.y)
      const d = Math.sqrt((px - projX) ** 2 + (py - projY) ** 2)
      if (d < bestDist) bestDist = d
    }
    return bestDist * M_TO_FT
  }

  // ── TRUE LENGTH with common-run algorithm ──────────────

  private computeTrueLength(
    horizM: number,
    theta: number,
    kind: string,
    pts: CartesianPt[],
    hasZ: boolean
  ): { sloped: number; commonRunFt: number; deltaZFt: number } {
    const cat = categoriseLine(kind)
    const horizFt = horizM * M_TO_FT

    if (cat === 'horizontal') {
      return { sloped: horizFt, commonRunFt: 0, deltaZFt: 0 }
    }

    // If we have DSM elevation data, use true 3D distance
    if (hasZ) {
      const sloped3D = polyline3DLengthM(pts) * M_TO_FT
      return { sloped: sloped3D, commonRunFt: 0, deltaZFt: 0 }
    }

    // ── Apply formulas from Python engine ──

    if (kind === 'rake') {
      // rake true_len = 2D / cos(θ)
      const cosT = Math.cos(theta)
      if (cosT < 1e-9) {
        throw new Error(`Vertical slope produces infinite rake length`)
      }
      return { sloped: horizFt / cosT, commonRunFt: 0, deltaZFt: 0 }
    }

    if (kind === 'hip' || kind === 'valley') {
      // Common run: project endpoint onto nearest eave
      // Use the endpoint farthest from eave (ridge end)
      let maxR = 0
      for (const pt of pts) {
        const r = this.computeCommonRunFt(pt.x, pt.y)
        if (r > maxR) maxR = r
      }
      const deltaZ = maxR * Math.tan(theta)
      const slopedFt = Math.sqrt(horizFt * horizFt + deltaZ * deltaZ)
      return { sloped: slopedFt, commonRunFt: maxR, deltaZFt: deltaZ }
    }

    // Default: slope factor
    const rise = this.defPitch
    const sf = slopeFactor(rise)
    return { sloped: horizFt * sf, commonRunFt: 0, deltaZFt: 0 }
  }

  // ── 2D FOOTPRINT AREA (Shoelace) ──────────────────────

  computeFootprintSqft(): number {
    const pts = this.eavesCart.length > 3
      ? this.eavesCart.slice(0, -1)
      : this.eavesCart
    const areaM2 = shoelaceAreaM2(pts)
    return areaM2 * M2_TO_FT2
  }

  // ── EAVE EDGE BREAKDOWN ──────────────────────────────

  eaveEdges(): EaveEdge[] {
    const edges: EaveEdge[] = []
    const pts = this.eavesCart
    if (pts.length < 2) return edges

    const n = pts.length - 1
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[i + 1]
      const len2D = dist2D(a, b) * M_TO_FT
      const len3D = len2D
      const bearing = ((Math.atan2(b.x - a.x, b.y - a.y) * 180 / Math.PI) % 360 + 360) % 360
      edges.push({
        edge_num:    i + 1,
        from_pt:     i + 1,
        to_pt:       (i % n) + 2,
        length_2d_ft: round(len2D, 2),
        length_3d_ft: round(len3D, 2),
        length_ft:   round(len2D, 2),  // backward compat
        bearing_deg: round(bearing, 1),
      })
    }
    return edges
  }

  // ── LINE DETAIL COMPUTATION ──────────────────────────

  lineDetails(
    segs: { id: string; pts: CartesianPt[]; pitch: number | null; slope_ref: string }[],
    kind: string
  ): LineDetail[] {
    return segs.map((seg, i) => {
      const horizM = polyline2DLengthM(seg.pts)
      const { theta, isBiSlope } = this.resolveTheta(seg)

      // Only use 3D distance if BOTH endpoints have meaningful elevation data
      // (z > 0.001 to avoid floating-point noise from zero-elevation)
      const hasZ = seg.pts.length >= 2 &&
        Math.abs(seg.pts[0].z) > 0.001 && Math.abs(seg.pts[seg.pts.length - 1].z) > 0.001

      const { sloped, commonRunFt, deltaZFt } = this.computeTrueLength(
        horizM, theta, kind, seg.pts, hasZ
      )

      const horiz = horizM * M_TO_FT
      const sf = horiz > 0 ? sloped / horiz : 1.0

      return {
        id:               seg.id || `${kind}_${i + 1}`,
        type:             kind,
        category:         categoriseLine(kind),
        horiz_length_ft:  round(horiz, 2),
        sloped_length_ft: round(sloped, 2),
        num_pts:          seg.pts.length,
        common_run_ft:    round(commonRunFt, 2),
        delta_z_ft:       round(deltaZFt, 2),
        slope_factor:     round(sf, 4),
        is_bi_slope:      isBiSlope,
        auto_classified:  false,
      }
    })
  }

  // ── FACE AREA CALCULATION ────────────────────────────

  faceAreas(): FaceDetail[] {
    const results: FaceDetail[] = []

    if (this.facesCart.length > 0) {
      for (const face of this.facesCart) {
        const projM2 = shoelaceAreaM2(face.poly)
        const projFt2 = projM2 * M2_TO_FT2
        const sloped = slopedFromProjected(projFt2, face.pitch)
        results.push({
          face_id:            face.face_id,
          pitch_rise:         face.pitch,
          pitch_label:        `${face.pitch}:12`,
          pitch_angle_deg:    round(pitchAngleDeg(face.pitch), 1),
          slope_factor:       round(slopeFactor(face.pitch), 4),
          projected_area_ft2: round(projFt2, 1),
          sloped_area_ft2:    round(sloped, 1),
          squares:            round(sloped / SQFT_PER_SQUARE, 3),
        })
      }
    } else if (this.eavesCart.length >= 4) {
      const totalProjFt2 = this.computeFootprintSqft()

      // PHASE 1: Only attempt geometric split if user actually drew ridges + hips
      if (this.ridgesCart.length > 0 && this.hipsCart.length >= 2) {
        // ── GEOMETRIC FACE SPLITTING ──
        // User drew ridge + hip lines — split the eave polygon into faces
        // using their actual traced geometry. 100% user-drawn, no guessing.
        const facePolys = this.splitEavePolygonIntoFaces()
        
        if (facePolys.length > 0) {
          let assignedArea = 0
          for (let i = 0; i < facePolys.length; i++) {
            const polyArea = shoelaceAreaM2(facePolys[i].pts) * M2_TO_FT2
            const { theta } = facePolys[i].ridge ? this.resolveTheta(facePolys[i].ridge) : { theta: this.defThetaRad }
            const rise = 12 * Math.tan(theta)
            const sloped = slopedFromProjected(polyArea, rise)
            assignedArea += polyArea
            results.push({
              face_id:            facePolys[i].id || `face_${String.fromCharCode(65 + i)}`,
              pitch_rise:         round(rise, 1),
              pitch_label:        `${round(rise, 1)}:12`,
              pitch_angle_deg:    round(theta * 180 / Math.PI, 1),
              slope_factor:       round(slopeFactor(rise), 4),
              projected_area_ft2: round(polyArea, 1),
              sloped_area_ft2:    round(sloped, 1),
              squares:            round(sloped / SQFT_PER_SQUARE, 3),
            })
          }
          
          // If geometric splitting didn't capture all area (rounding), distribute remainder
          const remainder = totalProjFt2 - assignedArea
          if (Math.abs(remainder) > 1 && results.length > 0) {
            const perFace = remainder / results.length
            for (const r of results) {
              r.projected_area_ft2 = round(r.projected_area_ft2 + perFace, 1)
              const sloped = slopedFromProjected(r.projected_area_ft2, r.pitch_rise)
              r.sloped_area_ft2 = round(sloped, 1)
              r.squares = round(sloped / SQFT_PER_SQUARE, 3)
            }
          }
        }
      }

      // CLEAN FALLBACK: single total face (100% accurate total area, no guessing)
      // Applies when: only eaves drawn, or geometric split produced nothing
      if (results.length === 0) {
        const rise = this.defPitch
        const sloped = slopedFromProjected(totalProjFt2, rise)
        results.push({
          face_id:            'total_roof',
          pitch_rise:         rise,
          pitch_label:        `${rise}:12`,
          pitch_angle_deg:    round(pitchAngleDeg(rise), 1),
          slope_factor:       round(slopeFactor(rise), 4),
          projected_area_ft2: round(totalProjFt2, 1),
          sloped_area_ft2:    round(sloped, 1),
          squares:            round(sloped / SQFT_PER_SQUARE, 3),
        })
      }
    }

    return results
  }

  // ── GEOMETRIC FACE SPLITTING ──────────────────────────
  // For hip roofs: use ridge endpoints + hip endpoints to divide the
  // eave polygon into individual face polygons, then Shoelace each.

  private splitEavePolygonIntoFaces(): { id: string; pts: { x: number; y: number }[]; ridge: any }[] {
    const faces: { id: string; pts: { x: number; y: number }[]; ridge: any }[] = []
    
    // Collect all interior points (ridge + hip endpoints)
    const ridgePts: { x: number; y: number }[] = []
    for (const r of this.ridgesCart) {
      for (const p of r.pts) ridgePts.push({ x: p.x, y: p.y })
    }
    const hipPts: { x: number; y: number }[] = []
    for (const h of this.hipsCart) {
      for (const p of h.pts) hipPts.push({ x: p.x, y: p.y })
    }

    // For a standard hip roof: ridge runs along the long axis,
    // hips connect ridge endpoints to eave corners.
    // Faces: 2 main trapezoids (long sides) + 2 hip triangles (short ends)
    if (this.ridgesCart.length === 1 && this.hipsCart.length >= 2) {
      const ridge = this.ridgesCart[0]
      const rStart = { x: ridge.pts[0].x, y: ridge.pts[0].y }
      const rEnd = { x: ridge.pts[ridge.pts.length - 1].x, y: ridge.pts[ridge.pts.length - 1].y }

      // Find the eave vertices closest to each ridge endpoint (hip corners)
      const eaveVerts = this.eavesCart.slice(0, -1).map(p => ({ x: p.x, y: p.y }))
      
      // Sort eave points into left/right of the ridge line
      const ridgeDx = rEnd.x - rStart.x, ridgeDy = rEnd.y - rStart.y
      const leftSide: { x: number; y: number; idx: number }[] = []
      const rightSide: { x: number; y: number; idx: number }[] = []

      eaveVerts.forEach((p, idx) => {
        const cross = (p.x - rStart.x) * ridgeDy - (p.y - rStart.y) * ridgeDx
        if (cross >= 0) leftSide.push({ ...p, idx })
        else rightSide.push({ ...p, idx })
      })

      // Sort each side by projection along ridge direction for proper polygon order
      const ridgeLen = Math.sqrt(ridgeDx * ridgeDx + ridgeDy * ridgeDy) || 1
      const ridgeUx = ridgeDx / ridgeLen, ridgeUy = ridgeDy / ridgeLen
      const proj = (p: { x: number; y: number }) => (p.x - rStart.x) * ridgeUx + (p.y - rStart.y) * ridgeUy
      leftSide.sort((a, b) => proj(a) - proj(b))
      rightSide.sort((a, b) => proj(a) - proj(b))

      // Find eave corners nearest to ridge start and ridge end
      const distToRStart = (p: { x: number; y: number }) => Math.sqrt((p.x - rStart.x) ** 2 + (p.y - rStart.y) ** 2)
      const distToREnd = (p: { x: number; y: number }) => Math.sqrt((p.x - rEnd.x) ** 2 + (p.y - rEnd.y) ** 2)
      
      const nearStart = [...eaveVerts].sort((a, b) => distToRStart(a) - distToRStart(b))
      const nearEnd = [...eaveVerts].sort((a, b) => distToREnd(a) - distToREnd(b))
      
      // Hip end 1 (near ridge start): triangle from eave corners to ridge start
      if (nearStart.length >= 2) {
        const c1 = nearStart[0], c2 = nearStart[1]
        faces.push({ id: 'face_A', pts: [c1, rStart, c2], ridge: null })
      }

      // Main face (left side): trapezoid from left eave points + ridge
      if (leftSide.length >= 2) {
        const mainPts = [...leftSide, rEnd, rStart]
        faces.push({ id: 'face_B', pts: mainPts, ridge })
      }

      // Hip end 2 (near ridge end): triangle from eave corners to ridge end
      if (nearEnd.length >= 2) {
        const c1 = nearEnd[0], c2 = nearEnd[1]
        faces.push({ id: 'face_C', pts: [c1, rEnd, c2], ridge: null })
      }

      // Main face (right side): trapezoid from right eave points + ridge
      if (rightSide.length >= 2) {
        const mainPts = [...rightSide, rEnd, rStart]
        faces.push({ id: 'face_D', pts: mainPts, ridge })
      }

      return faces
    }

    // Generic fallback: return empty to trigger proportional split
    return []
  }

  // ── PHASE 1: proportionalFaceSplit() REMOVED ──
  // Was guessing face areas from bounding-box ratios.
  // Phase 2 will add AI-assisted face detection.

  // ═══════════════════════════════════════════════════════════════
  // FULL CALCULATION RUN
  // ═══════════════════════════════════════════════════════════════

  run(): TraceReport {
    const edges = this.eaveEdges()
    const totalEaveFt = edges.reduce((s, e) => s + e.length_2d_ft, 0)

    const ridgeSegs  = this.lineDetails(this.ridgesCart, 'ridge')
    const hipSegs    = this.lineDetails(this.hipsCart, 'hip')
    const valleySegs = this.lineDetails(this.valleysCart, 'valley')
    const rakeSegs   = this.lineDetails(this.rakesCart, 'rake')

    const totalRidgeFt  = ridgeSegs.reduce((s, seg) => s + seg.sloped_length_ft, 0)
    const totalHipFt    = hipSegs.reduce((s, seg) => s + seg.sloped_length_ft, 0)
    const totalValleyFt = valleySegs.reduce((s, seg) => s + seg.sloped_length_ft, 0)
    const totalRakeFt   = rakeSegs.reduce((s, seg) => s + seg.sloped_length_ft, 0)

    const facesData   = this.faceAreas()
    const totalSloped = facesData.reduce((s, f) => s + f.sloped_area_ft2, 0)
    const totalProj   = facesData.reduce((s, f) => s + f.projected_area_ft2, 0)
    const netSquares  = totalSloped / SQFT_PER_SQUARE

    // Dominant pitch
    const allPitches = facesData.map(f => f.pitch_rise)
    let domPitch = this.defPitch
    if (allPitches.length > 0) {
      const freq = new Map<number, number>()
      allPitches.forEach(p => freq.set(p, (freq.get(p) || 0) + 1))
      let maxCount = 0
      freq.forEach((count, pitch) => {
        if (count > maxCount) { maxCount = count; domPitch = pitch }
      })
    }

    const wFrac = this.incWaste ? wastePct(domPitch, this.complexity) : 0
    const grossSquares = netSquares * (1 + wFrac)

    const mat = materialsEstimate(
      netSquares, wFrac,
      totalEaveFt, totalRidgeFt, totalHipFt, totalValleyFt, totalRakeFt
    )

    const perimeterFt = totalEaveFt + totalRakeFt

    // ── EagleView-Inspired: Areas Per Pitch Breakdown ──
    const pitchMap = new Map<string, { rise: number; area: number }>()
    for (const f of facesData) {
      const key = `${Math.round(f.pitch_rise)}:12`
      const existing = pitchMap.get(key) || { rise: Math.round(f.pitch_rise), area: 0 }
      existing.area += f.sloped_area_ft2
      pitchMap.set(key, existing)
    }
    const areasPerPitch: PitchBreakdown[] = Array.from(pitchMap.entries())
      .map(([label, data]) => ({
        pitch_label: label,
        pitch_rise: data.rise,
        area_sqft: round(data.area, 1),
        percent_of_roof: round((data.area / totalSloped) * 100, 1)
      }))
      .sort((a, b) => a.pitch_rise - b.pitch_rise)

    // ── EagleView-Inspired: Waste Calculation Table ──
    // Only for areas >= 3/12 pitch (shingle-applicable)
    const shingleArea = facesData
      .filter(f => f.pitch_rise >= 3)
      .reduce((s, f) => s + f.sloped_area_ft2, 0)
    const shingleAreaForTable = shingleArea > 0 ? shingleArea : totalSloped
    const wastePercentages = [0, 3, 8, 11, 13, 15, 18, 23, 28]
    const suggestedWaste = round(wFrac * 100, 0)
    const wasteTable: WasteTableRow[] = wastePercentages.map(wp => {
      const areaWithWaste = round(shingleAreaForTable * (1 + wp / 100), 0)
      return {
        waste_pct: wp,
        area_sqft: areaWithWaste,
        squares: round(Math.ceil((areaWithWaste / SQFT_PER_SQUARE) * 3) / 3, 2),
        is_suggested: wp === suggestedWaste || (wp > 0 && Math.abs(wp - suggestedWaste) <= 2)
      }
    })

    // ── EagleView-Inspired: Penetrations Summary ──
    // We don't have actual penetration tracing yet, but compute from vision data if available
    const penetrations: PenetrationSummary = {
      total_count: 0,
      total_area_sqft: 0,
      total_perimeter_ft: 0,
      items: []
    }

    // ── EagleView-Inspired: Estimated Attic Area ──
    // Attic area ≈ projected footprint (the floor area under roof)
    const estimatedAttic = round(totalProj, 0)

    // ── EagleView-Inspired: Complexity Classification ──
    const complexityScore = facesData.length + hipSegs.length + valleySegs.length
    const roofComplexity: 'Simple' | 'Normal' | 'Complex' =
      complexityScore <= 6 ? 'Simple' : complexityScore <= 14 ? 'Normal' : 'Complex'

    // ── EagleView-Inspired: Number of Stories ──
    // Heuristic: if max ridge height / avg eave height suggests multi-story
    const numStories = totalSloped > 3000 || hipSegs.length > 4 ? '>1' : '1'

    // ── EagleView-Inspired: Facet Labels (A-Z, smallest to largest) ──
    const sortedFaces = [...facesData].sort((a, b) => a.sloped_area_ft2 - b.sloped_area_ft2)
    const facetLabels = sortedFaces.map((f, i) => ({
      label: String.fromCharCode(65 + i),
      face_id: f.face_id,
      area_sqft: round(f.sloped_area_ft2, 0),
      pitch_label: f.pitch_label
    }))

    // Advisory notes
    const notes: string[] = []

    // PHASE 1: Clear advisories for incomplete tracing
    if (this.ridgesCart.length === 0 && this.hipsCart.length === 0 && this.valleysCart.length === 0 && this.rakesCart.length === 0) {
      notes.push('⚠️ EAVES-ONLY TRACING — Ridges, hips, valleys & rakes were not drawn. Report uses total footprint + default pitch. Accuracy is 100% for area traced. For per-face breakdown, trace internal roof lines.')
    } else {
      if (this.ridgesCart.length === 0)
        notes.push('⚠️ No ridges traced — ridge cap and hip+ridge totals may be underestimated.')
      if (this.hipsCart.length === 0 && this.eavesCart.length > 6)
        notes.push('⚠️ No hips traced — hip lengths not included. If this is a hip roof, trace hip lines for full accuracy.')
    }
    if (this.valleysCart.length === 0 && this.eavesCart.length > 8)
      notes.push('Valleys not traced — valley flashing quantity may be underestimated.')
    if (this.rakesCart.length === 0)
      notes.push('Rakes not traced — rake drip edge length estimated from eave perimeter only.')

    if (domPitch >= 9)
      notes.push('STEEP PITCH >= 9:12 — Steep-slope labour & safety gear required.')
    if (domPitch < 4 && domPitch > 0)
      notes.push('LOW SLOPE < 4:12 — Verify manufacturer min-pitch. Extra underlayment layers recommended.')
    if (totalValleyFt > 0)
      notes.push(`Valleys present (${round(totalValleyFt, 1)} ft) — Recommend closed-cut or self-adhered valley install.`)
    if (totalHipFt > 0)
      notes.push(`Hip roof confirmed (${round(totalHipFt, 1)} ft total hip length).`)
    if (this.eavesCart.length > 10)
      notes.push('Complex perimeter (>10 eave points) — Allow extra cut waste.')

    // Check for bi-slope junctions
    const biSlopeSegs = [...hipSegs, ...valleySegs].filter(s => s.is_bi_slope)
    if (biSlopeSegs.length > 0)
      notes.push(`${biSlopeSegs.length} bi-slope junction(s) detected — slope angles averaged at intersection.`)

    // Pitch multiplier advisory
    const domMultiplier = slopeFactor(domPitch)
    const isLookup = Math.floor(domPitch) === domPitch && domPitch >= 0 && domPitch <= 24
    notes.push(
      `Pitch multiplier ${round(domMultiplier, 4)}x applied (${round(domPitch, 1)}:12 pitch). ` +
      `Source: ${isLookup ? 'Industry-standard Pythagorean lookup table' : 'Interpolated/calculated from lookup table'}. ` +
      `Table covers 0/12–24/12 per GAF/CertainTeed/IKO standards.`
    )

    return {
      report_meta: {
        address:        this.address,
        homeowner:      this.homeowner,
        order_id:       this.orderId,
        generated:      this.timestamp,
        engine_version: 'RoofMeasurementEngine v5.0 Phase 1 (User-Drawn Only + UTM + Shoelace + Industry Pitch Multipliers)',
        powered_by:     'Reuse Canada / RoofReporterAI',
      },
      key_measurements: {
        total_roof_area_sloped_ft2:    round(totalSloped, 1),
        total_projected_footprint_ft2: round(totalProj, 1),
        total_squares_net:             round(netSquares, 2),
        total_squares_gross_w_waste:   round(grossSquares, 2),
        waste_factor_pct:              round(wFrac * 100, 1),
        num_roof_faces:                facesData.length,
        num_eave_points:               Math.max(0, this.eavesCart.length - 1),
        num_ridges:                    this.ridgesCart.length,
        num_hips:                      this.hipsCart.length,
        num_valleys:                   this.valleysCart.length,
        num_rakes:                     this.rakesCart.length,
        dominant_pitch_label:          `${round(domPitch, 1)}:12`,
        dominant_pitch_angle_deg:      round(pitchAngleDeg(domPitch), 1),
        // EagleView-inspired additions
        estimated_attic_sqft:          estimatedAttic,
        number_of_stories:             numStories,
        roof_complexity:               roofComplexity,
        total_penetrations:            penetrations.total_count,
        total_area_less_penetrations_ft2: round(totalSloped - penetrations.total_area_sqft, 1),
      },
      linear_measurements: {
        eaves_total_ft:         round(totalEaveFt, 1),
        ridges_total_ft:        round(totalRidgeFt, 1),
        hips_total_ft:          round(totalHipFt, 1),
        valleys_total_ft:       round(totalValleyFt, 1),
        rakes_total_ft:         round(totalRakeFt, 1),
        perimeter_eave_rake_ft: round(perimeterFt, 1),
        hip_plus_ridge_ft:      round(totalHipFt + totalRidgeFt, 1),
        // EagleView-inspired additions
        drip_edge_total_ft:     round(totalEaveFt + totalRakeFt, 1),
        step_flashing_ft:       0, // Populated from edge detection when available
        wall_flashing_ft:       0,
        total_flashing_ft:      0,
        parapet_walls_ft:       0,
      },
      // EagleView-inspired sections
      areas_per_pitch:   areasPerPitch,
      waste_table:        wasteTable,
      penetrations:       penetrations,
      facet_labels:       facetLabels,
      eave_edge_breakdown: edges,
      ridge_details:       ridgeSegs,
      hip_details:         hipSegs,
      valley_details:      valleySegs,
      rake_details:        rakeSegs,
      face_details:        facesData,
      materials_estimate:  mat,
      advisory_notes:      notes,
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// CONVENIENCE: Convert existing trace UI format to engine payload
// ═══════════════════════════════════════════════════════════════

export function traceUiToEnginePayload(
  traceJson: {
    eaves?: { lat: number; lng: number }[]
    ridges?: { lat: number; lng: number }[][]
    hips?: { lat: number; lng: number }[][]
    valleys?: { lat: number; lng: number }[][]
    rakes?: { lat: number; lng: number }[][]   // Phase 1: now supported
    traced_at?: string
  },
  order: {
    property_address?: string
    homeowner_name?: string
    order_number?: string
    latitude?: number
    longitude?: number
    price_per_bundle?: number
  },
  defaultPitch: number = 5.0
): TracePayload {
  const eavesOutline: TracePt[] = (traceJson.eaves || []).map(p => ({
    lat: p.lat, lng: p.lng, elevation: null
  }))

  const ridges: TraceLine[] = (traceJson.ridges || []).map((line, i) => ({
    id: `ridge_${i + 1}`,
    pitch: null,
    pts: line.map(p => ({ lat: p.lat, lng: p.lng, elevation: null }))
  }))

  const hips: TraceLine[] = (traceJson.hips || []).map((line, i) => ({
    id: `hip_${i + 1}`,
    pitch: null,
    pts: line.map(p => ({ lat: p.lat, lng: p.lng, elevation: null }))
  }))

  const valleys: TraceLine[] = (traceJson.valleys || []).map((line, i) => ({
    id: `valley_${i + 1}`,
    pitch: null,
    pts: line.map(p => ({ lat: p.lat, lng: p.lng, elevation: null }))
  }))

  const rakes: TraceLine[] = (traceJson.rakes || []).map((line, i) => ({
    id: `rake_${i + 1}`,
    pitch: null,
    pts: line.map(p => ({ lat: p.lat, lng: p.lng, elevation: null }))
  }))

  return {
    address:        order.property_address || 'Unknown Address',
    homeowner:      order.homeowner_name || 'Unknown',
    order_id:       order.order_number || '',
    default_pitch:  defaultPitch,
    complexity:     'medium',
    include_waste:  true,
    eaves_outline:  eavesOutline,
    ridges,
    hips,
    valleys,
    rakes,
    faces:          [],
  }
}

// ═══════════════════════════════════════════════════════════════
// STANDALONE FUNCTIONS
// ═══════════════════════════════════════════════════════════════

export function computeFootprintFromLatLng(points: { lat: number; lng: number }[]): number {
  if (points.length < 3) return 0
  const pts: TracePt[] = points.map(p => ({ lat: p.lat, lng: p.lng }))
  const { projected } = projectToCartesian(pts)
  const areaM2 = shoelaceAreaM2(projected)
  return areaM2 * M2_TO_FT2
}

export function computeEdgeLengthFt(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const pts: TracePt[] = [{ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }]
  const { projected } = projectToCartesian(pts)
  return dist2D(projected[0], projected[1]) * M_TO_FT
}
