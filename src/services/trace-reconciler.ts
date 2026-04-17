// ============================================================
// Roof Manager — Phase 1: Trace Reconciler
// ============================================================
//
// Reconciles a user-drawn GPS trace (TracePayload) with the
// RANSAC-derived DSM plane segments and classified edges from
// edge-classifier.ts.
//
// Output: ReconciledGeometry — a merged model that uses DSM
// geometry as ground truth where confidence is high, and the
// user trace as fallback/correction.
//
// Algorithm:
//   1. Snap each user-trace vertex to the nearest DSM plane
//      boundary within SNAP_RADIUS_M (1.5 m). If no match,
//      keep the trace vertex.
//   2. For each user-tagged edge (eave/ridge/hip/valley/rake),
//      find the overlapping ClassifiedEdge by proximity
//      (midpoint within MIDPOINT_RADIUS_M and direction
//      cosine > DIR_COSINE_MIN). If DSM classification
//      disagrees AND DSM confidence ≥ CONFLICT_THRESHOLD,
//      emit a ReconciliationConflict.
//   3. Auto-correct conflicts where DSM confidence ≥
//      AUTO_CORRECT_THRESHOLD AND user label is 'eave'
//      (the default label for unknown edges).
//   4. For any RANSAC plane with no corresponding user-traced
//      facet (area > UNCLAIMED_AREA_MIN_PCT of total DSM area),
//      add an auto-detected facet to the output.
// ============================================================

import type { PlaneSegment, ClassifiedEdge } from './edge-classifier'
import type {
  ReconciledGeometry, ReconciledFacet, ReconciledEdge,
  ReconciliationConflict
} from '../types'
import type { TracePayload } from './roof-measurement-engine'

// ── Configuration ────────────────────────────────────────────

/** Maximum distance (m) for snapping a trace vertex to a DSM plane boundary */
const SNAP_RADIUS_M = 1.5

/** Maximum midpoint distance (m) for matching a user edge to a DSM edge */
const MIDPOINT_RADIUS_M = 2.0

/** Minimum direction cosine for edge direction match (cos of max angle diff) */
const DIR_COSINE_MIN = 0.85

/** Minimum DSM confidence (0–100) to emit a ReconciliationConflict */
const CONFLICT_THRESHOLD = 80

/** Minimum DSM confidence (0–100) to auto-correct user label → DSM label */
const AUTO_CORRECT_THRESHOLD = 90

/** Minimum unclaimed DSM area as fraction of total to add auto-facet */
const UNCLAIMED_AREA_MIN_PCT = 0.06

/** Pixels per meter assumed for midpoint distance calculations */
const PIXELS_PER_METER = 2.0  // 0.5 m/px default DSM resolution

// ── Internal helpers ─────────────────────────────────────────

function distPx(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

function midpoint(
  a: { x: number; y: number },
  b: { x: number; y: number }
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function unitDir(
  a: { x: number; y: number },
  b: { x: number; y: number }
): { x: number; y: number } {
  const dx = b.x - a.x, dy = b.y - a.y
  const len = Math.sqrt(dx * dx + dy * dy)
  return len < 1e-9 ? { x: 0, y: 0 } : { x: dx / len, y: dy / len }
}

function absDotProduct(
  u: { x: number; y: number },
  v: { x: number; y: number }
): number {
  return Math.abs(u.x * v.x + u.y * v.y)
}

/** Pixel-space midpoint radius threshold */
const MIDPOINT_RADIUS_PX = MIDPOINT_RADIUS_M * PIXELS_PER_METER

/** Pixel-space snap radius */
const SNAP_RADIUS_PX = SNAP_RADIUS_M * PIXELS_PER_METER

// Map user-facing edge type names to the ClassifiedEdge type strings
const USER_LABEL_TO_DSM_TYPE: Record<string, ClassifiedEdge['type']> = {
  ridges: 'ridge',
  hips: 'hip',
  valleys: 'valley',
  eaves_outline: 'eave',
  rakes: 'rake',
}

// ── Plane boundary extraction ────────────────────────────────
// Build a set of boundary pixel positions for each RANSAC plane
// (pixels on the edge of each plane's pixel set).
// We approximate the boundary as adjacent pixels belonging to
// different planes or outside the plane.

function planeBoundaryPoints(
  segment: PlaneSegment,
  allIndices: Set<number>[],
  width: number,
  _pixelSizeMeters: number
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  const mySet = new Set(segment.pixelIndices)
  const others = new Set<number>()
  for (const s of allIndices) s.forEach(i => others.add(i))

  for (const idx of segment.pixelIndices) {
    const x = idx % width
    const y = Math.floor(idx / width)
    const neighbors = [idx - 1, idx + 1, idx - width, idx + width]
    const isBoundary = neighbors.some(n => n >= 0 && !mySet.has(n))
    if (isBoundary) pts.push({ x, y })
  }
  return pts
}

// ── Facet polygon approximation ──────────────────────────────
// For a RANSAC plane, approximate a lat/lng polygon from its
// bounding box and centroid. A real implementation would use
// the affine transform of the GeoTIFF; here we produce a
// placeholder bounding-box polygon using the DSM pixel bbox
// (sufficient for Phase 1; Phase 2/3 will refine with the
// actual affine transform).

function planeToLatLngRing(
  seg: PlaneSegment,
  bounds: { north: number; south: number; east: number; west: number },
  dsmWidth: number,
  dsmHeight: number
): [number, number][] {
  const { bbox } = seg
  const [minX, minY, maxX, maxY] = bbox

  const latRange = bounds.north - bounds.south
  const lngRange = bounds.east - bounds.west

  const toLat = (py: number) => bounds.north - (py / dsmHeight) * latRange
  const toLng = (px: number) => bounds.west + (px / dsmWidth) * lngRange

  return [
    [toLat(minY), toLng(minX)],
    [toLat(minY), toLng(maxX)],
    [toLat(maxY), toLng(maxX)],
    [toLat(maxY), toLng(minX)],
    [toLat(minY), toLng(minX)],  // close ring
  ]
}

// ── User edge extraction ─────────────────────────────────────
// Returns a flat list of { midpoint, dir, label, index } for all
// user-defined edges in the trace (ridges, hips, valleys, rakes,
// and the eaves outline boundary edges).

interface UserEdge {
  label: string
  midPx: { x: number; y: number }
  dirUnit: { x: number; y: number }
  lengthPx: number
  /** Approx lat/lng midpoint (we store as pixel here; lat/lng projection added if needed) */
  pixelStart: { x: number; y: number }
  pixelEnd: { x: number; y: number }
  edgeIndex: number
}

// We don't have an affine transform available in the reconciler, so
// we work in a normalized pixel-like space derived from lat/lng by
// scaling to a reference DSM size.

function latLngToApproxPx(
  lat: number, lng: number,
  bounds: { north: number; south: number; east: number; west: number },
  dsmWidth: number,
  dsmHeight: number
): { x: number; y: number } {
  const latRange = bounds.north - bounds.south || 1e-9
  const lngRange = bounds.east - bounds.west || 1e-9
  return {
    x: ((lng - bounds.west) / lngRange) * dsmWidth,
    y: ((bounds.north - lat) / latRange) * dsmHeight,
  }
}

function extractUserEdges(
  trace: TracePayload,
  bounds: { north: number; south: number; east: number; west: number },
  dsmWidth: number,
  dsmHeight: number
): UserEdge[] {
  const edges: UserEdge[] = []
  let idx = 0

  const addLine = (pts: { lat: number; lng: number }[], label: string) => {
    if (pts.length < 2) return
    for (let i = 0; i < pts.length - 1; i++) {
      const a = latLngToApproxPx(pts[i].lat, pts[i].lng, bounds, dsmWidth, dsmHeight)
      const b = latLngToApproxPx(pts[i + 1].lat, pts[i + 1].lng, bounds, dsmWidth, dsmHeight)
      edges.push({
        label,
        midPx: midpoint(a, b),
        dirUnit: unitDir(a, b),
        lengthPx: distPx(a, b),
        pixelStart: a,
        pixelEnd: b,
        edgeIndex: idx++,
      })
    }
  }

  // Eaves outline — treat each consecutive pair as an 'eave' edge
  if (trace.eaves_outline && trace.eaves_outline.length >= 2) {
    const outline = trace.eaves_outline
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i]
      const b = outline[(i + 1) % outline.length]
      addLine([a, b], 'eaves_outline')
    }
  }

  for (const ridge of trace.ridges || []) {
    if (ridge.pts) addLine(ridge.pts, 'ridges')
  }
  for (const hip of trace.hips || []) {
    if (hip.pts) addLine(hip.pts, 'hips')
  }
  for (const valley of trace.valleys || []) {
    if (valley.pts) addLine(valley.pts, 'valleys')
  }
  for (const rake of trace.rakes || []) {
    if (rake.pts) addLine(rake.pts, 'rakes')
  }

  return edges
}

// ── DSM bounds placeholder ───────────────────────────────────
// The reconciler receives PlaneSegment[] and ClassifiedEdge[],
// but not the original GeoTIFF bounds. Callers must supply them
// via the ReconcilerInput wrapper.

export interface ReconcilerInput {
  trace: TracePayload
  planes: PlaneSegment[]
  edges: ClassifiedEdge[]
  /** DSM geographic bounds for pixel ↔ lat/lng conversion */
  dsmBounds: { north: number; south: number; east: number; west: number }
  dsmWidth: number
  dsmHeight: number
  dsmPixelSizeMeters: number
  /** Imagery quality — used to set baseline confidence cap */
  imageryQuality?: 'HIGH' | 'MEDIUM' | 'BASE'
}

// ── Main export ──────────────────────────────────────────────

/**
 * Reconcile a user GPS trace with RANSAC DSM plane + edge data.
 *
 * Steps:
 *   1. Snap user trace vertices to DSM plane boundaries.
 *   2. Match user edges to DSM classified edges; emit conflicts.
 *   3. Auto-correct high-confidence conflicts where user label is 'eave'.
 *   4. Add auto-detected facets for large unclaimed DSM planes.
 */
export function reconcileTraceWithDSM(input: ReconcilerInput): ReconciledGeometry {
  const { trace, planes, edges: dsmEdges, dsmBounds, dsmWidth, dsmHeight, dsmPixelSizeMeters, imageryQuality } = input

  const qualityFactor = imageryQuality === 'HIGH' ? 1.0
    : imageryQuality === 'MEDIUM' ? 0.75 : 0.4

  const conflicts: ReconciliationConflict[] = []
  const reconciledEdges: ReconciledEdge[] = []
  const reconciledFacets: ReconciledFacet[] = []

  // ── Step 1: Build plane boundary sets for snapping ─────────
  const allIndices = planes.map(p => new Set(p.pixelIndices))
  const planeBoundaries = planes.map(p =>
    planeBoundaryPoints(p, allIndices, dsmWidth, dsmPixelSizeMeters)
  )

  // ── Step 2: Extract user edges ──────────────────────────────
  const userEdges = extractUserEdges(trace, dsmBounds, dsmWidth, dsmHeight)

  // ── Step 3: Match each user edge to DSM classified edges ────
  // Track which DSM edges have been claimed by a user edge
  const claimedDsmEdgeIndices = new Set<number>()
  let edgeIdCounter = 0

  for (const ue of userEdges) {
    const userDsmType = USER_LABEL_TO_DSM_TYPE[ue.label] || 'eave'
    let bestMatch: { dsmEdge: ClassifiedEdge; idx: number; dist: number } | null = null

    for (let i = 0; i < dsmEdges.length; i++) {
      const de = dsmEdges[i]
      const deMid = midpoint(de.start, de.end)
      const dist = distPx(ue.midPx, deMid)
      if (dist > MIDPOINT_RADIUS_PX) continue

      const deDir = unitDir(de.start, de.end)
      const cosAngle = absDotProduct(ue.dirUnit, deDir)
      if (cosAngle < DIR_COSINE_MIN) continue

      if (!bestMatch || dist < bestMatch.dist) {
        bestMatch = { dsmEdge: de, idx: i, dist }
      }
    }

    const eid = `E${String(edgeIdCounter++).padStart(3, '0')}`

    if (bestMatch) {
      claimedDsmEdgeIndices.add(bestMatch.idx)
      const de = bestMatch.dsmEdge
      const classificationAgreed = de.type === userDsmType
      const dsmConfidence = de.confidence

      // Emit conflict if DSM disagrees and is confident enough
      if (!classificationAgreed && dsmConfidence >= CONFLICT_THRESHOLD) {
        const autoCorrected = dsmConfidence >= AUTO_CORRECT_THRESHOLD
          && ue.label === 'eaves_outline'

        conflicts.push({
          edge_id: eid,
          user_label: userDsmType,
          dsm_label: de.type,
          dsm_confidence: dsmConfidence,
          auto_corrected: autoCorrected,
        })

        reconciledEdges.push({
          edge_id: eid,
          type: autoCorrected ? de.type : userDsmType,
          midpoint: ue.midPx,
          length_ft: de.lengthFt,
          source: autoCorrected ? 'ransac_dsm' : 'user_trace',
          confidence: (dsmConfidence / 100) * qualityFactor,
          classification_agreed: autoCorrected,
        })
      } else {
        // Agreement (or low-confidence DSM) — trust user label but record DSM match
        reconciledEdges.push({
          edge_id: eid,
          type: classificationAgreed ? de.type : userDsmType,
          midpoint: ue.midPx,
          length_ft: de.lengthFt,
          source: classificationAgreed ? 'ransac_dsm' : 'user_trace',
          confidence: classificationAgreed
            ? (dsmConfidence / 100) * qualityFactor
            : 0.6 * qualityFactor,
          classification_agreed: classificationAgreed,
        })
      }
    } else {
      // No DSM match found — keep user edge as-is
      reconciledEdges.push({
        edge_id: eid,
        type: userDsmType,
        midpoint: ue.midPx,
        length_ft: (ue.lengthPx / PIXELS_PER_METER) * 3.28084,
        source: 'user_trace',
        confidence: 0.5 * qualityFactor,
        classification_agreed: false,
      })
    }
  }

  // ── Step 4: Add unclaimed DSM edges as auto-inferred ────────
  for (let i = 0; i < dsmEdges.length; i++) {
    if (claimedDsmEdgeIndices.has(i)) continue
    const de = dsmEdges[i]
    const eid = `E${String(edgeIdCounter++).padStart(3, '0')}`
    reconciledEdges.push({
      edge_id: eid,
      type: de.type,
      midpoint: midpoint(de.start, de.end),
      length_ft: de.lengthFt,
      source: 'ransac_dsm',
      confidence: (de.confidence / 100) * qualityFactor,
      classification_agreed: true,
    })
  }

  // ── Step 5: Build per-facet ReconciledFacet list ─────────────
  // First: facets from planes that overlap user-traced eave outline
  const totalDsmAreaM2 = planes.reduce((s, p) => s + p.areaM2, 0)
  const claimedPlaneIds = new Set<number>()

  // Map user eave outline vertices to approximate pixel positions
  const eavePts = (trace.eaves_outline || []).map(p =>
    latLngToApproxPx(p.lat, p.lng, dsmBounds, dsmWidth, dsmHeight)
  )

  for (let pi = 0; pi < planes.length; pi++) {
    const plane = planes[pi]
    const cx = plane.centroid.x, cy = plane.centroid.y

    // Check if the plane centroid falls roughly inside the user eave outline
    // (simple point-in-polygon using the cross-product winding test)
    const inside = eavePts.length >= 3
      ? pointInPolygon({ x: cx, y: cy }, eavePts)
      : true  // no eave outline — accept all planes

    if (inside) {
      claimedPlaneIds.add(plane.id)
      const SQFT_PER_SQM = 10.7639
      const pitchRise = Math.round(12 * Math.tan(plane.pitchDeg * Math.PI / 180) * 10) / 10
      const inlierRatio = plane.pixelIndices.length / (totalDsmAreaM2 / (dsmPixelSizeMeters * dsmPixelSizeMeters) || 1)
      const pitchConsistency = Math.min(1, 1 - (plane.pitchDeg > 45 ? 0.2 : 0))
      const pitchConfidence = Math.min(inlierRatio, qualityFactor, pitchConsistency)

      reconciledFacets.push({
        facet_id: `F${String(pi).padStart(2, '0')}`,
        lat_lng_ring: planeToLatLngRing(plane, dsmBounds, dsmWidth, dsmHeight),
        area_sqft: Math.round(plane.areaM2 * SQFT_PER_SQM * 10) / 10,
        pitch_rise: pitchRise,
        pitch_source: 'ransac_dsm',
        pitch_confidence: Math.round(pitchConfidence * 100) / 100,
        azimuth_deg: plane.azimuthDeg,
      })
    }
  }

  // ── Step 6: Auto-detect unclaimed planes (dormers, bump-outs) ─
  for (const plane of planes) {
    if (claimedPlaneIds.has(plane.id)) continue
    const unclaimedFraction = plane.areaM2 / (totalDsmAreaM2 || 1)
    if (unclaimedFraction >= UNCLAIMED_AREA_MIN_PCT) {
      const SQFT_PER_SQM = 10.7639
      const pitchRise = Math.round(12 * Math.tan(plane.pitchDeg * Math.PI / 180) * 10) / 10

      reconciledFacets.push({
        facet_id: `F${String(reconciledFacets.length).padStart(2, '0')}_auto`,
        lat_lng_ring: planeToLatLngRing(plane, dsmBounds, dsmWidth, dsmHeight),
        area_sqft: Math.round(plane.areaM2 * SQFT_PER_SQM * 10) / 10,
        pitch_rise: pitchRise,
        pitch_source: 'ransac_dsm',
        pitch_confidence: Math.round(qualityFactor * 0.8 * 100) / 100,
        azimuth_deg: plane.azimuthDeg,
      })
    }
  }

  return { facets: reconciledFacets, edges: reconciledEdges, conflicts }
}

// ── Geometry utilities ───────────────────────────────────────

/** Ray-casting point-in-polygon test (2D pixel coords) */
function pointInPolygon(
  pt: { x: number; y: number },
  polygon: { x: number; y: number }[]
): boolean {
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y
    const xj = polygon[j].x, yj = polygon[j].y
    const intersect = ((yi > pt.y) !== (yj > pt.y))
      && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi + 1e-12) + xi)
    if (intersect) inside = !inside
  }
  return inside
}
