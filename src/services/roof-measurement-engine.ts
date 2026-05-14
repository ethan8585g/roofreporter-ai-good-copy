import { slopeFactor, hipSlopeFactor, pitchAngleDeg, pitchAngleRad } from './pitch'
import { detectDisjointEaves } from '../utils/disjoint-eaves'

// ============================================================
// Roof Manager — Roof Measurement Engine v4.0
//
// PORTED from tools/roof_engine.py — Python reference impl.
//
// Core Philosophy:
//   - ALL primary measurements from user-drawn GPS trace coordinates
//   - WGS84 → local Cartesian (UTM-like) for meter-level accuracy
//   - Shoelace formula for 2D footprint area
//   - normalize_slope() accepts pitch A:B, decimal degrees, multiplier
//   - Multi-slope roofs: segment.slope_ref → slope_map; bi-slope junctions
//   - Auto-classify segments via geometric heuristics when label missing
//   - Common-run algorithm for hips/valleys: project ridge onto nearest eave
//   - Explicit edge-case handling: zero-length, vertical θ, flat, collinear
//   - Vertex snapping ensures closed, watertight polygon geometry
//   - Google Solar API used ONLY for satellite imagery + optional DSM cross-check
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
// Ice & Water Barrier — IRC R905.1.2 / NBC code triggers
const LOW_SLOPE_RISE_THRESHOLD = 2.0   // pitches < 2:12 require full-roof I&W
const EAVE_PAST_WALL_FT       = 2.0    // 24" past interior heated-wall line
const EAVE_OVERHANG_DEFAULT_FT = 1.0   // assumed 12" overhang when not provided
const IW_VALLEY_HALF_WIDTH_FT = 3.0    // 3 ft each side of every valley
const IW_ROLL_SQFT             = 200
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

export interface EaveDepthLayer {
  section_index: number      // which eave section (0 = primary)
  depth_ft: number           // overhang/depth in feet
  label?: string             // e.g. 'gutter line', 'soffit edge'
}

export interface Obstruction {
  type: 'chimney' | 'skylight' | 'vent' | 'other'
  poly: TracePt[]            // closed polygon (3+ pts)
  width_ft?: number          // optional width (for simple rect)
  length_ft?: number         // optional length (for simple rect)
  label?: string
}

// Non-roof voids inside the lower-eave outline (decks between levels,
// atriums, courtyards). Mechanically subtracted from totalProj/totalSloped
// like obstructions, but semantically distinct: a hole in the footprint,
// not a roof penetration. Surfaced as its own breakdown row in the report.
export interface Cutout {
  poly: TracePt[]            // closed polygon (3+ pts)
  label?: string             // e.g. "Deck between levels"
}

export interface TracePayload {
  address?: string
  homeowner?: string
  order_id?: string
  default_pitch?: number
  complexity?: 'simple' | 'medium' | 'complex'
  include_waste?: boolean
  eaves_outline: TracePt[]
  // Multi-section eaves: each entry is an independent closed eaves polygon.
  // Used for buildings with separate roof sections (garage, porch, dormer, etc.).
  // Total footprint = sum of all section areas. Engine uses the largest section
  // for linear/face geometry; remaining sections contribute area only.
  eaves_sections?: TracePt[][]
  // Per-section pitch (rise:12) parallel to eaves_sections. When provided and
  // > 0 for a given index, that section's sloped area is computed at its own
  // pitch instead of the dominant default. Use this to model dormers and
  // additions with steeper or shallower pitch than the main roof.
  eaves_section_pitches?: Array<number | null>
  // Per-section "kind" tag parallel to eaves_sections. 'lower_tier' marks a
  // lower-eave lip that sits beneath an upper-story roof (the visible strip
  // around a 2-story home below the second-floor roof line). Treated as a
  // disjoint section for area math — the user is expected to trace ONLY the
  // visible lip polygon, not the full lower footprint that extends under the
  // upper roof. Renderers surface these distinctly ("Lower Eave N" with a
  // blue-dashed outline) instead of bucketing them under "Structure N".
  eaves_section_kinds?: Array<'main' | 'lower_tier' | null | undefined>
  // Multi-layer eave depth: per-section overhang depth values.
  // If provided, ice & water shield and starter strip are computed per-layer.
  eave_depths?: EaveDepthLayer[]
  // Per-edge eave/rake tags for SECONDARY structures, parallel to
  // `eaves_sections`. Each inner array has one entry per vertex of that
  // section (tag[i] applies to the edge starting at vertex i). When omitted
  // or shorter than a section's vertex count, that section's perimeter
  // defaults to all-eave (matches pre-multistructure-tagging behavior).
  eaves_sections_tags?: Array<Array<'eave' | 'rake'>>
  // Obstructions to exclude: chimneys, skylights, vents, etc.
  // Each obstruction polygon area is subtracted from total roof area.
  obstructions?: Obstruction[]
  // Non-roof voids inside the outline (decks between levels, atriums,
  // courtyards). Each cutout polygon area is subtracted from totalProj
  // and totalSloped after obstructions. Reported separately so the
  // breakdown shows "Excluded non-roof" distinct from roof penetrations.
  cutouts?: Cutout[]
  ridges?: TraceLine[]
  hips?: TraceLine[]
  valleys?: TraceLine[]
  rakes?: TraceLine[]
  /** Roof–wall junction lines. Each line carries a `kind` of 'step' (along
   *  slope, gets step flashing) or 'headwall' (across slope top, gets
   *  headwall flashing). Lengths flow into the materials estimate. */
  walls?: Array<TraceLine & { kind?: 'step' | 'headwall' }>
  /** Pre-computed flashing footages (linear feet) and counts. Bypasses
   *  the engine's Cartesian-projection pipeline since flashings don't
   *  need slope-corrected lengths — they are flat metal pieces. */
  flashing_lengths_ft?: {
    step?: number
    headwall?: number
  }
  flashing_counts?: {
    chimneys?: number
    pipe_boots?: number
  }
  faces?: TraceFace[]
  // New v4: slope_map and segment-based input
  slope_map?: Record<string, string>
  // Small eave corner threshold: edges shorter than this (ft) are flagged as corners
  small_corner_threshold_ft?: number
  // Optional external footprint for engine vs source variance cross-check
  cross_check?: { source: string; footprint_ft2: number }
  // Optional per-plane pitches (rise:12) extracted upstream from the DSM
  // (e.g. by edge-classifier RANSAC). When provided, each traced face polygon
  // is matched to the plane whose centroid falls inside the polygon, and the
  // matched plane's pitch overrides the default. Falls back to default_pitch
  // when no plane matches a given face.
  plane_segments_lat_lng?: Array<{
    pitch_rise: number
    centroid: { lat: number; lng: number }
    area_m2?: number
  }>
  // Per-edge tags captured during tracing. Each entry tags the edge starting
  // at the corresponding eaves_outline vertex ('eave' or 'rake'). When present
  // and lengths match, the engine attributes per-edge linear footage to the
  // explicit category instead of inferring rakes from line geometry.
  eaves_tags?: Array<'eave' | 'rake'>
  // Dormers — roof features inside the main outline that ride at their own
  // pitch (e.g. 12:12 A-frame dormer on a 6:12 main roof). Unlike
  // eaves_sections, dormers do NOT add new footprint; instead the engine
  // adds only the *differential* sloped area (footprint × (slopeFactor(dormer)
  // − slopeFactor(main))). This avoids the double-count problem that comes
  // from modeling a dormer as a separate eaves_section. Renderers must NOT
  // split per-dormer (unlike eaves_sections, which become separate
  // structures in multi-structure reports).
  dormers?: Array<{
    polygon: TracePt[]            // closed polygon, 3+ vertices
    pitch_rise: number            // rise:12 (e.g. 12 = 12:12)
    label?: string                // optional display name
  }>
}

export interface EaveEdge {
  edge_num: number
  from_pt: number
  to_pt: number
  length_2d_ft: number
  length_3d_ft: number
  length_ft: number  // backward compat alias
  bearing_deg: number
  // Which structure this edge belongs to: 0 = primary, 1+ = secondary
  // sections (detached garage, etc.). Optional for backward-compat with
  // pre-multistructure callers; treat undefined as 0.
  section_index?: number
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
  // Confidence of the eave-edge projection used for common-run
  // (1 = clearly nearest, 0 = ambiguous between multiple sections).
  // Always 1 for horizontal lines (not projected).
  projection_confidence: number
  projection_section_index: number  // -1 if not applicable
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
  // Face polygon vertices in lat/lng — exposed for downstream
  // consumers (e.g. solar panel layout). May be omitted when the
  // engine used proportional splitting rather than geometric faces.
  polygon?: { lat: number; lng: number }[]
  // Approximate azimuth (compass bearing of the downslope normal,
  // 0 = N, 90 = E, 180 = S). Derived from the face polygon's
  // principal axis; null when undetermined.
  azimuth_deg?: number | null
}

export interface IceWaterBreakdown {
  low_slope_full_coverage_sqft: number   // sloped area of segments with rise < 2:12
  low_slope_face_count: number
  eave_strip_sqft: number                // standard-pitch eave LF × (overhang + 24")
  eave_strip_depth_ft: number            // resolved per-eave depth used in formula
  valley_sqft: number                    // valley LF × 3 ft × 2 sides
  total_sqft: number
  total_rolls_2sq: number
  trigger_notes: string[]
}

export interface TraceMaterialEstimate {
  shingles_squares_net: number
  shingles_squares_gross: number
  shingles_bundles: number
  underlayment_rolls: number
  ice_water_shield_sqft: number
  ice_water_shield_rolls_2sq: number
  ice_water_breakdown?: IceWaterBreakdown
  ridge_cap_lf: number
  ridge_cap_bundles: number
  starter_strip_lf: number
  drip_edge_eave_lf: number
  drip_edge_rake_lf: number
  drip_edge_total_lf: number
  valley_flashing_lf: number
  step_flashing_lf: number
  headwall_flashing_lf: number
  chimney_flashing_count: number
  pipe_boot_count: number
  roofing_nails_lbs: number
  caulk_tubes: number
}

export interface ObstructionDetail {
  type: string
  label: string
  projected_area_ft2: number
  sloped_area_ft2: number
}

export interface CutoutDetail {
  label: string
  projected_area_ft2: number
  sloped_area_ft2: number
}

export interface EaveCornerDetail {
  edge_num: number
  length_ft: number
  bearing_deg: number
  is_small_corner: boolean  // flagged if under threshold
  angle_change_deg: number  // interior angle change from previous edge
}

export interface WasteBreakdownDriver {
  label: string
  pct: number
}

export interface WasteBreakdown {
  base_pct: number
  steep_pitch_pct: number
  valley_pct: number
  obstruction_pct: number
  multi_section_pct: number
  total_pct: number
  drivers: WasteBreakdownDriver[]
}

export interface LaborEstimate {
  crew_size: number
  pitch_multiplier: number
  complexity_multiplier: number
  tear_off_hours: number
  install_hours: number
  total_crew_hours: number
  est_days_min: number
  est_days_max: number
  notes: string
}

export interface CrossCheck {
  source: string
  external_footprint_ft2: number
  engine_footprint_ft2: number
  variance_pct: number
  verdict: 'aligned' | 'minor_variance' | 'significant_variance'
}

export interface ReviewFlag {
  reason: 'footprint_mismatch'
  traced_ft2: number
  external_ft2: number
  delta_pct: number
  external_source: string
  message: string
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
    waste_breakdown?: WasteBreakdown
    labor_estimate?: LaborEstimate
    num_roof_faces: number
    num_eave_points: number
    num_ridges: number
    num_hips: number
    num_valleys: number
    num_rakes: number
    dominant_pitch_label: string
    dominant_pitch_angle_deg: number
    obstruction_deduction_ft2: number
    num_obstructions: number
    cutout_deduction_ft2: number
    cutout_deduction_projected_ft2: number
    num_cutouts: number
  }
  cross_check?: CrossCheck
  needs_review?: boolean
  review_flag?: ReviewFlag
  geometry_warnings?: string[]
  linear_measurements: {
    eaves_total_ft: number
    ridges_total_ft: number
    hips_total_ft: number
    valleys_total_ft: number
    rakes_total_ft: number
    perimeter_eave_rake_ft: number
    hip_plus_ridge_ft: number
    step_flashing_total_ft: number
    headwall_flashing_total_ft: number
    chimney_flashing_count: number
    pipe_boot_count: number
  }
  eave_edge_breakdown: EaveEdge[]
  eave_corner_analysis: EaveCornerDetail[]
  eave_depth_layers: EaveDepthLayer[]
  obstruction_details: ObstructionDetail[]
  cutout_details: CutoutDetail[]
  ridge_details: LineDetail[]
  hip_details: LineDetail[]
  valley_details: LineDetail[]
  rake_details: LineDetail[]
  face_details: FaceDetail[]
  // Per-section sloped/projected areas for multi-section roofs. Index 0 is the
  // primary outline; subsequent entries align with TracePayload.eaves_sections.
  // Only emitted when extra eaves sections are present. Used by the report
  // template to show a per-structure pitch breakdown when sections vary.
  section_pitches?: Array<{
    section_index: number       // 0 = primary, 1+ = extra eaves_sections
    label: string               // 'Main roof' | 'Section 2' | 'Lower Eave 1' | etc.
    kind?: 'main' | 'lower_tier' // 'lower_tier' = visible lip beneath an upper-story roof
    pitch_rise: number          // rise:12
    projected_ft2: number
    sloped_ft2: number
    is_user_specified: boolean  // true when section's pitch came from eaves_section_pitches
  }>
  // Dormer breakdown — emitted when dormers were specified in the payload.
  // Each entry shows the differential sloped area added by that dormer (extra
  // surface beyond what the main roof's pitch would have produced for the
  // same footprint). Footprint stays attributed to the main roof; the engine
  // does NOT add the dormer's footprint as new ground area.
  dormer_breakdown?: Array<{
    dormer_index: number       // 1-based for display
    label: string              // 'Dormer A' | user-supplied
    pitch_rise: number         // rise:12
    footprint_ft2: number      // dormer's projected polygon area (sits inside main)
    extra_sloped_ft2: number   // differential added to total: footprint × (sf(dormer) − sf(main))
    main_pitch_rise: number    // for reference — what the main roof was at
  }>
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

/** Even-odd ray-casting point-in-polygon test (2D, ignores z). */
function pointInPolygon2D(px: number, py: number, poly: { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y
    const xj = poly[j].x, yj = poly[j].y
    const intersect = ((yi > py) !== (yj > py))
      && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi)
    if (intersect) inside = !inside
  }
  return inside
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

// Pitch / slope math tables + lookups live in ./pitch.ts (P1-30). The
// four helpers below are imported at the top of this file:
//   slopeFactor, hipSlopeFactor, pitchAngleDeg, pitchAngleRad.

/**
 * Projected (flat 2D) area → true sloped surface area.
 * Uses the industry-standard pitch multiplier lookup table.
 *
 * @param proj - projected 2D footprint area in sqft
 * @param rise - pitch rise per 12" run
 * @returns true sloped area in sqft
 */
// Estimate the compass bearing of a face polygon's "downslope normal"
// (the direction from ridge toward eave) as an approximation using 2D
// principal-axis analysis. Without DSM data we can't know which side
// is downhill; callers should treat this as a hint and override when
// authoritative azimuth data is available (e.g. Solar API roofSegmentStats).
// Returns 0–360 degrees, or null for degenerate polygons.
function estimateFaceAzimuth(poly: { x: number; y: number }[]): number | null {
  if (!poly || poly.length < 3) return null
  const n = poly.length
  const cx = poly.reduce((s, p) => s + p.x, 0) / n
  const cy = poly.reduce((s, p) => s + p.y, 0) / n
  let sxx = 0, syy = 0, sxy = 0
  for (const p of poly) {
    const dx = p.x - cx, dy = p.y - cy
    sxx += dx * dx
    syy += dy * dy
    sxy += dx * dy
  }
  // Principal axis angle (radians, CCW from +x)
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  // Normal to principal axis, converted to compass bearing
  // (engine +y = north, +x = east; bearing = atan2(east, north))
  const nx = -Math.sin(theta)
  const ny =  Math.cos(theta)
  let bearing = (Math.atan2(nx, ny) * 180 / Math.PI + 360) % 360
  return Math.round(bearing * 10) / 10
}

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
    pitch_label:          `${round(pitchRise, 1)}:12`,
    pitch_angle_deg:      round(pitchAngleDeg(pitchRise), 2),
    multiplier:           round(multiplier, 4),
    flat_area_sqft:       round(flatArea, 1),
    true_sloped_area_sqft: round(trueArea, 1),
    panel_length_ft:      round(panelLength, 2),
    hip_multiplier:       round(hipSlopeFactor(pitchRise), 4),
  }
}

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
  // Back-compat scalar: simple=15%, medium=20%, complex=25% + steep-pitch bump.
  // Low-slope roofs (<2:12 uses rolled membrane; 2:12–4:12 short cuts) waste less.
  const bases: Record<string, number> = { simple: 0.15, medium: 0.20, complex: 0.25 }
  let base = bases[complexity] ?? 0.20
  if (rise < 2)      base = Math.min(base, 0.08)   // rolled/modified bitumen
  else if (rise < 4) base = Math.min(base, 0.12)   // low-slope asphalt
  if (rise >= 9)      base += 0.05
  else if (rise >= 7) base += 0.02
  return base
}

function wasteBreakdown(
  rise: number,
  complexity: string,
  valleyFt: number,
  obstructionCount: number,
  sectionCount: number
): WasteBreakdown {
  const bases: Record<string, number> = { simple: 15, medium: 20, complex: 25 }
  let basePct = bases[complexity] ?? 20
  // Low-slope tier: cap base before steep-pitch / complexity bumps
  if (rise < 2)      basePct = Math.min(basePct, 8)
  else if (rise < 4) basePct = Math.min(basePct, 12)
  const steepPct = rise >= 9 ? 5 : rise >= 7 ? 2 : 0
  const valleyPct = Math.min(5, Math.floor(valleyFt / 40))
  const obstructionPct = Math.min(3, Math.round(obstructionCount * 0.5 * 10) / 10)
  const multiSectionPct = sectionCount >= 2 ? 2 : 0
  const totalPct = basePct + steepPct + valleyPct + obstructionPct + multiSectionPct

  const drivers: WasteBreakdownDriver[] = [
    { label: `Base (${complexity})`, pct: basePct },
  ]
  if (steepPct > 0) drivers.push({ label: `Steep pitch ${round(rise, 1)}:12`, pct: steepPct })
  if (valleyPct > 0) drivers.push({ label: `Valleys (${round(valleyFt, 0)} ft)`, pct: valleyPct })
  if (obstructionPct > 0) drivers.push({ label: `Obstructions (${obstructionCount})`, pct: obstructionPct })
  if (multiSectionPct > 0) drivers.push({ label: `Multi-section roof (${sectionCount} polygons)`, pct: multiSectionPct })

  return {
    base_pct: basePct,
    steep_pitch_pct: steepPct,
    valley_pct: valleyPct,
    obstruction_pct: obstructionPct,
    multi_section_pct: multiSectionPct,
    total_pct: totalPct,
    drivers,
  }
}

function laborEstimate(
  slopedAreaFt2: number,
  rise: number,
  complexity: string,
  crewSize: number = 3
): LaborEstimate {
  const pitchMul = rise >= 11 ? 1.6 : rise >= 9 ? 1.35 : rise >= 7 ? 1.15 : 1.0
  const cxMul: Record<string, number> = { simple: 0.9, medium: 1.0, complex: 1.15 }
  const complexityMul = cxMul[complexity] ?? 1.0

  // Base productivity rates (crew-hours per sq ft):
  //   tear-off ≈ 1 hr / 400 sqft
  //   install  ≈ 1 hr / 250 sqft
  const tearOffHrs = (slopedAreaFt2 / 400) * pitchMul * complexityMul
  const installHrs = (slopedAreaFt2 / 250) * pitchMul * complexityMul
  const totalCrewHrs = tearOffHrs + installHrs

  const crewDays = totalCrewHrs / (crewSize * 8)
  const estMin = Math.max(1, Math.floor(crewDays))
  const estMax = Math.max(estMin + 1, Math.ceil(crewDays * 1.25))

  return {
    crew_size: crewSize,
    pitch_multiplier: round(pitchMul, 2),
    complexity_multiplier: round(complexityMul, 2),
    tear_off_hours: round(tearOffHrs, 1),
    install_hours: round(installHrs, 1),
    total_crew_hours: round(totalCrewHrs, 1),
    est_days_min: estMin,
    est_days_max: estMax,
    notes: `Crew of ${crewSize}, 8-hr days. Rates: tear-off ~1 hr/400 sqft, install ~1 hr/250 sqft. Multipliers: pitch ${pitchMul.toFixed(2)}×, complexity ${complexityMul.toFixed(2)}×. Excludes mobilization, permits, structural repair.`,
  }
}

// Return human-readable geometry warnings ("" if OK).
function validateEaveGeometry(pts: { x: number; y: number }[]): string[] {
  const warnings: string[] = []
  if (pts.length < 3) return warnings
  // Drop trailing closure duplicate if present
  const closed = pts.length > 3 &&
    Math.abs(pts[0].x - pts[pts.length - 1].x) < 0.01 &&
    Math.abs(pts[0].y - pts[pts.length - 1].y) < 0.01
  const ring = closed ? pts.slice(0, -1) : pts.slice()
  const n = ring.length
  if (n < 3) return warnings

  // Duplicate points (<0.3 m)
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n]
    const dx = a.x - b.x, dy = a.y - b.y
    if (Math.sqrt(dx * dx + dy * dy) < 0.3) {
      warnings.push(`Duplicate or near-duplicate eave points at vertices ${i + 1} and ${(i + 1) % n + 1} (< 0.3 m apart).`)
      break
    }
  }

  // Collinear triples (cross product magnitude in local meters)
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n], c = ring[(i + 2) % n]
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    if (Math.abs(cross) < 1e-3) {
      warnings.push(`Three collinear eave points detected near vertex ${(i + 1) % n + 1} — this edge adds no area.`)
      break
    }
  }

  // Self-intersection (O(n²) on non-adjacent edges)
  const segIntersect = (p1: {x:number;y:number}, p2: {x:number;y:number}, p3: {x:number;y:number}, p4: {x:number;y:number}) => {
    const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x)
    if (Math.abs(d) < 1e-9) return false
    const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d
    const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d
    return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6
  }
  outer: for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n]
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue  // adjacent wrap
      const c = ring[j], d = ring[(j + 1) % n]
      if (segIntersect(a, b, c, d)) {
        warnings.push(`Self-intersecting eave polygon — edges ${i + 1} and ${j + 1} cross. Retrace without crossing lines.`)
        break outer
      }
    }
  }

  return warnings
}

// IRC R905.1.2 / NBC ice & water barrier breakdown.
// Faces below 2:12 require full sloped-area coverage; standard-pitch
// faces only need an eave strip extending 24" past the heated wall,
// plus 3 ft on each side of every valley.
export function computeIceWaterBreakdown(
  faces: { pitch_rise: number; sloped_area_ft2: number }[],
  totalEaveFt: number,
  totalValleyFt: number,
  eaveDepths: EaveDepthLayer[],
  // Per-section eave LF + depth. Index 0 = primary, 1+ = secondary structures.
  // When provided, the eave-strip area is integrated per section so a 6"
  // garage overhang isn't inflated to a 24" house overhang. Falls back to
  // the global max(depth) approximation when omitted (keeps test fixtures
  // and pre-multistructure traces working unchanged).
  perSectionEave?: Array<{ section_index: number; eave_lf_ft: number; depth_ft: number }>
): IceWaterBreakdown {
  const lowSlopeFaces = faces.filter(f => f.pitch_rise > 0 && f.pitch_rise < LOW_SLOPE_RISE_THRESHOLD)
  const lowSlopeSqft = lowSlopeFaces.reduce((s, f) => s + f.sloped_area_ft2, 0)
  const totalFaces = faces.length
  const lowSlopeCount = lowSlopeFaces.length

  // Eave LF on standard-pitch faces only — proportional approximation
  // since face-to-edge mapping is not resolved at this layer.
  const lowSlopeFraction = totalFaces > 0 ? lowSlopeCount / totalFaces : 0
  const standardPitchFraction = 1 - lowSlopeFraction
  const standardPitchEaveFt = totalEaveFt * standardPitchFraction

  // Per-section integration when caller supplied per-section data. Each
  // structure's eave strip is independent: low-slope faces still excluded by
  // the same proportional fraction, but the strip *width* is each section's
  // own overhang + heated-wall offset rather than a global max.
  let eaveStripSqft = 0
  let stripDepthForReport = 0
  let perSectionUsed = false
  if (perSectionEave && perSectionEave.length > 0) {
    perSectionUsed = true
    let weightedDepthNum = 0
    let weightedDepthDen = 0
    for (const sec of perSectionEave) {
      const eaveLf = Math.max(0, sec.eave_lf_ft) * standardPitchFraction
      const depth = (sec.depth_ft && sec.depth_ft > 0 ? sec.depth_ft : EAVE_OVERHANG_DEFAULT_FT) + EAVE_PAST_WALL_FT
      eaveStripSqft += eaveLf * depth
      weightedDepthNum += depth * eaveLf
      weightedDepthDen += eaveLf
    }
    stripDepthForReport = weightedDepthDen > 0 ? weightedDepthNum / weightedDepthDen : EAVE_OVERHANG_DEFAULT_FT + EAVE_PAST_WALL_FT
  } else {
    const overhangFt = eaveDepths.length > 0
      ? Math.max(...eaveDepths.map(l => l.depth_ft), EAVE_OVERHANG_DEFAULT_FT)
      : EAVE_OVERHANG_DEFAULT_FT
    stripDepthForReport = overhangFt + EAVE_PAST_WALL_FT
    eaveStripSqft = standardPitchEaveFt * stripDepthForReport
  }
  const valleySqft = totalValleyFt * IW_VALLEY_HALF_WIDTH_FT * 2

  const totalSqft = lowSlopeSqft + eaveStripSqft + valleySqft
  const totalRolls = Math.ceil(totalSqft / IW_ROLL_SQFT)

  const notes: string[] = []
  if (lowSlopeSqft > 0) {
    notes.push(`Low-slope coverage: ${lowSlopeCount} face(s) below 2:12 → ${round(lowSlopeSqft, 0)} sqft full I&W per IRC R905.1.2.`)
  }
  if (eaveStripSqft > 0) {
    if (perSectionUsed && perSectionEave!.length > 1) {
      const segs = perSectionEave!
        .map(s => `${round(Math.max(0, s.eave_lf_ft) * standardPitchFraction, 0)}LF × ${round((s.depth_ft || EAVE_OVERHANG_DEFAULT_FT) + EAVE_PAST_WALL_FT, 1)}ft`)
        .join(' + ')
      notes.push(`Eave strip (per-structure): ${segs} = ${round(eaveStripSqft, 0)} sqft.`)
    } else {
      notes.push(`Eave strip: ${round(standardPitchEaveFt, 0)} LF × ${round(stripDepthForReport, 1)} ft (overhang + 24" past heated wall) = ${round(eaveStripSqft, 0)} sqft.`)
    }
  }
  if (valleySqft > 0) {
    notes.push(`Valley coverage: ${round(totalValleyFt, 0)} LF × 3 ft × 2 sides = ${round(valleySqft, 0)} sqft.`)
  }
  if (totalFaces > 0 && lowSlopeCount > 0 && lowSlopeCount < totalFaces) {
    notes.push('Eave LF on low-slope faces is excluded from the strip calc using a proportional approximation; verify against per-face edge mapping for high-stakes quotes.')
  }

  return {
    low_slope_full_coverage_sqft: round(lowSlopeSqft, 1),
    low_slope_face_count: lowSlopeCount,
    eave_strip_sqft: round(eaveStripSqft, 1),
    eave_strip_depth_ft: round(stripDepthForReport, 2),
    valley_sqft: round(valleySqft, 1),
    total_sqft: round(totalSqft, 1),
    total_rolls_2sq: totalRolls,
    trigger_notes: notes,
  }
}

function materialsEstimate(
  netSquares: number, wasteFrac: number,
  eaveFt: number, ridgeFt: number, hipFt: number, valleyFt: number, rakeFt: number,
  faces?: { pitch_rise: number; sloped_area_ft2: number }[],
  eaveDepths?: EaveDepthLayer[],
  flashings?: {
    step_flashing_ft?: number
    headwall_flashing_ft?: number
    chimney_count?: number
    pipe_boot_count?: number
  },
  perSectionEave?: Array<{ section_index: number; eave_lf_ft: number; depth_ft: number }>
): TraceMaterialEstimate {
  const gross = netSquares * (1 + wasteFrac)
  const iw = computeIceWaterBreakdown(faces || [], eaveFt, valleyFt, eaveDepths || [], perSectionEave)
  const f = flashings || {}
  return {
    shingles_squares_net:       round(netSquares, 2),
    shingles_squares_gross:     round(gross, 2),
    shingles_bundles:           Math.ceil(gross * BUNDLES_PER_SQ),
    underlayment_rolls:         Math.ceil(gross / SQ_PER_UNDERLAY),
    ice_water_shield_sqft:      iw.total_sqft,
    ice_water_shield_rolls_2sq: iw.total_rolls_2sq,
    ice_water_breakdown:        iw,
    ridge_cap_lf:               round(ridgeFt + hipFt, 1),
    ridge_cap_bundles:          Math.ceil((ridgeFt + hipFt) / LF_PER_RIDGE_BUNDLE),
    starter_strip_lf:           round(eaveFt + rakeFt, 1),
    drip_edge_eave_lf:          round(eaveFt, 1),
    drip_edge_rake_lf:          round(rakeFt, 1),
    drip_edge_total_lf:         round(eaveFt + rakeFt, 1),
    valley_flashing_lf:         round(valleyFt * 1.10, 1),
    step_flashing_lf:           round((f.step_flashing_ft || 0) * 1.10, 1),
    headwall_flashing_lf:       round((f.headwall_flashing_ft || 0) * 1.05, 1),
    chimney_flashing_count:     Math.max(0, Math.round(f.chimney_count || 0)),
    pipe_boot_count:            Math.max(0, Math.round(f.pipe_boot_count || 0)),
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

  // Eave depth layers (per-section overhang)
  private eaveDepths: EaveDepthLayer[]
  // Obstructions (chimneys, skylights, etc.)
  private obstructions: Obstruction[]
  // Cutouts — non-roof voids inside the outline (decks between levels, etc.)
  private cutouts: Cutout[]
  // Small corner threshold (ft)
  private smallCornerThresholdFt: number
  // Optional external-source footprint for cross-check
  private crossCheckSource: { source: string; footprint_ft2: number } | null

  // Raw WGS84 inputs
  private rawEaves: TracePt[]
  private rawEavesSections: TracePt[][] // extra sections for multi-section roofs
  // Per-section pitch (rise:12) parallel to rawEavesSections. null = use
  // engine default. Lets dormers/additions ride at their own pitch.
  private rawEavesSectionPitches: Array<number | null> = []
  // Per-section kind tag parallel to rawEavesSections. 'lower_tier' marks a
  // visible lower-eave lip beneath an upper-story roof. Drives the report
  // labeling ("Lower Eave N") and the 2D diagram's distinct rendering.
  private rawEavesSectionKinds: Array<'main' | 'lower_tier'> = []
  // Dormers — features inside the main outline. Each carries its own pitch.
  // The engine adds only the *differential* sloped area to the totals, never
  // any new footprint, so dormers don't get double-counted on the ground.
  private rawDormers: Array<{ polygon: TracePt[]; pitch_rise: number; label?: string }> = []
  private rawRidges: TraceLine[]
  private rawHips: TraceLine[]
  private rawValleys: TraceLine[]
  private rawRakes: TraceLine[]
  private rawFaces: TraceFace[]

  // Projected Cartesian geometry
  private origin: { lat: number; lng: number }
  private snapper: VertexSnapper
  private eavesCart: CartesianPt[]
  // Extra eave sections (garage, porch, etc.) projected to Cartesian so the
  // common-run algorithm can project hips/valleys to the *nearest* section,
  // not only the primary polygon. Index 0 is always this.eavesCart.
  private allEavesCart: CartesianPt[][] = []
  private ridgesCart: { id: string; pts: CartesianPt[]; pitch: number | null; slope_ref: string }[]
  private hipsCart: { id: string; pts: CartesianPt[]; pitch: number | null; slope_ref: string }[]
  private valleysCart: { id: string; pts: CartesianPt[]; pitch: number | null; slope_ref: string }[]
  private rakesCart: { id: string; pts: CartesianPt[]; pitch: number | null; slope_ref: string }[]
  private facesCart: { face_id: string; poly: CartesianPt[]; pitch: number; label: string }[]
  // DSM-derived per-plane pitches (rise:12) projected into engine-local cartesian.
  // Empty when the caller did not supply plane_segments_lat_lng.
  private planeSegmentsCart: { x: number; y: number; pitch_rise: number; area_m2: number }[] = []
  // Per-eave-edge tags ('eave' | 'rake') captured during tracing. Index aligns
  // with the from_pt index of each EaveEdge. Empty array = infer (legacy).
  private eavesTags: Array<'eave' | 'rake'> = []
  // Tags parallel to rawEavesSections — see TracePayload.eaves_sections_tags.
  private eavesSectionsTags: Array<Array<'eave' | 'rake'>> = []
  // Flashings — pre-computed haversine totals from traceUiToEnginePayload.
  // Engine doesn't need to project these (flat metal pieces, no slope correction).
  private stepFlashingFt = 0
  private headwallFlashingFt = 0
  private chimneyCount = 0
  private pipeBootCount = 0

  constructor(payload: TracePayload) {
    this.address    = payload.address || 'Unknown Address'
    this.homeowner  = payload.homeowner || 'Unknown'
    this.orderId    = payload.order_id || ''
    this.defPitch   = payload.default_pitch || 5.0
    this.complexity = payload.complexity || 'medium'
    this.incWaste   = payload.include_waste !== false
    this.timestamp  = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'

    // Multi-layer eave depths
    this.eaveDepths = payload.eave_depths || []
    // Obstructions (chimneys, skylights, vents)
    this.obstructions = payload.obstructions || []
    // Cutouts (decks between levels, atriums, courtyards) — interior voids
    this.cutouts = payload.cutouts || []
    // Small eave corner threshold (default 2 ft — edges shorter than this get flagged)
    this.smallCornerThresholdFt = payload.small_corner_threshold_ft ?? 2.0
    this.crossCheckSource = payload.cross_check && payload.cross_check.footprint_ft2 > 0
      ? { source: payload.cross_check.source, footprint_ft2: payload.cross_check.footprint_ft2 }
      : null

    // Per-edge eave/rake tags from the tracing UI. Stored verbatim; honored in
    // run() only when length matches the eaves outline so a misaligned array
    // can never silently shift accounting.
    this.eavesTags = Array.isArray(payload.eaves_tags)
      ? payload.eaves_tags.filter((t): t is 'eave' | 'rake' => t === 'eave' || t === 'rake')
      : []
    // Per-section eave/rake tags for secondary structures. Each entry is a
    // tag array for the corresponding `eaves_sections[i]`. Honored only when
    // length ≥ section vertex count; otherwise that section falls back to
    // all-eave attribution.
    this.eavesSectionsTags = Array.isArray(payload.eaves_sections_tags)
      ? payload.eaves_sections_tags.map(arr =>
          Array.isArray(arr)
            ? arr.filter((t): t is 'eave' | 'rake' => t === 'eave' || t === 'rake')
            : []
        )
      : []

    // Flashings (haversine LF + counts) — passthrough from trace payload.
    this.stepFlashingFt     = Number(payload.flashing_lengths_ft?.step) || 0
    this.headwallFlashingFt = Number(payload.flashing_lengths_ft?.headwall) || 0
    this.chimneyCount       = Math.max(0, Math.round(Number(payload.flashing_counts?.chimneys) || 0))
    this.pipeBootCount      = Math.max(0, Math.round(Number(payload.flashing_counts?.pipe_boots) || 0))

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
    // Extra eaves sections: filter to those different from the primary outline.
    // Per-section pitches must be filtered alongside in lockstep so the parallel
    // arrays stay index-aligned.
    {
      const inputSections = payload.eaves_sections || []
      const inputPitches  = payload.eaves_section_pitches || []
      const inputKinds    = payload.eaves_section_kinds || []
      const kept: TracePt[][] = []
      const keptPitches: Array<number | null> = []
      const keptKinds: Array<'main' | 'lower_tier'> = []
      inputSections.forEach((sec, i) => {
        if (sec !== payload.eaves_outline && sec.length >= 3) {
          kept.push(sec.map(p => ({ lat: p.lat, lng: p.lng, elevation: p.elevation ?? null })))
          const p = inputPitches[i]
          keptPitches.push(typeof p === 'number' && isFinite(p) && p > 0 && p <= 30 ? p : null)
          const k = inputKinds[i]
          keptKinds.push(k === 'lower_tier' ? 'lower_tier' : 'main')
        }
      })
      this.rawEavesSections       = kept
      this.rawEavesSectionPitches = keptPitches
      this.rawEavesSectionKinds   = keptKinds
    }
    // Dormers — validate polygon (3+ pts) + pitch_rise (0 < p ≤ 30). Drop
    // invalid entries so a malformed dormer can't blow up the run.
    if (Array.isArray(payload.dormers)) {
      this.rawDormers = payload.dormers
        .filter(d =>
          d && Array.isArray(d.polygon) && d.polygon.length >= 3 &&
          typeof d.pitch_rise === 'number' && isFinite(d.pitch_rise) &&
          d.pitch_rise > 0 && d.pitch_rise <= 30
        )
        .map(d => ({
          polygon: d.polygon.map(p => ({ lat: p.lat, lng: p.lng, elevation: p.elevation ?? null })),
          pitch_rise: d.pitch_rise,
          label: d.label,
        }))
    }
    this.rawRidges  = this.parseLines(payload.ridges || [])
    this.rawHips    = this.parseLines(payload.hips || [])
    this.rawValleys = this.parseLines(payload.valleys || [])
    this.rawRakes   = this.parseLines(payload.rakes || [])
    this.rawFaces   = this.parseFaces(payload.faces || [])

    // STEP 1: Project all points to local Cartesian
    const { origin, projected } = projectToCartesian(this.rawEaves)
    this.origin = origin

    // Project DSM-derived plane centroids into engine-local cartesian so face
    // polygons (also cartesian) can find their best-matching plane via a simple
    // point-in-polygon test in faceAreas().
    if (payload.plane_segments_lat_lng && payload.plane_segments_lat_lng.length > 0) {
      this.planeSegmentsCart = payload.plane_segments_lat_lng
        .filter(seg => Number.isFinite(seg.pitch_rise) && seg.pitch_rise > 0
          && Number.isFinite(seg.centroid?.lat) && Number.isFinite(seg.centroid?.lng))
        .map(seg => {
          const cp = projectPoint(
            { lat: seg.centroid.lat, lng: seg.centroid.lng, elevation: null },
            this.origin.lat,
            this.origin.lng,
          )
          return {
            x: cp.x,
            y: cp.y,
            pitch_rise: seg.pitch_rise,
            area_m2: seg.area_m2 ?? 0,
          }
        })
    }

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

    // Project extra eave sections (garage, porch, additions) into Cartesian.
    // Used by common-run projection so hips/valleys over a secondary roof
    // don't get pulled toward an unrelated primary-polygon edge.
    this.allEavesCart = [this.eavesCart]
    for (let si = 0; si < this.rawEavesSections.length; si++) {
      const sec = this.rawEavesSections[si]
      const projSec = sec.map((p, i) => {
        const cp = projectPoint(p, this.origin.lat, this.origin.lng)
        const snapped = this.snapper.snap(cp.x, cp.y, cp.z, `eave_sec${si}_${i}`)
        return { ...cp, x: snapped.x, y: snapped.y, z: snapped.z }
      })
      if (projSec.length >= 3) {
        const f = projSec[0], l = projSec[projSec.length - 1]
        if (dist2D(f, l) > 0.01) projSec.push({ ...f })
        this.allEavesCart.push(projSec)
      }
    }

    // Snap & project all line segments
    this.ridgesCart  = this.projectLines(this.rawRidges, 'ridge')
    this.hipsCart    = this.projectLines(this.rawHips, 'hip')
    this.valleysCart = this.projectLines(this.rawValleys, 'valley')
    this.rakesCart   = this.projectLines(this.rawRakes, 'rake')

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
  //
  // Searches across ALL eave sections (primary + extras) to handle
  // multi-structure roofs (garage + main house). Returns the distance to
  // the best edge plus a confidence score:
  //   confidence = 1 - (best / secondBest)   → 0 when two edges are
  //   equidistant (ambiguous), ≈1 when best clearly wins.

  private computeCommonRunFt(px: number, py: number): number {
    return this.computeCommonRun(px, py).runFt
  }

  private computeCommonRun(px: number, py: number): {
    runFt: number
    confidence: number
    section_index: number
  } {
    const sections = this.allEavesCart
    if (!sections.length || sections[0].length < 2) {
      return { runFt: 0, confidence: 0, section_index: -1 }
    }
    let best = Infinity
    let second = Infinity
    let bestSection = 0
    for (let s = 0; s < sections.length; s++) {
      const ring = sections[s]
      const n = ring.length - 1
      for (let i = 0; i < n; i++) {
        const a = ring[i], b = ring[i + 1]
        const { projX, projY } = pointToLineProjection(px, py, a.x, a.y, b.x, b.y)
        const d = Math.sqrt((px - projX) ** 2 + (py - projY) ** 2)
        if (d < best) {
          second = best
          best = d
          bestSection = s
        } else if (d < second) {
          second = d
        }
      }
    }
    const confidence = second === Infinity || second < 1e-9
      ? 1
      : Math.max(0, Math.min(1, 1 - best / second))
    return { runFt: best * M_TO_FT, confidence, section_index: bestSection }
  }

  // ── TRUE LENGTH with common-run algorithm ──────────────

  private computeTrueLength(
    horizM: number,
    theta: number,
    kind: string,
    pts: CartesianPt[],
    hasZ: boolean
  ): { sloped: number; commonRunFt: number; deltaZFt: number; projectionConfidence: number; projectionSection: number } {
    const cat = categoriseLine(kind)
    const horizFt = horizM * M_TO_FT

    if (cat === 'horizontal') {
      return { sloped: horizFt, commonRunFt: 0, deltaZFt: 0, projectionConfidence: 1, projectionSection: -1 }
    }

    // If we have DSM elevation data, use true 3D distance
    if (hasZ) {
      const sloped3D = polyline3DLengthM(pts) * M_TO_FT
      return { sloped: sloped3D, commonRunFt: 0, deltaZFt: 0, projectionConfidence: 1, projectionSection: -1 }
    }

    // ── Apply formulas from Python engine ──

    if (kind === 'rake') {
      // rake true_len = 2D / cos(θ)
      const cosT = Math.cos(theta)
      if (cosT < 1e-9) {
        throw new Error(`Vertical slope produces infinite rake length`)
      }
      return { sloped: horizFt / cosT, commonRunFt: 0, deltaZFt: 0, projectionConfidence: 1, projectionSection: -1 }
    }

    if (kind === 'hip' || kind === 'valley') {
      // Common run: project endpoint farthest from eave onto the nearest
      // eave edge ACROSS ALL SECTIONS (primary + extras).
      let maxR = 0
      let conf = 1
      let sec = -1
      for (const pt of pts) {
        const r = this.computeCommonRun(pt.x, pt.y)
        if (r.runFt > maxR) {
          maxR = r.runFt
          conf = r.confidence
          sec = r.section_index
        }
      }
      const deltaZ = maxR * Math.tan(theta)
      const slopedFt = Math.sqrt(horizFt * horizFt + deltaZ * deltaZ)
      return { sloped: slopedFt, commonRunFt: maxR, deltaZFt: deltaZ, projectionConfidence: conf, projectionSection: sec }
    }

    // Default: slope factor
    const rise = this.defPitch
    const sf = slopeFactor(rise)
    return { sloped: horizFt * sf, commonRunFt: 0, deltaZFt: 0, projectionConfidence: 1, projectionSection: -1 }
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

      const { sloped, commonRunFt, deltaZFt, projectionConfidence, projectionSection } = this.computeTrueLength(
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
        projection_confidence:    round(projectionConfidence, 3),
        projection_section_index: projectionSection,
      }
    })
  }

  // ── FACE ↔ DSM PLANE MATCHING ────────────────────────
  // Find the DSM-derived plane whose centroid lies inside the given face
  // polygon. Returns the plane's pitch_rise (rise:12) or null when no match.
  // When several planes overlap a single face, prefer the one with the
  // largest reported area_m2 (ties broken by closest centroid).
  private matchPlanePitchToFace(facePts: { x: number; y: number }[]): number | null {
    if (this.planeSegmentsCart.length === 0 || facePts.length < 3) return null

    let best: { pitch_rise: number; area_m2: number; dist2: number } | null = null
    for (const plane of this.planeSegmentsCart) {
      if (!pointInPolygon2D(plane.x, plane.y, facePts)) continue
      const fxAvg = facePts.reduce((s, p) => s + p.x, 0) / facePts.length
      const fyAvg = facePts.reduce((s, p) => s + p.y, 0) / facePts.length
      const dist2 = (plane.x - fxAvg) ** 2 + (plane.y - fyAvg) ** 2
      if (!best
        || plane.area_m2 > best.area_m2
        || (plane.area_m2 === best.area_m2 && dist2 < best.dist2)) {
        best = { pitch_rise: plane.pitch_rise, area_m2: plane.area_m2, dist2 }
      }
    }
    return best?.pitch_rise ?? null
  }

  // ── FACE AREA CALCULATION ────────────────────────────

  faceAreas(): FaceDetail[] {
    const results: FaceDetail[] = []

    if (this.facesCart.length > 0) {
      for (const face of this.facesCart) {
        const projM2 = shoelaceAreaM2(face.poly)
        const projFt2 = projM2 * M2_TO_FT2
        const sloped = slopedFromProjected(projFt2, face.pitch)
        const polygonLL = face.poly.map(p => ({ lat: p.lat, lng: p.lng }))
        results.push({
          face_id:            face.face_id,
          pitch_rise:         face.pitch,
          pitch_label:        `${round(face.pitch, 1)}:12`,
          pitch_angle_deg:    round(pitchAngleDeg(face.pitch), 1),
          slope_factor:       round(slopeFactor(face.pitch), 4),
          projected_area_ft2: round(projFt2, 1),
          sloped_area_ft2:    round(sloped, 1),
          squares:            round(sloped / SQFT_PER_SQUARE, 3),
          polygon:            polygonLL,
          azimuth_deg:        estimateFaceAzimuth(face.poly),
        })
      }
    } else if (this.eavesCart.length >= 4) {
      const totalProjFt2 = this.computeFootprintSqft()

      if (this.ridgesCart.length > 0 && this.hipsCart.length > 0) {
        // ── GEOMETRIC FACE SPLITTING ──
        // Use ridge and hip endpoints to split the eave polygon into faces
        // Each face is bounded by eave edges + hip/ridge lines
        // This produces geometrically accurate per-face areas instead of equal division
        
        const facePolys = this.splitEavePolygonIntoFaces()
        
        if (facePolys.length > 0) {
          let assignedArea = 0
          for (let i = 0; i < facePolys.length; i++) {
            const polyArea = shoelaceAreaM2(facePolys[i].pts) * M2_TO_FT2
            // Per-facet pitch from DSM RANSAC takes priority over the ridge-resolved
            // pitch when a plane centroid falls inside this face. Falls back to the
            // ridge-resolved (or default) theta when no plane matches.
            const dsmPitch = this.matchPlanePitchToFace(facePolys[i].pts)
            let theta: number
            if (dsmPitch != null) {
              theta = pitchAngleRad(dsmPitch)
            } else {
              const resolved = facePolys[i].ridge ? this.resolveTheta(facePolys[i].ridge) : { theta: this.defThetaRad }
              theta = resolved.theta
            }
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
              azimuth_deg:        estimateFaceAzimuth(facePolys[i].pts),
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
        } else {
          // Fallback: proportional split based on eave perimeter contribution
          this.proportionalFaceSplit(results, totalProjFt2)
        }
      } else if (this.ridgesCart.length > 0) {
        // Has ridges but no hips — use proportional splitting based on
        // ridge position relative to eave bounding box
        this.proportionalFaceSplit(results, totalProjFt2)
      } else {
        const rise = this.defPitch
        const sloped = slopedFromProjected(totalProjFt2, rise)
        results.push({
          face_id:            'total_roof',
          pitch_rise:         rise,
          pitch_label:        `${round(rise, 1)}:12`,
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

  // ── AGGREGATE FACE FALLBACK ──────────────────────────
  // Multi-ridge roofs that don't fit splitEavePolygonIntoFaces' single-ridge
  // hip pattern fall through here. The previous behaviour invented N synthetic
  // faces by dividing total area into bounding-box buckets, producing
  // misleading "A=970, B=970, C=970, D=970" rows that read as real per-plane
  // measurements but were just (total / N). One honest aggregate row beats
  // four fake ones.

  private proportionalFaceSplit(results: FaceDetail[], totalProjFt2: number): void {
    const rise = this.defPitch
    const sloped = slopedFromProjected(totalProjFt2, rise)
    results.push({
      face_id: 'total_roof',
      pitch_rise: rise,
      pitch_label: `${round(rise, 1)}:12`,
      pitch_angle_deg: round(pitchAngleDeg(rise), 1),
      slope_factor: round(slopeFactor(rise), 4),
      projected_area_ft2: round(totalProjFt2, 1),
      sloped_area_ft2: round(sloped, 1),
      squares: round(sloped / SQFT_PER_SQUARE, 3),
    })
  }

  // ── OBSTRUCTION AREA CALCULATION ─────────────────────
  // Computes projected area for each chimney, skylight, vent polygon
  // and converts to sloped area using dominant pitch

  computeObstructions(domPitch: number): ObstructionDetail[] {
    if (this.obstructions.length === 0) return []
    const results: ObstructionDetail[] = []
    for (const obs of this.obstructions) {
      let projFt2 = 0
      if (obs.poly && obs.poly.length >= 3) {
        // Project obstruction polygon to Cartesian and compute area
        const { projected: obsCart } = projectToCartesian(obs.poly)
        projFt2 = shoelaceAreaM2(obsCart) * M2_TO_FT2
      } else if (obs.width_ft && obs.length_ft) {
        // Simple rectangle (e.g. chimney 3ft x 4ft)
        projFt2 = obs.width_ft * obs.length_ft
      }
      if (projFt2 > 0) {
        const slopedFt2 = slopedFromProjected(projFt2, domPitch)
        results.push({
          type: obs.type || 'other',
          label: obs.label || obs.type || 'obstruction',
          projected_area_ft2: round(projFt2, 1),
          sloped_area_ft2: round(slopedFt2, 1),
        })
      }
    }
    return results
  }

  // ── CUTOUT AREA CALCULATION ──────────────────────────
  // Computes projected and sloped area for each non-roof void polygon
  // (decks between levels, atriums, courtyards). Mirrors computeObstructions
  // but emitted under cutout_details, not obstruction_details.

  computeCutouts(domPitch: number): CutoutDetail[] {
    if (this.cutouts.length === 0) return []
    const results: CutoutDetail[] = []
    for (const cut of this.cutouts) {
      if (!cut.poly || cut.poly.length < 3) continue
      const { projected: cutCart } = projectToCartesian(cut.poly)
      const projFt2 = shoelaceAreaM2(cutCart) * M2_TO_FT2
      if (projFt2 > 0) {
        const slopedFt2 = slopedFromProjected(projFt2, domPitch)
        results.push({
          label: cut.label || 'Excluded non-roof area',
          projected_area_ft2: round(projFt2, 1),
          sloped_area_ft2: round(slopedFt2, 1),
        })
      }
    }
    return results
  }

  // ── EAVE CORNER ANALYSIS ─────────────────────────────
  // Identifies small corners (short edges at sharp angles) that may
  // need special flashing treatment or indicate dormers/returns

  analyzeEaveCorners(): EaveCornerDetail[] {
    const edges = this.eaveEdges()
    if (edges.length < 2) return edges.map(e => ({
      edge_num: e.edge_num,
      length_ft: e.length_2d_ft,
      bearing_deg: e.bearing_deg,
      is_small_corner: e.length_2d_ft < this.smallCornerThresholdFt,
      angle_change_deg: 0,
    }))

    const result: EaveCornerDetail[] = []
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i]
      const prev = edges[(i - 1 + edges.length) % edges.length]
      // Compute interior angle change (bearing difference)
      let angleDelta = edge.bearing_deg - prev.bearing_deg
      // Normalize to -180..180
      while (angleDelta > 180) angleDelta -= 360
      while (angleDelta < -180) angleDelta += 360

      const isSmall = edge.length_2d_ft < this.smallCornerThresholdFt
      result.push({
        edge_num: edge.edge_num,
        length_ft: edge.length_2d_ft,
        bearing_deg: edge.bearing_deg,
        is_small_corner: isSmall,
        angle_change_deg: round(Math.abs(angleDelta), 1),
      })
    }
    return result
  }

  // ═══════════════════════════════════════════════════════════════
  // FULL CALCULATION RUN
  // ═══════════════════════════════════════════════════════════════

  run(): TraceReport {
    const edges = this.eaveEdges()
    let totalEaveFt = edges.reduce((s, e) => s + e.length_2d_ft, 0)

    const ridgeSegs  = this.lineDetails(this.ridgesCart, 'ridge')
    const hipSegs    = this.lineDetails(this.hipsCart, 'hip')
    const valleySegs = this.lineDetails(this.valleysCart, 'valley')
    const rakeSegs   = this.lineDetails(this.rakesCart, 'rake')

    const totalRidgeFt  = ridgeSegs.reduce((s, seg) => s + seg.sloped_length_ft, 0)
    const totalHipFt    = hipSegs.reduce((s, seg) => s + seg.sloped_length_ft, 0)
    const totalValleyFt = valleySegs.reduce((s, seg) => s + seg.sloped_length_ft, 0)
    let totalRakeFt     = rakeSegs.reduce((s, seg) => s + seg.sloped_length_ft, 0)

    // Per-edge eave/rake tagging — only applied when the user-supplied tag
    // count matches the eave-edge count, so an off-by-one cannot silently
    // mis-attribute footage. Tags index by from_pt: tag[i] applies to the
    // edge starting at vertex i.
    if (this.eavesTags.length > 0 && this.eavesTags.length >= edges.length) {
      let rakeFromTags = 0
      let eaveFromTags = 0
      for (const e of edges) {
        const tag = this.eavesTags[e.from_pt]
        if (tag === 'rake') rakeFromTags += e.length_2d_ft
        else eaveFromTags += e.length_2d_ft
      }
      totalEaveFt = eaveFromTags
      totalRakeFt = totalRakeFt + rakeFromTags
    }

    // Multi-structure: walk each secondary eaves section per-edge so we can
    // (a) honor per-section eave/rake tags when the UI ships them — falling
    // back to all-eave attribution otherwise, (b) yield individual edges for
    // the report's eave_edge_breakdown so a customer can see "Garage East:
    // 20 ft" instead of just a summed total, and (c) record per-section
    // eave LF for the per-section ice & water strip integration.
    const perSectionEaveLF: Array<{ section_index: number; eave_lf_ft: number; depth_ft: number }> = []
    const secondaryEaveEdges: EaveEdge[] = []
    // Primary section's eave LF & depth (section_index 0). Computed AFTER
    // primary tag handling above so it reflects the post-tag totalEaveFt.
    {
      const primaryDepthFt = this.eaveDepths.find(l => l.section_index === 0)?.depth_ft ?? EAVE_OVERHANG_DEFAULT_FT
      perSectionEaveLF.push({ section_index: 0, eave_lf_ft: totalEaveFt, depth_ft: primaryDepthFt })
    }
    if (this.rawEavesSections.length > 0) {
      for (let si = 0; si < this.rawEavesSections.length; si++) {
        const secPts = this.rawEavesSections[si]
        const { projected: secCart } = projectToCartesian(secPts)
        if (secCart.length < 3) continue
        const tags = this.eavesSectionsTags[si] || []
        const tagsValid = tags.length >= secCart.length
        let secEaveFt = 0
        let secRakeFt = 0
        for (let i = 0; i < secCart.length; i++) {
          const a = secCart[i]
          const b = secCart[(i + 1) % secCart.length]
          const len2D = dist2D(a, b) * M_TO_FT
          const bearing = ((Math.atan2(b.x - a.x, b.y - a.y) * 180 / Math.PI) % 360 + 360) % 360
          const tag: 'eave' | 'rake' = tagsValid && tags[i] === 'rake' ? 'rake' : 'eave'
          if (tag === 'rake') secRakeFt += len2D
          else secEaveFt += len2D
          secondaryEaveEdges.push({
            edge_num: i + 1,
            from_pt: i + 1,
            to_pt: ((i + 1) % secCart.length) + 1,
            length_2d_ft: round(len2D, 2),
            length_3d_ft: round(len2D, 2),
            length_ft: round(len2D, 2),
            bearing_deg: round(bearing, 1),
            section_index: si + 1,
          } as EaveEdge & { section_index: number })
        }
        totalEaveFt += secEaveFt
        totalRakeFt += secRakeFt
        const secDepthFt = this.eaveDepths.find(l => l.section_index === si + 1)?.depth_ft ?? EAVE_OVERHANG_DEFAULT_FT
        perSectionEaveLF.push({ section_index: si + 1, eave_lf_ft: secEaveFt, depth_ft: secDepthFt })
      }
    }

    const facesData   = this.faceAreas()
    let totalSloped = facesData.reduce((s, f) => s + f.sloped_area_ft2, 0)
    let totalProj   = facesData.reduce((s, f) => s + f.projected_area_ft2, 0)

    // Snapshot the primary outline's totals before adding extra sections — used
    // to render the per-structure breakdown when the report has dormers/extras.
    const primaryProjFt2 = totalProj
    const primarySlopedFt2 = totalSloped

    // Add footprint areas from extra eaves sections (garages, porches, dormers, etc.)
    // Each extra section is measured independently and added to the total. When
    // the user specified a per-section pitch (e.g. a steeper dormer), that
    // pitch is applied to the section's sloped area; otherwise it falls back
    // to the engine default. Per-section area & pitch are also captured for
    // surfacing in the report's Project Totals.
    const sectionPitchAreas: Array<{
      section_index: number
      pitch_rise: number
      projected_ft2: number
      sloped_ft2: number
      is_user_specified: boolean
      kind: 'main' | 'lower_tier'
    }> = []
    // Track per-section projected polygons so we can warn when a 'lower_tier'
    // lip overlaps another section's footprint by >25% — that means the user
    // traced under the upper roof (rather than only the visible lip), which
    // would cause the disjoint-area math to double-count.
    const sectionPolysCart: { idx: number; poly: CartesianPt[]; kind: 'main' | 'lower_tier' }[] = []
    if (this.rawEavesSections.length > 0) {
      for (let i = 0; i < this.rawEavesSections.length; i++) {
        const secPts = this.rawEavesSections[i]
        const userPitch = this.rawEavesSectionPitches[i]
        const secKind = this.rawEavesSectionKinds[i] || 'main'
        const secRise = (userPitch != null && userPitch > 0) ? userPitch : this.defPitch
        const { projected: secCart } = projectToCartesian(secPts)
        const secProjFt2 = shoelaceAreaM2(secCart) * M2_TO_FT2
        const secSloped  = slopedFromProjected(secProjFt2, secRise)
        totalProj   += secProjFt2
        totalSloped += secSloped
        sectionPitchAreas.push({
          section_index: i + 1,                 // 0 reserved for primary
          pitch_rise: secRise,
          projected_ft2: secProjFt2,
          sloped_ft2: secSloped,
          is_user_specified: userPitch != null && userPitch > 0,
          kind: secKind,
        })
        sectionPolysCart.push({ idx: i + 1, poly: secCart, kind: secKind })
      }
    }

    // Dominant pitch (computed before obstruction deduction)
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

    // ── DORMERS (within the main outline, ride at their own pitch) ──
    // Each dormer adds only the differential sloped area:
    //   extra = footprint × (slopeFactor(dormer_pitch) − slopeFactor(main_pitch))
    // Footprint stays attributed to the main roof — no double-count on the
    // ground. This is what differentiates a dormer from a separate
    // eaves_section (which DOES add new footprint, e.g. detached garage).
    const dormerBreakdown: Array<{
      dormer_index: number
      label: string
      pitch_rise: number
      footprint_ft2: number
      extra_sloped_ft2: number
      main_pitch_rise: number
    }> = []
    if (this.rawDormers.length > 0) {
      // Helper — point-in-polygon (ray cast in lat/lng space).
      const dormerPointInPoly = (lat: number, lng: number, poly: { lat: number; lng: number }[]) => {
        let inside = false
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const xi = poly[i].lng, yi = poly[i].lat
          const xj = poly[j].lng, yj = poly[j].lat
          const intersect = ((yi > lat) !== (yj > lat))
            && (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi)
          if (intersect) inside = !inside
        }
        return inside
      }
      for (let i = 0; i < this.rawDormers.length; i++) {
        const d = this.rawDormers[i]
        const { projected: dCart } = projectToCartesian(d.polygon)
        const dProjFt2 = shoelaceAreaM2(dCart) * M2_TO_FT2
        if (dProjFt2 <= 0) continue
        // Find the underlying face that contains this dormer's centroid; use
        // THAT face's pitch as the "main" pitch the differential rides on.
        // Falls back to domPitch when the dormer doesn't sit cleanly inside
        // any single face (e.g. crosses a ridge — rare).
        let underlyingPitch = domPitch
        if (facesData.length > 0 && Array.isArray(d.polygon) && d.polygon.length >= 3) {
          let cLat = 0, cLng = 0
          for (const p of d.polygon) { cLat += p.lat; cLng += p.lng }
          cLat /= d.polygon.length; cLng /= d.polygon.length
          for (const f of facesData) {
            if (Array.isArray(f.polygon) && f.polygon.length >= 3
                && dormerPointInPoly(cLat, cLng, f.polygon)) {
              underlyingPitch = f.pitch_rise
              break
            }
          }
        }
        const mainSlopeFactor = slopeFactor(underlyingPitch)
        const dSlopeFactor    = slopeFactor(d.pitch_rise)
        const extraSloped = dProjFt2 * (dSlopeFactor - mainSlopeFactor)
        // Only add if the dormer is steeper than its underlying face; a
        // "flatter" dormer would conceptually subtract area, but that's a
        // strange edge case (low-slope addition on a steep main roof) —
        // clamp to ≥ 0 to avoid surprise area drops from minor pitch deltas.
        const extraClamped = Math.max(0, extraSloped)
        totalSloped += extraClamped
        dormerBreakdown.push({
          dormer_index: i + 1,
          label: d.label || `Dormer ${String.fromCharCode(65 + i)}`,
          pitch_rise: d.pitch_rise,
          footprint_ft2: dProjFt2,
          extra_sloped_ft2: extraClamped,
          main_pitch_rise: underlyingPitch,
        })
      }
    }

    // ── OBSTRUCTION DEDUCTION (chimneys, skylights, vents) ──
    const obstructionDetails = this.computeObstructions(domPitch)
    let obstructionDeductProjFt2 = 0
    let obstructionDeductSlopedFt2 = 0
    for (const obs of obstructionDetails) {
      obstructionDeductProjFt2 += obs.projected_area_ft2
      obstructionDeductSlopedFt2 += obs.sloped_area_ft2
    }
    // Subtract obstruction areas from totals
    totalProj   = Math.max(0, totalProj - obstructionDeductProjFt2)
    totalSloped = Math.max(0, totalSloped - obstructionDeductSlopedFt2)

    // ── CUTOUT DEDUCTION (decks between levels, atriums, courtyards) ──
    const cutoutDetails = this.computeCutouts(domPitch)
    let cutoutDeductProjFt2 = 0
    let cutoutDeductSlopedFt2 = 0
    for (const c of cutoutDetails) {
      cutoutDeductProjFt2   += c.projected_area_ft2
      cutoutDeductSlopedFt2 += c.sloped_area_ft2
    }
    totalProj   = Math.max(0, totalProj   - cutoutDeductProjFt2)
    totalSloped = Math.max(0, totalSloped - cutoutDeductSlopedFt2)

    const netSquares  = totalSloped / SQFT_PER_SQUARE

    const wasteBd = wasteBreakdown(
      domPitch, this.complexity,
      totalValleyFt,
      obstructionDetails.length,
      1 + this.rawEavesSections.length
    )
    const wFrac = this.incWaste ? wasteBd.total_pct / 100 : 0
    const grossSquares = netSquares * (1 + wFrac)
    const labor = laborEstimate(totalSloped, domPitch, this.complexity)

    // ── ICE & WATER BARRIER (IRC R905.1.2 / NBC) ──
    // Computed inside materialsEstimate via computeIceWaterBreakdown:
    //   • Low-slope faces (rise < 2:12) → full sloped-area coverage
    //   • Standard-pitch eaves           → eave LF × (overhang + 24")
    //   • Valleys                        → LF × 3 ft × 2 sides
    // Update primary section's recorded eave LF to the post-secondary-walk
    // total contribution from the primary outline only — perSectionEaveLF[0]
    // was set before secondary edges added their LF to totalEaveFt, so
    // subtract the secondaries' contribution back out for the primary entry
    // before passing to the I&W integrator. This keeps each section's
    // entry as its OWN eave LF rather than a running total.
    if (perSectionEaveLF.length > 1) {
      const secondaryEaveLfSum = perSectionEaveLF.slice(1).reduce((s, x) => s + x.eave_lf_ft, 0)
      perSectionEaveLF[0].eave_lf_ft = Math.max(0, totalEaveFt - secondaryEaveLfSum)
    } else {
      perSectionEaveLF[0].eave_lf_ft = totalEaveFt
    }
    const mat = materialsEstimate(
      netSquares, wFrac,
      totalEaveFt, totalRidgeFt, totalHipFt, totalValleyFt, totalRakeFt,
      facesData, this.eaveDepths,
      {
        step_flashing_ft:    this.stepFlashingFt,
        headwall_flashing_ft: this.headwallFlashingFt,
        chimney_count:       this.chimneyCount,
        pipe_boot_count:     this.pipeBootCount,
      },
      perSectionEaveLF
    )

    const perimeterFt = totalEaveFt + totalRakeFt

    // ── CORNER ANALYSIS ──
    const cornerAnalysis = this.analyzeEaveCorners()
    const smallCorners = cornerAnalysis.filter(c => c.is_small_corner)

    // Advisory notes
    const notes: string[] = []
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
    if (dormerBreakdown.length > 0) {
      const list = dormerBreakdown
        .map(d => `${d.label} ${round(d.pitch_rise, 1)}:12 (+${round(d.extra_sloped_ft2, 0)} sf)`)
        .join(', ')
      const totalExtra = dormerBreakdown.reduce((s, d) => s + d.extra_sloped_ft2, 0)
      notes.push(
        `${dormerBreakdown.length} dormer(s) measured at their own pitch — ` +
        `+${round(totalExtra, 0)} sf sloped area added to main roof: ${list}.`
      )
    }
    if (this.rawEavesSections.length > 0) {
      const customPitched = sectionPitchAreas.filter(s => s.is_user_specified)
      if (customPitched.length > 0) {
        const list = customPitched
          .map(s => `Section ${s.section_index + 1}: ${round(s.pitch_rise, 1)}:12`)
          .join(', ')
        notes.push(
          `Multi-section roof: ${this.rawEavesSections.length + 1} separate eaves polygon(s) — ` +
          `${customPitched.length} section(s) measured at user-specified pitch (${list}). ` +
          `Other sections use the dominant pitch ${round(this.defPitch, 1)}:12.`
        )
      } else {
        notes.push(`Multi-section roof: ${this.rawEavesSections.length + 1} separate eaves polygon(s) detected (e.g. garage, porch, dormer). Areas summed using dominant pitch ${round(this.defPitch, 1)}:12.`)
      }
    }

    // Obstruction notes
    if (obstructionDetails.length > 0) {
      const chimneys = obstructionDetails.filter(o => o.type === 'chimney')
      const skylights = obstructionDetails.filter(o => o.type === 'skylight')
      const vents = obstructionDetails.filter(o => o.type === 'vent')
      if (chimneys.length > 0)
        notes.push(`${chimneys.length} chimney(s) excluded — ${round(chimneys.reduce((s, c) => s + c.sloped_area_ft2, 0), 1)} sq ft deducted from roof area.`)
      if (skylights.length > 0)
        notes.push(`${skylights.length} skylight(s) excluded — ${round(skylights.reduce((s, c) => s + c.sloped_area_ft2, 0), 1)} sq ft deducted from roof area.`)
      if (vents.length > 0)
        notes.push(`${vents.length} vent(s) excluded — ${round(vents.reduce((s, c) => s + c.sloped_area_ft2, 0), 1)} sq ft deducted.`)
      notes.push(`Total obstruction deduction: ${round(obstructionDeductSlopedFt2, 1)} sq ft sloped area. Flashing required around all penetrations.`)
    }

    // Multi-layer eave depth notes
    if (this.eaveDepths.length > 0) {
      const depthSummary = this.eaveDepths.map(d =>
        `Section ${d.section_index}: ${d.depth_ft} ft${d.label ? ` (${d.label})` : ''}`
      ).join('; ')
      notes.push(`Multi-layer eave depth applied: ${depthSummary}. Ice & water shield calculated per-layer depth.`)
    }

    // Ice & water barrier trigger notes (IRC R905.1.2 / NBC)
    if (mat.ice_water_breakdown) {
      for (const n of mat.ice_water_breakdown.trigger_notes) notes.push(n)
    }

    // Small corner notes
    if (smallCorners.length > 0) {
      notes.push(`${smallCorners.length} small eave corner(s) detected (< ${this.smallCornerThresholdFt} ft). ` +
        `Edges: ${smallCorners.map(c => `#${c.edge_num} (${c.length_ft} ft, ${c.angle_change_deg}° turn)`).join(', ')}. ` +
        `May indicate dormers, bump-outs, or returns — verify and allow extra flashing/cut waste.`)
    }

    // Check for bi-slope junctions
    const biSlopeSegs = [...hipSegs, ...valleySegs].filter(s => s.is_bi_slope)
    if (biSlopeSegs.length > 0)
      notes.push(`${biSlopeSegs.length} bi-slope junction(s) detected — slope angles averaged at intersection.`)

    // Geometry warnings — validate primary eave ring + sections
    const geometryWarnings: string[] = []
    geometryWarnings.push(...validateEaveGeometry(this.eavesCart.map(p => ({ x: p.x, y: p.y }))))
    for (let si = 0; si < this.rawEavesSections.length; si++) {
      const secPts = this.rawEavesSections[si]
      const { projected: secCart } = projectToCartesian(secPts)
      const secWarn = validateEaveGeometry(secCart.map(p => ({ x: p.x, y: p.y })))
      for (const w of secWarn) geometryWarnings.push(`Section ${si + 2}: ${w}`)
    }
    // Tiny-section warning
    if (this.rawEavesSections.length > 0) {
      for (let si = 0; si < this.rawEavesSections.length; si++) {
        const secPts = this.rawEavesSections[si]
        const { projected: secCart } = projectToCartesian(secPts)
        let area = 0
        for (let i = 0; i < secCart.length; i++) {
          const a = secCart[i], b = secCart[(i + 1) % secCart.length]
          area += (a.x * b.y - b.x * a.y)
        }
        const areaFt2 = Math.abs(area / 2) * M_TO_FT * M_TO_FT
        if (areaFt2 > 0 && areaFt2 < 20) {
          geometryWarnings.push(`Section ${si + 2}: projected area ${round(areaFt2, 1)} sq ft is very small — check for stray points.`)
        }
      }
    }
    // Lower-tier lip sanity check — a 'lower_tier' section is the visible lip
    // beneath an upper-story roof and must NOT extend under the upper roof's
    // footprint, otherwise the disjoint-area math double-counts. Sample the
    // lip's centroid (cheap; fine-grained intersection isn't needed for a
    // warning) against every other section + the primary outline.
    if (this.rawEavesSections.length > 0) {
      const primaryCart = this.eavesCart.map(p => ({ x: p.x, y: p.y }))
      for (let si = 0; si < this.rawEavesSections.length; si++) {
        if (this.rawEavesSectionKinds[si] !== 'lower_tier') continue
        const lipPts = this.rawEavesSections[si]
        const { projected: lipCart } = projectToCartesian(lipPts)
        if (lipCart.length < 3) continue
        const cx = lipCart.reduce((s, p) => s + p.x, 0) / lipCart.length
        const cy = lipCart.reduce((s, p) => s + p.y, 0) / lipCart.length
        let inside = false
        if (pointInPolygon2D(cx, cy, primaryCart)) {
          inside = true
        } else {
          for (let oj = 0; oj < this.rawEavesSections.length; oj++) {
            if (oj === si) continue
            if (this.rawEavesSectionKinds[oj] === 'lower_tier') continue
            const { projected: otherCart } = projectToCartesian(this.rawEavesSections[oj])
            if (pointInPolygon2D(cx, cy, otherCart.map(p => ({ x: p.x, y: p.y })))) {
              inside = true
              break
            }
          }
        }
        if (inside) {
          geometryWarnings.push(`Lower Eave ${si + 1}: polygon centroid sits under another section. Trace only the visible lip beneath the upper roof — not the full lower footprint — so its area isn't double-counted.`)
        }
      }
    }
    for (const w of geometryWarnings) notes.push(`⚠ GEOMETRY: ${w}`)

    // Flag hip/valley lines whose common-run projection was ambiguous
    // (two or more eave edges from different sections were nearly equidistant).
    // This most often means the line was drawn between two roof structures
    // (main house / garage) and may be measuring the wrong one.
    const ambiguousProjections: string[] = []
    const allLines = [...hipSegs, ...valleySegs]
    for (const line of allLines) {
      if (line.common_run_ft > 0 && line.projection_confidence < 0.7) {
        ambiguousProjections.push(
          `${line.type} "${line.id}" projected with low confidence ` +
          `(${Math.round(line.projection_confidence * 100)}%) — verify it belongs to the intended eave section.`
        )
      }
    }
    for (const w of ambiguousProjections) notes.push(`⚠ PROJECTION: ${w}`)

    // Cross-check against external source (Solar API, EagleView, etc.)
    let crossCheck: CrossCheck | undefined
    let reviewFlag: ReviewFlag | undefined
    if (this.crossCheckSource && totalProj > 0) {
      const ext = this.crossCheckSource.footprint_ft2
      const variance = Math.abs(totalProj - ext) / ext * 100
      const verdict: CrossCheck['verdict'] =
        variance <= 3 ? 'aligned' : variance <= 8 ? 'minor_variance' : 'significant_variance'
      crossCheck = {
        source: this.crossCheckSource.source,
        external_footprint_ft2: round(ext, 1),
        engine_footprint_ft2: round(totalProj, 1),
        variance_pct: round(variance, 1),
        verdict,
      }
      // Hard reconciliation gate: > 10 % delta marks the report for review.
      if (variance > 10) {
        reviewFlag = {
          reason: 'footprint_mismatch',
          traced_ft2: round(totalProj, 1),
          external_ft2: round(ext, 1),
          delta_pct: round(variance, 1),
          external_source: this.crossCheckSource.source,
          message:
            `Traced footprint (${round(totalProj, 0)} ft²) differs from ${this.crossCheckSource.source} ` +
            `(${round(ext, 0)} ft²) by ${round(variance, 1)} %. Field-verify before ordering materials.`,
        }
        notes.push(`⚠ NEEDS REVIEW: ${reviewFlag.message}`)
      }
    }

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
        engine_version: 'RoofMeasurementEngine v6.0 (UTM + Shoelace + Common Run + Obstruction Deduction + Corner Analysis)',
        powered_by:     'Reuse Canada / Roof Manager',
      },
      key_measurements: {
        total_roof_area_sloped_ft2:    round(totalSloped, 1),
        total_projected_footprint_ft2: round(totalProj, 1),
        total_squares_net:             round(netSquares, 2),
        total_squares_gross_w_waste:   round(grossSquares, 2),
        waste_factor_pct:              round(wFrac * 100, 1),
        waste_breakdown:               wasteBd,
        labor_estimate:                labor,
        num_roof_faces:                facesData.length,
        num_eave_points:               Math.max(0, this.eavesCart.length - 1),
        num_ridges:                    this.ridgesCart.length,
        num_hips:                      this.hipsCart.length,
        num_valleys:                   this.valleysCart.length,
        num_rakes:                     this.rakesCart.length,
        dominant_pitch_label:          `${round(domPitch, 1)}:12`,
        dominant_pitch_angle_deg:      round(pitchAngleDeg(domPitch), 1),
        obstruction_deduction_ft2:     round(obstructionDeductSlopedFt2, 1),
        num_obstructions:              obstructionDetails.length,
        cutout_deduction_ft2:          round(cutoutDeductSlopedFt2, 1),
        cutout_deduction_projected_ft2: round(cutoutDeductProjFt2, 1),
        num_cutouts:                   cutoutDetails.length,
      },
      linear_measurements: {
        eaves_total_ft:             round(totalEaveFt, 1),
        ridges_total_ft:            round(totalRidgeFt, 1),
        hips_total_ft:              round(totalHipFt, 1),
        valleys_total_ft:           round(totalValleyFt, 1),
        rakes_total_ft:             round(totalRakeFt, 1),
        perimeter_eave_rake_ft:     round(perimeterFt, 1),
        hip_plus_ridge_ft:          round(totalHipFt + totalRidgeFt, 1),
        step_flashing_total_ft:     round(this.stepFlashingFt, 1),
        headwall_flashing_total_ft: round(this.headwallFlashingFt, 1),
        chimney_flashing_count:     this.chimneyCount,
        pipe_boot_count:            this.pipeBootCount,
      },
      // Combined edge breakdown: primary edges (section_index undefined/0) +
      // secondary section edges (section_index 1+) so the per-edge table
      // shows every structure's edges, not just the main house's.
      eave_edge_breakdown: edges.concat(secondaryEaveEdges),
      eave_corner_analysis: cornerAnalysis,
      eave_depth_layers: this.eaveDepths,
      obstruction_details: obstructionDetails,
      cutout_details:      cutoutDetails,
      ridge_details:       ridgeSegs,
      hip_details:         hipSegs,
      valley_details:      valleySegs,
      rake_details:        rakeSegs,
      face_details:        facesData,
      // Per-structure pitch breakdown — emitted only when the roof has extra
      // eaves sections. Index 0 is the primary outline; index 1+ aligns with
      // rawEavesSections. The report template renders this when section
      // pitches differ from the dominant pitch.
      section_pitches:     this.rawEavesSections.length > 0
        ? (() => {
            // Number lower-tier lips and main extras independently so labels
            // read 'Lower Eave 1, 2…' alongside 'Section 2, 3…' without the
            // numbering jumping when both kinds are present.
            let lowerN = 0
            let mainN = 1   // 'Section 2' is the first extra; main roof is 'Section 1'
            return [
              {
                section_index: 0,
                label: 'Main roof',
                kind: 'main' as const,
                pitch_rise: round(domPitch, 1),
                projected_ft2: round(primaryProjFt2, 1),
                sloped_ft2: round(primarySlopedFt2, 1),
                is_user_specified: false,
              },
              ...sectionPitchAreas.map(s => {
                const isLower = s.kind === 'lower_tier'
                const label = isLower
                  ? `Lower Eave ${++lowerN}`
                  : `Section ${++mainN}`
                return {
                  section_index: s.section_index,
                  label,
                  kind: s.kind,
                  pitch_rise: round(s.pitch_rise, 1),
                  projected_ft2: round(s.projected_ft2, 1),
                  sloped_ft2: round(s.sloped_ft2, 1),
                  is_user_specified: s.is_user_specified,
                }
              }),
            ]
          })()
        : undefined,
      // Dormer breakdown — emitted only when dormers were specified.
      // Each entry is the extra sloped area added by a dormer at its own
      // pitch on top of the main roof. footprint stays in totalProj and
      // belongs to the main roof; extra_sloped_ft2 is what got added to
      // totalSloped.
      dormer_breakdown:    dormerBreakdown.length > 0
        ? dormerBreakdown.map(d => ({
            dormer_index: d.dormer_index,
            label: d.label,
            pitch_rise: round(d.pitch_rise, 1),
            footprint_ft2: round(d.footprint_ft2, 1),
            extra_sloped_ft2: round(d.extra_sloped_ft2, 1),
            main_pitch_rise: round(d.main_pitch_rise, 1),
          }))
        : undefined,
      materials_estimate:  mat,
      advisory_notes:      notes,
      cross_check:         crossCheck,
      needs_review:        reviewFlag != null ? true : undefined,
      review_flag:         reviewFlag,
      geometry_warnings:   geometryWarnings.length > 0 ? geometryWarnings : undefined,
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// CONVENIENCE: Convert existing trace UI format to engine payload
// ═══════════════════════════════════════════════════════════════

// A single traced line may be either a bare array of points
// (legacy UI format) OR an object `{pts, pitch?, id?}`.
type UiTraceLine =
  | { lat: number; lng: number }[]
  | { pts: { lat: number; lng: number }[]; pitch?: number | string | null; id?: string }

export function traceUiToEnginePayload(
  traceJson: {
    eaves?: { lat: number; lng: number }[] | { lat: number; lng: number }[][]
    eaves_sections?: { lat: number; lng: number }[][]
    ridges?: UiTraceLine[]
    hips?: UiTraceLine[]
    valleys?: UiTraceLine[]
    walls?: Array<
      | { lat: number; lng: number }[]
      | { pts: { lat: number; lng: number }[]; kind?: 'step' | 'headwall'; id?: string }
    >
    slope_map?: Record<string, string>
    annotations?: {
      vents?: { lat: number; lng: number }[]
      skylights?: { lat: number; lng: number }[]
      chimneys?: { lat: number; lng: number }[]
      pipe_boots?: { lat: number; lng: number }[]
    }
    traced_at?: string
    eaves_tags?: Array<'eave' | 'rake'>
    eaves_sections_tags?: Array<Array<'eave' | 'rake'>>
    // Parallel to `eaves_sections` (or `eaves` when array-of-arrays). Each
    // entry is the user-specified pitch (rise:12) for that section. null/0
    // means "use the default/dominant pitch." Lets dormers and additions
    // ride at a different pitch than the main roof.
    eaves_section_pitches?: Array<number | null | undefined>
    // Parallel to `eaves_sections`. 'lower_tier' marks a visible lower-eave
    // lip beneath an upper-story roof. Other values default to 'main'.
    eaves_section_kinds?: Array<'main' | 'lower_tier' | null | undefined>
    plane_segments_lat_lng?: Array<{
      pitch_rise: number
      centroid: { lat: number; lng: number }
      area_m2?: number
    }>
    // Dormers — features within the main outline. Engine adds only the
    // differential sloped area; renderers MUST NOT split dormers into
    // separate "structures" the way eaves_sections get split.
    dormers?: Array<{
      polygon: { lat: number; lng: number }[]
      pitch_rise: number
      label?: string
    }>
    // Non-roof voids inside the outline (decks between levels, atriums,
    // courtyards). Each polygon area is subtracted from totalProj/totalSloped.
    cutouts?: Array<{
      polygon: { lat: number; lng: number }[]
      label?: string
    }>
    // User-verified per-face polygons + pitches. When present, the engine
    // skips its ridge/hip-based auto-splitter and computes each face's area
    // from the supplied polygon (shoelace × slopeFactor(pitch)). This is the
    // exactness path: every plane's area = user-confirmed polygon × user-
    // confirmed pitch, no inference, no remainder distribution.
    verified_faces?: Array<{
      polygon: { lat: number; lng: number }[]
      pitch_rise: number
      label?: string
      face_id?: string
    }>
  },
  order: {
    property_address?: string
    homeowner_name?: string
    order_number?: string
    latitude?: number
    longitude?: number
    price_per_bundle?: number
  },
  defaultPitch: number = 4.0,
  crossCheck?: { source: string; footprint_ft2: number }
): TracePayload {
  // Resolve multi-section eaves: prefer eaves_sections, fall back to eaves (which may be
  // a flat array [old single-section] or an array of arrays [new multi-section format])
  let allSections: { lat: number; lng: number }[][] = []
  // Per-section pitch keyed by the section reference (NOT by index) so the
  // largest-section reorder and auto-split below don't desync pitches.
  // Sections produced by auto-split are absent from the map → null → engine
  // default — which is fine, since auto-split fires only when the user did
  // not separate structures themselves and so couldn't tag per-section pitch.
  const sectionPitchByRef = new Map<{ lat: number; lng: number }[], number | null>()
  // Parallel kind tracker — keyed by section reference for the same reason as
  // sectionPitchByRef. Auto-split sections (no user kind tag) default to 'main'.
  const sectionKindByRef = new Map<{ lat: number; lng: number }[], 'main' | 'lower_tier'>()
  const validatePitchRise = (p: unknown): number | null => {
    if (typeof p !== 'number' || !isFinite(p) || p <= 0 || p > 30) return null
    return p
  }
  const validateKind = (k: unknown): 'main' | 'lower_tier' =>
    k === 'lower_tier' ? 'lower_tier' : 'main'
  if (traceJson.eaves_sections && traceJson.eaves_sections.length > 0) {
    allSections = traceJson.eaves_sections.filter(s => s.length >= 3)
    const inputPitches = traceJson.eaves_section_pitches || []
    const inputKinds   = traceJson.eaves_section_kinds   || []
    traceJson.eaves_sections.forEach((sec, i) => {
      sectionPitchByRef.set(sec, validatePitchRise(inputPitches[i]))
      sectionKindByRef.set(sec, validateKind(inputKinds[i]))
    })
  } else if (Array.isArray(traceJson.eaves)) {
    if (traceJson.eaves.length > 0 && Array.isArray((traceJson.eaves as any)[0])) {
      // Array of arrays (new format)
      const arr = traceJson.eaves as { lat: number; lng: number }[][]
      allSections = arr.filter(s => s.length >= 3)
      const inputPitches = traceJson.eaves_section_pitches || []
      const inputKinds   = traceJson.eaves_section_kinds   || []
      arr.forEach((sec, i) => {
        sectionPitchByRef.set(sec, validatePitchRise(inputPitches[i]))
        sectionKindByRef.set(sec, validateKind(inputKinds[i]))
      })
    } else {
      // Flat array (old single-section format)
      const flat = traceJson.eaves as { lat: number; lng: number }[]
      if (flat.length >= 3) allSections = [flat]
    }
  }

  // Auto-detect: if the user traced a house + detached garage in one
  // stroke without clicking "add structure", the polygon will contain
  // two long "jump" edges bridging the buildings. Split it back into
  // per-structure sub-polygons so the engine measures each separately.
  if (allSections.length === 1) {
    const split = detectDisjointEaves(allSections[0])
    if (split.length > 1) allSections = split
  }

  // Primary outline = largest section (most eave points)
  const primary = allSections.length > 0
    ? allSections.reduce((best, s) => s.length > best.length ? s : best, allSections[0])
    : []
  const extraSections = allSections.filter(s => s !== primary)
  const extraSectionPitches: Array<number | null> = extraSections.map(
    s => sectionPitchByRef.get(s) ?? null
  )
  const extraSectionKinds: Array<'main' | 'lower_tier'> = extraSections.map(
    s => sectionKindByRef.get(s) ?? 'main'
  )
  // The primary outline may itself carry a user-specified pitch. We expose it
  // as `default_pitch` so the engine treats the main roof at the user's value
  // instead of falling back to the live-detected default.
  const primaryPitchOverride = sectionPitchByRef.get(primary) ?? null

  const eavesOutline: TracePt[] = primary.map(p => ({
    lat: p.lat, lng: p.lng, elevation: null
  }))

  // Normalize a UI trace line (bare array OR {pts,pitch,id}) into an engine TraceLine.
  const normalizeLine = (line: UiTraceLine, prefix: string, i: number): TraceLine => {
    const isObj = !Array.isArray(line) && line && typeof line === 'object' && Array.isArray((line as any).pts)
    const pts = (isObj ? (line as any).pts : (line as { lat: number; lng: number }[]))
    const id = isObj && (line as any).id ? (line as any).id : `${prefix}_${i + 1}`
    const rawPitch = isObj ? (line as any).pitch : null
    let pitch: number | null = null
    if (rawPitch != null) {
      if (typeof rawPitch === 'number' && !isNaN(rawPitch)) pitch = rawPitch
      else {
        const m = String(rawPitch).match(/^(\d+(?:\.\d+)?)\s*[:/]\s*12$/)
        if (m) pitch = parseFloat(m[1])
        else {
          const n = parseFloat(String(rawPitch))
          if (!isNaN(n)) pitch = n
        }
      }
    }
    return {
      id,
      pitch,
      pts: (pts || []).map(p => ({ lat: p.lat, lng: p.lng, elevation: null })),
    }
  }

  const ridges: TraceLine[]  = (traceJson.ridges  || []).map((l, i) => normalizeLine(l, 'ridge',  i))
  const hips: TraceLine[]    = (traceJson.hips    || []).map((l, i) => normalizeLine(l, 'hip',    i))
  const valleys: TraceLine[] = (traceJson.valleys || []).map((l, i) => normalizeLine(l, 'valley', i))

  // Wall junction lines — each carries a `kind` ('step' | 'headwall').
  // Defaults to 'step' when the line is a bare point array (legacy) or
  // when `kind` is missing or unrecognized.
  const walls: Array<TraceLine & { kind?: 'step' | 'headwall' }> =
    (traceJson.walls || []).map((l, i) => {
      const base = normalizeLine(l as any, 'wall', i)
      const isObj = !Array.isArray(l) && l && typeof l === 'object'
      const rawKind = isObj ? (l as any).kind : null
      const kind: 'step' | 'headwall' = rawKind === 'headwall' ? 'headwall' : 'step'
      return { ...base, kind }
    })

  // Aggregate wall flashing length (linear feet) by kind, using haversine.
  // Flashing pieces are flat metal — no slope correction needed.
  const haversineFt = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const R_M = 6_371_000
    const toRad = (d: number) => d * Math.PI / 180
    const dLat = toRad(b.lat - a.lat)
    const dLng = toRad(b.lng - a.lng)
    const lat1 = toRad(a.lat), lat2 = toRad(b.lat)
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
    return 2 * R_M * Math.asin(Math.min(1, Math.sqrt(h))) * 3.28084
  }
  let stepFt = 0, headwallFt = 0
  for (const w of walls) {
    let len = 0
    for (let i = 1; i < w.pts.length; i++) len += haversineFt(w.pts[i - 1], w.pts[i])
    if (w.kind === 'headwall') headwallFt += len
    else stepFt += len
  }

  // Convert point annotations (vents/skylights/chimneys) to obstruction polygons.
  // Each marker becomes a small rectangle centered on the clicked lat/lng.
  const FT_PER_DEG_LAT = 364000  // ~ 1 deg lat ≈ 364,000 ft
  const makeRectPoly = (pt: { lat: number; lng: number }, widthFt: number, lengthFt: number): TracePt[] => {
    const dLat = (lengthFt / 2) / FT_PER_DEG_LAT
    const ftPerDegLng = FT_PER_DEG_LAT * Math.cos(pt.lat * Math.PI / 180)
    const dLng = (widthFt / 2) / Math.max(ftPerDegLng, 1)
    return [
      { lat: pt.lat - dLat, lng: pt.lng - dLng, elevation: null },
      { lat: pt.lat - dLat, lng: pt.lng + dLng, elevation: null },
      { lat: pt.lat + dLat, lng: pt.lng + dLng, elevation: null },
      { lat: pt.lat + dLat, lng: pt.lng - dLng, elevation: null },
    ]
  }
  const obstructions: Obstruction[] = []
  const ann = traceJson.annotations || {}
  for (const pt of ann.chimneys || []) {
    obstructions.push({ type: 'chimney', poly: makeRectPoly(pt, 3, 3), width_ft: 3, length_ft: 3 })
  }
  for (const pt of ann.skylights || []) {
    obstructions.push({ type: 'skylight', poly: makeRectPoly(pt, 2, 4), width_ft: 2, length_ft: 4 })
  }
  for (const pt of ann.vents || []) {
    obstructions.push({ type: 'vent', poly: makeRectPoly(pt, 1, 1), width_ft: 1, length_ft: 1 })
  }
  // Pipe boots are also small penetrations — deduct minimal area but
  // surface the count for BOM (they each need a flashing boot).
  for (const pt of ann.pipe_boots || []) {
    obstructions.push({ type: 'vent', poly: makeRectPoly(pt, 0.75, 0.75), width_ft: 0.75, length_ft: 0.75 })
  }

  return {
    address:        order.property_address || 'Unknown Address',
    homeowner:      order.homeowner_name || 'Unknown',
    order_id:       order.order_number || '',
    // If the primary section has a user-specified pitch, prefer it over the
    // caller's default (which is typically the live Solar-API readout).
    default_pitch:  primaryPitchOverride ?? defaultPitch,
    complexity:     'medium',
    include_waste:  true,
    eaves_outline:  eavesOutline,
    eaves_sections: extraSections.length > 0
      ? extraSections.map(sec => sec.map(p => ({ lat: p.lat, lng: p.lng })))
      : undefined,
    eaves_section_pitches: extraSections.length > 0 && extraSectionPitches.some(p => p != null)
      ? extraSectionPitches
      : undefined,
    eaves_section_kinds: extraSections.length > 0 && extraSectionKinds.some(k => k === 'lower_tier')
      ? extraSectionKinds
      : undefined,
    obstructions:   obstructions.length > 0 ? obstructions : undefined,
    cutouts:        Array.isArray(traceJson.cutouts) && traceJson.cutouts.length > 0
      ? traceJson.cutouts
          .filter(c => c && Array.isArray(c.polygon) && c.polygon.length >= 3)
          .map(c => ({
            poly: c.polygon.map(p => ({ lat: p.lat, lng: p.lng, elevation: null })),
            label: c.label,
          }))
      : undefined,
    ridges,
    hips,
    valleys,
    walls:          walls.length > 0 ? walls : undefined,
    flashing_lengths_ft: { step: stepFt, headwall: headwallFt },
    flashing_counts: {
      chimneys:   (ann.chimneys   || []).length,
      pipe_boots: (ann.pipe_boots || []).length,
    },
    rakes:          [],
    // Verified faces (user-confirmed plane polygons + pitches) take priority
    // over the engine's auto-splitter. Each entry validated: polygon ≥ 3 pts,
    // pitch in (0, 30]. Bad entries dropped silently so a malformed plane
    // can't blow up the run.
    faces:          Array.isArray(traceJson.verified_faces) && traceJson.verified_faces.length > 0
      ? traceJson.verified_faces
          .filter(f =>
            f && Array.isArray(f.polygon) && f.polygon.length >= 3 &&
            typeof f.pitch_rise === 'number' && f.pitch_rise > 0 && f.pitch_rise <= 30
          )
          .map((f, i) => ({
            face_id: f.face_id || `face_${String.fromCharCode(65 + i)}`,
            poly: f.polygon.map(p => ({ lat: p.lat, lng: p.lng, elevation: null })),
            pitch: f.pitch_rise,
            label: f.label,
          }))
      : [],
    slope_map:      traceJson.slope_map && Object.keys(traceJson.slope_map).length > 0
      ? traceJson.slope_map
      : undefined,
    cross_check:    crossCheck,
    plane_segments_lat_lng: traceJson.plane_segments_lat_lng,
    eaves_tags: traceJson.eaves_tags,
    eaves_sections_tags: Array.isArray(traceJson.eaves_sections_tags) && traceJson.eaves_sections_tags.length > 0
      ? traceJson.eaves_sections_tags
      : undefined,
    dormers: Array.isArray(traceJson.dormers) && traceJson.dormers.length > 0
      ? traceJson.dormers
          .filter(d =>
            d && Array.isArray(d.polygon) && d.polygon.length >= 3 &&
            typeof d.pitch_rise === 'number' && d.pitch_rise > 0 && d.pitch_rise <= 30
          )
          .map(d => ({
            polygon: d.polygon.map(p => ({ lat: p.lat, lng: p.lng, elevation: null })),
            pitch_rise: d.pitch_rise,
            label: d.label,
          }))
      : undefined,
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
