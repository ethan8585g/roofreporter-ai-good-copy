// ============================================================
// RoofReporterAI — Roof Measurement Engine v3.0
//
// Core Philosophy:
//   - ALL primary measurements from user-drawn GPS trace coordinates
//   - WGS84 → local Cartesian (UTM-like) for meter-level accuracy
//   - Shoelace formula for 2D footprint area
//   - Pitch multiplier (from user input or Solar API DSM) for true 3D area
//   - 3D edge lengths with proper line categorisation
//   - Vertex snapping ensures closed, watertight polygon geometry
//   - Google Solar API used ONLY for satellite imagery + optional DSM cross-check
//
// INPUT:  Trace JSON { eaves: [{lat,lng}], ridges: [[{lat,lng}]], ... }
// OUTPUT: Full measurement report — areas, lengths, squares, materials
// ============================================================

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const EARTH_RADIUS_M    = 6_371_000        // metres
const M_TO_FT           = 3.28084          // metres -> feet
const M2_TO_FT2         = 10.7639          // m² -> ft²
const SQFT_PER_SQUARE   = 100              // 1 roofing square = 100 sq ft
const BUNDLES_PER_SQ    = 3                // standard architectural shingles
const SQ_PER_UNDERLAY   = 4                // 1 roll underlayment ~ 4 squares
const LF_PER_RIDGE_BUNDLE = 35             // ridge-cap linear feet per bundle
const ICE_SHIELD_WIDTH_FT = 3.0            // ice & water shield width up from eave
const NAIL_LBS_PER_SQ   = 2.5             // nails per square
const SNAP_THRESHOLD_M   = 0.3             // vertex snapping: 30 cm tolerance

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface TracePt {
  lat: number
  lng: number
  elevation?: number | null
}

/** Cartesian point in local metric coords (metres from origin) */
interface CartesianPt {
  x: number  // metres east of origin
  y: number  // metres north of origin
  z: number  // elevation in metres (0 if unknown)
  lat: number
  lng: number
}

export interface TraceLine {
  id?: string
  pitch?: number | null   // rise:12 override
  pts: TracePt[]
}

export interface TraceFace {
  face_id: string
  poly: TracePt[]
  pitch: number           // rise:12
  label?: string
}

/** Input payload from the RoofReporterAI tracing UI */
export interface TracePayload {
  address?: string
  homeowner?: string
  order_id?: string
  default_pitch?: number       // rise:12 (e.g. 5.0)
  complexity?: 'simple' | 'medium' | 'complex'
  include_waste?: boolean

  eaves_outline: TracePt[]     // ordered polygon points
  ridges?: TraceLine[]
  hips?: TraceLine[]
  valleys?: TraceLine[]
  rakes?: TraceLine[]
  faces?: TraceFace[]
}

export interface EaveEdge {
  edge_num: number
  from_pt: number
  to_pt: number
  length_2d_ft: number    // horizontal run on ground
  length_3d_ft: number    // true length (= 2D for eaves, horizontal lines)
  bearing_deg: number
}

export interface LineDetail {
  id: string
  type: string
  category: 'horizontal' | 'sloped'  // eave/ridge = horizontal; hip/valley/rake = sloped
  horiz_length_ft: number             // 2D projected length
  sloped_length_ft: number            // 3D true length
  num_pts: number
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
  }
  linear_measurements: {
    eaves_total_ft: number
    ridges_total_ft: number
    hips_total_ft: number
    valleys_total_ft: number
    rakes_total_ft: number
    perimeter_eave_rake_ft: number
    hip_plus_ridge_ft: number
  }
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
// COORDINATE PROJECTION: WGS84 → Local Cartesian (metres)
//
// We use a simplified UTM-like equirectangular projection centred
// on the polygon centroid.  For roof-scale areas (< 500 m span)
// the error vs. full UTM is < 0.01 %.
// ═══════════════════════════════════════════════════════════════

const DEG_TO_RAD = Math.PI / 180

/**
 * Project an array of WGS84 points into a local Cartesian frame.
 * Origin = centroid of the input points.
 * Returns { x, y, z } in metres with original lat/lng preserved.
 */
function projectToCartesian(pts: TracePt[]): { origin: { lat: number; lng: number }; projected: CartesianPt[] } {
  if (pts.length === 0) return { origin: { lat: 0, lng: 0 }, projected: [] }

  // Compute centroid as projection origin
  const sumLat = pts.reduce((s, p) => s + p.lat, 0)
  const sumLng = pts.reduce((s, p) => s + p.lng, 0)
  const originLat = sumLat / pts.length
  const originLng = sumLng / pts.length

  // Metres per degree at this latitude
  const cosLat = Math.cos(originLat * DEG_TO_RAD)
  const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M      // ~111,320 m
  const mPerDegLng = (Math.PI / 180) * EARTH_RADIUS_M * cosLat

  const projected: CartesianPt[] = pts.map(p => ({
    x: (p.lng - originLng) * mPerDegLng,
    y: (p.lat - originLat) * mPerDegLat,
    z: (p.elevation != null ? p.elevation : 0),
    lat: p.lat,
    lng: p.lng,
  }))

  return { origin: { lat: originLat, lng: originLng }, projected }
}

/**
 * Project a single WGS84 point using a pre-computed origin.
 */
function projectPoint(p: TracePt, originLat: number, originLng: number): CartesianPt {
  const cosLat = Math.cos(originLat * DEG_TO_RAD)
  const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M
  const mPerDegLng = (Math.PI / 180) * EARTH_RADIUS_M * cosLat
  return {
    x: (p.lng - originLng) * mPerDegLng,
    y: (p.lat - originLat) * mPerDegLat,
    z: (p.elevation != null ? p.elevation : 0),
    lat: p.lat,
    lng: p.lng,
  }
}

// ═══════════════════════════════════════════════════════════════
// VERTEX SNAPPING
//
// Ensures adjacent lines share exact coordinates.  Any endpoint
// within SNAP_THRESHOLD_M of another is merged to the same (x,y).
// This guarantees a fully closed polygon for the Shoelace formula.
// ═══════════════════════════════════════════════════════════════

interface SnapVertex { x: number; y: number; z: number; id: string }

class VertexSnapper {
  private vertices: SnapVertex[] = []

  /** Register a vertex; returns the snapped (x,y,z). */
  snap(x: number, y: number, z: number, id: string): SnapVertex {
    for (const v of this.vertices) {
      const dist = Math.sqrt((x - v.x) ** 2 + (y - v.y) ** 2)
      if (dist < SNAP_THRESHOLD_M) {
        // Average Z when merging (better elevation estimate)
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
//
// Standard surveyor's formula on projected (x, y) coordinates.
// Input must be an ordered polygon ring (first ≠ last — we close it).
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

/** 2D distance (plan/horizontal) in metres */
function dist2D(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
}

/** 3D distance (true length incl. elevation) in metres */
function dist3D(a: CartesianPt, b: CartesianPt): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2 + (b.z - a.z) ** 2)
}

/** Polyline 2D length in metres */
function polyline2DLengthM(pts: { x: number; y: number }[]): number {
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) total += dist2D(pts[i], pts[i + 1])
  return total
}

/** Polyline 3D length in metres */
function polyline3DLengthM(pts: CartesianPt[]): number {
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) total += dist3D(pts[i], pts[i + 1])
  return total
}

// ═══════════════════════════════════════════════════════════════
// PITCH / SLOPE MATHS
// ═══════════════════════════════════════════════════════════════

/** slope_factor = sqrt(rise² + 12²) / 12. Converts projected → sloped. */
function slopeFactor(rise: number): number {
  return Math.sqrt(rise * rise + 144) / 12
}

/** Hip/valley rafter slope factor (diagonal at 45° plan angle). */
function hipSlopeFactor(rise: number): number {
  return Math.sqrt(rise * rise + 288) / Math.sqrt(288)
}

/** Rise:12 → angle in degrees. */
function pitchAngleDeg(rise: number): number {
  return Math.atan(rise / 12) * 180 / Math.PI
}

/** Projected area → actual sloped surface area (any unit²). */
function slopedFromProjected(proj: number, rise: number): number {
  return proj * slopeFactor(rise)
}

// ═══════════════════════════════════════════════════════════════
// WASTE & MATERIAL HELPERS
// ═══════════════════════════════════════════════════════════════

function wastePct(rise: number, complexity: string = 'medium'): number {
  const bases: Record<string, number> = { simple: 0.10, medium: 0.15, complex: 0.20 }
  let base = bases[complexity] ?? 0.15
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
    valley_flashing_lf:         round(valleyFt * 1.10, 1),  // +10% overlap
    roofing_nails_lbs:          Math.ceil(gross * NAIL_LBS_PER_SQ),
    caulk_tubes:                Math.max(1, Math.ceil(gross / 5)),
  }
}

function round(v: number, decimals: number): number {
  const f = Math.pow(10, decimals)
  return Math.round(v * f) / f
}

// ═══════════════════════════════════════════════════════════════
// LINE CATEGORISATION
//
// Eaves & ridges are horizontal (z₁ ≈ z₂) → 2D length = true length.
// Hips, valleys, rakes are sloped → use 3D distance or pitch multiplier.
// If no elevation data, apply pitch factor from default_pitch.
// ═══════════════════════════════════════════════════════════════

type LineCategory = 'horizontal' | 'sloped'

function categoriseLine(type: string): LineCategory {
  switch (type) {
    case 'eave':
    case 'ridge':
      return 'horizontal'
    case 'hip':
    case 'valley':
    case 'rake':
    default:
      return 'sloped'
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN ENGINE CLASS
// ═══════════════════════════════════════════════════════════════

export class RoofMeasurementEngine {
  private address: string
  private homeowner: string
  private orderId: string
  private defPitch: number       // rise:12
  private complexity: string
  private incWaste: boolean
  private timestamp: string

  // Raw WGS84 inputs
  private rawEaves: TracePt[]
  private rawRidges: TraceLine[]
  private rawHips: TraceLine[]
  private rawValleys: TraceLine[]
  private rawRakes: TraceLine[]
  private rawFaces: TraceFace[]

  // Projected Cartesian geometry (populated in constructor)
  private origin: { lat: number; lng: number }
  private snapper: VertexSnapper
  private eavesCart: CartesianPt[]   // closed polygon
  private ridgesCart: { id: string; pts: CartesianPt[]; pitch: number | null }[]
  private hipsCart: { id: string; pts: CartesianPt[]; pitch: number | null }[]
  private valleysCart: { id: string; pts: CartesianPt[]; pitch: number | null }[]
  private rakesCart: { id: string; pts: CartesianPt[]; pitch: number | null }[]
  private facesCart: { face_id: string; poly: CartesianPt[]; pitch: number; label: string }[]

  constructor(payload: TracePayload) {
    this.address    = payload.address || 'Unknown Address'
    this.homeowner  = payload.homeowner || 'Unknown'
    this.orderId    = payload.order_id || ''
    this.defPitch   = payload.default_pitch ?? 5.0
    this.complexity = payload.complexity || 'medium'
    this.incWaste   = payload.include_waste !== false
    this.timestamp  = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'

    // Parse raw WGS84 inputs
    this.rawEaves   = (payload.eaves_outline || []).map(p => ({ lat: p.lat, lng: p.lng, elevation: p.elevation ?? null }))
    this.rawRidges  = this.parseLines(payload.ridges || [])
    this.rawHips    = this.parseLines(payload.hips || [])
    this.rawValleys = this.parseLines(payload.valleys || [])
    this.rawRakes   = this.parseLines(payload.rakes || [])
    this.rawFaces   = this.parseFaces(payload.faces || [])

    // ── STEP 1: Project all points to local Cartesian ──
    const { origin, projected } = projectToCartesian(this.rawEaves)
    this.origin = origin

    // ── STEP 2: Vertex snapping ──
    this.snapper = new VertexSnapper()

    // Snap eaves polygon vertices
    this.eavesCart = projected.map((p, i) => {
      const snapped = this.snapper.snap(p.x, p.y, p.z, `eave_${i}`)
      return { ...p, x: snapped.x, y: snapped.y, z: snapped.z }
    })

    // Auto-close eaves polygon (ensure first = last for Shoelace)
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

    // Snap & project face polygons
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
      pitch: seg.pitch != null ? Number(seg.pitch) : null,
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
      pitch: Number(f.pitch ?? this.defPitch),
      label: f.label || 'face'
    }))
  }

  private projectLines(lines: TraceLine[], prefix: string): { id: string; pts: CartesianPt[]; pitch: number | null }[] {
    return lines.map((seg, i) => ({
      id: seg.id || `${prefix}_${i + 1}`,
      pitch: seg.pitch != null ? Number(seg.pitch) : null,
      pts: seg.pts.map((p, j) => {
        const cp = projectPoint(p, this.origin.lat, this.origin.lng)
        const snapped = this.snapper.snap(cp.x, cp.y, cp.z, `${prefix}_${i}_${j}`)
        return { ...cp, x: snapped.x, y: snapped.y, z: snapped.z }
      })
    }))
  }

  // ── 2D FOOTPRINT AREA (Shoelace) ──────────────────────────

  /**
   * Compute the 2D projected footprint area of the eaves polygon
   * using the Shoelace formula on Cartesian (x,y) coordinates.
   * Returns area in sq ft.
   */
  computeFootprintSqft(): number {
    // Use all points except the closing duplicate
    const pts = this.eavesCart.length > 3
      ? this.eavesCart.slice(0, -1)  // remove closing point for Shoelace
      : this.eavesCart
    const areaM2 = shoelaceAreaM2(pts)
    return areaM2 * M2_TO_FT2
  }

  // ── EAVE EDGE BREAKDOWN ──────────────────────────────────

  eaveEdges(): EaveEdge[] {
    const edges: EaveEdge[] = []
    const pts = this.eavesCart
    if (pts.length < 2) return edges

    // Walk edges of the polygon (last pt closes to first)
    const n = pts.length - 1  // last = first in closed polygon
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[i + 1]
      const len2D = dist2D(a, b) * M_TO_FT
      // Eaves are horizontal lines → 2D = 3D (z₁ ≈ z₂ at eave level)
      const len3D = len2D  // by definition for eaves
      const bearing = ((Math.atan2(b.x - a.x, b.y - a.y) * 180 / Math.PI) % 360 + 360) % 360
      edges.push({
        edge_num:    i + 1,
        from_pt:     i + 1,
        to_pt:       (i % n) + 2,
        length_2d_ft: round(len2D, 2),
        length_3d_ft: round(len3D, 2),
        bearing_deg: round(bearing, 1),
      })
    }
    return edges
  }

  // ── LINE DETAIL COMPUTATION ──────────────────────────────

  /**
   * Compute detailed measurements for a set of line segments.
   *
   * Line categorisation:
   *   - Eaves / Ridges → HORIZONTAL: z₁ = z₂, so 2D length = true length
   *   - Hips / Valleys / Rakes → SLOPED: use 3D distance or pitch multiplier
   *
   * For sloped lines without elevation data, we apply the pitch factor:
   *   - Hips/Valleys: hipSlopeFactor(rise)  (diagonal at 45° plan angle)
   *   - Rakes: slopeFactor(rise)            (straight up the slope)
   */
  lineDetails(
    segs: { id: string; pts: CartesianPt[]; pitch: number | null }[],
    kind: string,
    isHipValley: boolean = false
  ): LineDetail[] {
    const cat = categoriseLine(kind)

    return segs.map((seg, i) => {
      const horiz = polyline2DLengthM(seg.pts) * M_TO_FT

      let sloped: number
      if (cat === 'horizontal') {
        // Eaves & ridges: z₁ = z₂ → true length = horizontal length
        sloped = horiz
      } else {
        // Check if we have real elevation data on endpoints
        const hasZ = seg.pts.length >= 2 &&
          seg.pts[0].z !== 0 && seg.pts[seg.pts.length - 1].z !== 0
        if (hasZ) {
          // Use actual 3D distance from DSM elevations
          sloped = polyline3DLengthM(seg.pts) * M_TO_FT
        } else {
          // Apply pitch factor from user-specified or default pitch
          const rise = seg.pitch ?? this.defPitch
          const sf = isHipValley ? hipSlopeFactor(rise) : slopeFactor(rise)
          sloped = horiz * sf
        }
      }

      return {
        id:               seg.id || `${kind}_${i + 1}`,
        type:             kind,
        category:         cat,
        horiz_length_ft:  round(horiz, 2),
        sloped_length_ft: round(sloped, 2),
        num_pts:          seg.pts.length,
      }
    })
  }

  // ── FACE AREA CALCULATION ────────────────────────────────

  faceAreas(): FaceDetail[] {
    const results: FaceDetail[] = []

    if (this.facesCart.length > 0) {
      // STRATEGY A: explicit face polygons from user trace
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
      // Use eaves polygon footprint
      const totalProjFt2 = this.computeFootprintSqft()

      if (this.ridgesCart.length > 0) {
        // STRATEGY B: divide footprint by number of faces (ridges + 1)
        const numFaces = this.ridgesCart.length + 1
        const faceProj = totalProjFt2 / numFaces
        for (let i = 0; i < numFaces; i++) {
          const ridge = i < this.ridgesCart.length ? this.ridgesCart[i] : null
          const rise = ridge?.pitch ?? this.defPitch
          const sloped = slopedFromProjected(faceProj, rise)
          results.push({
            face_id:            ridge?.id || `face_${i + 1}`,
            pitch_rise:         rise,
            pitch_label:        `${rise}:12`,
            pitch_angle_deg:    round(pitchAngleDeg(rise), 1),
            slope_factor:       round(slopeFactor(rise), 4),
            projected_area_ft2: round(faceProj, 1),
            sloped_area_ft2:    round(sloped, 1),
            squares:            round(sloped / SQFT_PER_SQUARE, 3),
          })
        }
      } else {
        // STRATEGY C: single face fallback
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

  // ═══════════════════════════════════════════════════════════════
  // FULL CALCULATION RUN
  // ═══════════════════════════════════════════════════════════════

  run(): TraceReport {
    // 1. Eave edge breakdown
    const edges = this.eaveEdges()
    const totalEaveFt = edges.reduce((s, e) => s + e.length_2d_ft, 0)

    // 2. Linear measurements with proper 3D / category handling
    const ridgeSegs  = this.lineDetails(this.ridgesCart, 'ridge', false)
    const hipSegs    = this.lineDetails(this.hipsCart, 'hip', true)
    const valleySegs = this.lineDetails(this.valleysCart, 'valley', true)
    const rakeSegs   = this.lineDetails(this.rakesCart, 'rake', false)

    // Use sloped_length for hips/valleys/rakes; horiz for ridges (they're horizontal)
    const totalRidgeFt  = ridgeSegs.reduce((s, seg) => s + seg.sloped_length_ft, 0)
    const totalHipFt    = hipSegs.reduce((s, seg) => s + seg.sloped_length_ft, 0)
    const totalValleyFt = valleySegs.reduce((s, seg) => s + seg.sloped_length_ft, 0)
    const totalRakeFt   = rakeSegs.reduce((s, seg) => s + seg.sloped_length_ft, 0)

    // 3. Face areas (with pitch multiplier)
    const facesData   = this.faceAreas()
    const totalSloped = facesData.reduce((s, f) => s + f.sloped_area_ft2, 0)
    const totalProj   = facesData.reduce((s, f) => s + f.projected_area_ft2, 0)
    const netSquares  = totalSloped / SQFT_PER_SQUARE

    // 4. Dominant pitch (most frequent among faces)
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

    // 5. Waste & gross squares
    const wFrac = this.incWaste ? wastePct(domPitch, this.complexity) : 0
    const grossSquares = netSquares * (1 + wFrac)

    // 6. Materials take-off
    const mat = materialsEstimate(
      netSquares, wFrac,
      totalEaveFt, totalRidgeFt, totalHipFt, totalValleyFt, totalRakeFt
    )

    // 7. Perimeter
    const perimeterFt = totalEaveFt + totalRakeFt

    // 8. Advisory notes
    const notes: string[] = []
    if (domPitch >= 9)
      notes.push('STEEP PITCH >= 9:12 — Steep-slope labour & safety gear required.')
    if (domPitch < 4)
      notes.push('LOW SLOPE < 4:12 — Verify manufacturer min-pitch. Extra underlayment layers recommended.')
    if (totalValleyFt > 0)
      notes.push(`Valleys present (${round(totalValleyFt, 1)} ft) — Recommend closed-cut or self-adhered valley install.`)
    if (totalHipFt > 0)
      notes.push(`Hip roof confirmed (${round(totalHipFt, 1)} ft total hip length).`)
    if (this.eavesCart.length > 10)
      notes.push('Complex perimeter (>10 eave points) — Allow extra cut waste.')

    // 9. Assemble report
    return {
      report_meta: {
        address:        this.address,
        homeowner:      this.homeowner,
        order_id:       this.orderId,
        generated:      this.timestamp,
        engine_version: 'RoofMeasurementEngine v3.0 (UTM + Shoelace)',
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
        dominant_pitch_label:          `${domPitch}:12`,
        dominant_pitch_angle_deg:      round(pitchAngleDeg(domPitch), 1),
      },
      linear_measurements: {
        eaves_total_ft:         round(totalEaveFt, 1),
        ridges_total_ft:        round(totalRidgeFt, 1),
        hips_total_ft:          round(totalHipFt, 1),
        valleys_total_ft:       round(totalValleyFt, 1),
        rakes_total_ft:         round(totalRakeFt, 1),
        perimeter_eave_rake_ft: round(perimeterFt, 1),
        hip_plus_ridge_ft:      round(totalHipFt + totalRidgeFt, 1),
      },
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
// The customer-order.js tracing UI stores data as:
//   { eaves: [{lat,lng},...], ridges: [[{lat,lng},{lat,lng}],...], ... }
// This converts it into the engine's TracePayload format.
// ═══════════════════════════════════════════════════════════════

export function traceUiToEnginePayload(
  traceJson: {
    eaves?: { lat: number; lng: number }[]
    ridges?: { lat: number; lng: number }[][]
    hips?: { lat: number; lng: number }[][]
    valleys?: { lat: number; lng: number }[][]
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
  // Convert eaves array of {lat,lng} to TracePt[]
  const eavesOutline: TracePt[] = (traceJson.eaves || []).map(p => ({
    lat: p.lat, lng: p.lng, elevation: null
  }))

  // Convert ridges array of arrays to TraceLine[]
  const ridges: TraceLine[] = (traceJson.ridges || []).map((line, i) => ({
    id: `ridge_${i + 1}`,
    pitch: null,
    pts: line.map(p => ({ lat: p.lat, lng: p.lng, elevation: null }))
  }))

  // Convert hips
  const hips: TraceLine[] = (traceJson.hips || []).map((line, i) => ({
    id: `hip_${i + 1}`,
    pitch: null,
    pts: line.map(p => ({ lat: p.lat, lng: p.lng, elevation: null }))
  }))

  // Convert valleys
  const valleys: TraceLine[] = (traceJson.valleys || []).map((line, i) => ({
    id: `valley_${i + 1}`,
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
    rakes:          [],   // rakes not traced in current UI
    faces:          [],   // faces not traced in current UI
  }
}

// ═══════════════════════════════════════════════════════════════
// STANDALONE FUNCTIONS — for use outside the engine class
// ═══════════════════════════════════════════════════════════════

/**
 * Compute the footprint area (sq ft) of a lat/lng polygon
 * using UTM-like projection + Shoelace formula.
 * Standalone function — no class instantiation needed.
 */
export function computeFootprintFromLatLng(points: { lat: number; lng: number }[]): number {
  if (points.length < 3) return 0
  const pts: TracePt[] = points.map(p => ({ lat: p.lat, lng: p.lng }))
  const { projected } = projectToCartesian(pts)
  const areaM2 = shoelaceAreaM2(projected)
  return areaM2 * M2_TO_FT2
}

/**
 * Compute 2D edge length (ft) between two lat/lng points
 * using Cartesian projection.
 */
export function computeEdgeLengthFt(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const pts: TracePt[] = [{ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }]
  const { projected } = projectToCartesian(pts)
  return dist2D(projected[0], projected[1]) * M_TO_FT
}
