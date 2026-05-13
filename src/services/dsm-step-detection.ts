// ============================================================
// DSM Step Detection — find vertical wall steps along eave edges
// ============================================================
// After the super-admin closes an eave outline, this service samples the
// Google Solar DSM raster at points perpendicular to each edge. Wherever
// there's a sharp height drop within ~perp_distance_m of the edge, we
// flag a "step here?" candidate the trace UI surfaces as a clickable
// marker — typically marking the lower garage roof beneath an upper-floor
// siding wall on a 2-story house.
//
// We don't reuse dsm-visualization.ts (which renders a hillshade PNG) —
// that path drops the raw heights once rendered. Step detection needs
// the raw Float32 height field, so we re-fetch + parse the same GeoTIFF.
// ============================================================

import * as geotiff from 'geotiff'
import type { Bindings } from '../types'

const SOLAR_DATALAYERS_URL = 'https://solar.googleapis.com/v1/dataLayers:get'

export interface DsmStep {
  /** Index of the edge in the input polyline (0 = first edge from pts[0]→pts[1]). */
  edge_index: number
  /** Sample point along the edge — midpoint of the detected step zone. */
  mid_lat: number
  mid_lng: number
  /** Vertical height differential (m) between the two sides of the edge. */
  drop_m: number
  /** Compass bearing (deg, 0=N) pointing toward the LOWER side, so the UI
   *  knows which way to extrude when spawning a lower-tier section. */
  perp_bearing_deg: number
}

export interface DsmStepDetectionResult {
  /** True iff the Solar DSM was successfully fetched + sampled. False for
   *  rural lots and any Solar API failure (callers fall back silently). */
  available: boolean
  steps: DsmStep[]
  /** Reported back so the client can show "DSM coverage from 2024-05-XX". */
  imagery_date?: string
}

export interface DsmStepDetectionOpts {
  /** Min height drop (m) to count as a step. Default 1.5m — half a storey,
   *  enough to indicate a real wall step even on a 1.5-story design. */
  threshold_m?: number
  /** How far perpendicular to the edge to sample on each side (m).
   *  Default 2m — past the eave overhang but inside the lower roof. */
  perp_distance_m?: number
  /** How far along each edge to step between samples (m). Default 0.5m
   *  matches Solar's HIGH-quality DSM resolution. */
  along_step_m?: number
  /** Minimum length of an edge to bother sampling (m). Tiny edges
   *  (snap-to-corner artifacts) produce noise. Default 2m. */
  min_edge_m?: number
}

interface LatLng { lat: number; lng: number }

/**
 * Detect height-step candidates along the perimeter polyline.
 *
 * @param env Worker bindings (for GOOGLE_SOLAR_API_KEY)
 * @param lat Order centroid latitude (used to fetch DSM tile)
 * @param lng Order centroid longitude
 * @param polyline Closed outline (last vertex implicitly connects to first)
 * @param radiusMeters Half-side of the DSM raster (Solar param). Default
 *   60m — same as the existing /dsm-overlay endpoint.
 */
export async function detectStepsAlongPolyline(
  env: Bindings,
  lat: number,
  lng: number,
  polyline: LatLng[],
  opts: DsmStepDetectionOpts = {},
  radiusMeters: number = 60,
): Promise<DsmStepDetectionResult> {
  if (!env.GOOGLE_SOLAR_API_KEY || polyline.length < 3) {
    return { available: false, steps: [] }
  }
  const threshold = opts.threshold_m ?? 1.5
  const perpDist = opts.perp_distance_m ?? 2.0
  const alongStep = opts.along_step_m ?? 0.5
  const minEdge = opts.min_edge_m ?? 2.0

  try {
    // 1. Discover DSM URL — try HIGH first (0.5m pixels), fall back to MEDIUM.
    //    Two requiredQuality tiers because Canadian + rural addresses
    //    often only have MEDIUM coverage.
    let meta: any = null
    for (const quality of ['HIGH', 'MEDIUM'] as const) {
      const params = new URLSearchParams({
        'location.latitude': lat.toFixed(6),
        'location.longitude': lng.toFixed(6),
        radiusMeters: String(radiusMeters),
        view: 'DSM_LAYER',
        requiredQuality: quality,
        pixelSizeMeters: quality === 'HIGH' ? '0.5' : '1.0',
        key: env.GOOGLE_SOLAR_API_KEY,
      })
      const resp = await fetch(`${SOLAR_DATALAYERS_URL}?${params}`)
      if (resp.ok) {
        meta = await resp.json()
        if (meta?.dsmUrl) break
      }
    }
    if (!meta?.dsmUrl) return { available: false, steps: [] }

    // 2. Download + parse GeoTIFF.
    const dsmResp = await fetch(`${meta.dsmUrl}&key=${env.GOOGLE_SOLAR_API_KEY}`)
    if (!dsmResp.ok) return { available: false, steps: [] }
    const buf = await dsmResp.arrayBuffer()
    const tiff = await geotiff.fromArrayBuffer(buf)
    const image = await tiff.getImage()
    const rasters = await image.readRasters()
    const heightField = rasters[0] as any
    const w = image.getWidth()
    const h = image.getHeight()
    if (!heightField || heightField.length === 0) {
      return { available: false, steps: [] }
    }

    // 3. Compute geographic bounds. The Solar dataLayers raster is centered
    //    on the requested (lat, lng) with half-side ~= radiusMeters. The
    //    exact tile may be a couple pixels larger so we read the bbox
    //    from the GeoTIFF when available; fall back to the radius-derived
    //    bounds if the file metadata is missing the geo transform.
    let north: number, south: number, east: number, west: number
    try {
      const bbox = image.getBoundingBox()  // [minX, minY, maxX, maxY] in geo coords
      west = bbox[0]; south = bbox[1]; east = bbox[2]; north = bbox[3]
    } catch {
      const dLat = radiusMeters / 111320
      const dLng = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180))
      north = lat + dLat
      south = lat - dLat
      east = lng + dLng
      west = lng - dLng
    }

    // Sampler: bilinear-ish lookup. Returns null if the point falls outside
    // the raster or hits NaN. We use nearest-pixel for speed; sub-pixel
    // accuracy isn't needed at the 0.5m grid.
    const sampleHeight = (sLat: number, sLng: number): number | null => {
      const fx = (sLng - west) / (east - west) * w
      const fy = (north - sLat) / (north - south) * h
      const px = Math.round(fx)
      const py = Math.round(fy)
      if (px < 0 || px >= w || py < 0 || py >= h) return null
      const v = Number(heightField[py * w + px])
      return Number.isFinite(v) && v > -1000 ? v : null
    }

    // 4. Walk each edge, sample perpendicular pairs, record drops > threshold.
    //    We dedupe adjacent samples that detect the same physical step by
    //    accepting at most one step per edge — typically the midpoint of the
    //    longest consecutive run of step-positive samples.
    const steps: DsmStep[] = []
    const n = polyline.length
    for (let i = 0; i < n; i++) {
      const a = polyline[i]
      const b = polyline[(i + 1) % n]
      const edgeLen = haversineMeters(a, b)
      if (edgeLen < minEdge) continue
      // Unit vector along the edge in (deg lat, deg lng).
      const dLat = b.lat - a.lat
      const dLng = b.lng - a.lng
      // Bearing perpendicular to the edge. Right-hand normal (clockwise 90°)
      // → on a closed polygon traced clockwise, this points outward (away
      // from the building interior). The actual reported bearing is set per
      // sample based on which side is lower.
      const stepsAlong = Math.max(2, Math.floor(edgeLen / alongStep))
      // Convert perpDist (meters) → degrees lat/lng. 1° lat ≈ 111320m
      // everywhere; 1° lng ≈ 111320·cos(lat) m.
      const mLat = perpDist / 111320
      const mLng = perpDist / (111320 * Math.cos((a.lat * Math.PI) / 180))
      // Perpendicular vector: rotate edge vector 90° clockwise in lat/lng.
      // Magnitude is normalized to perpDist meters using the m-per-deg ratios.
      const edgeLenDeg = Math.hypot(dLat, dLng) || 1
      const perpLatPerUnit = (dLng / edgeLenDeg) * mLat       // outward right-hand
      const perpLngPerUnit = (-dLat / edgeLenDeg) * mLng

      // First pass: collect raw drops at each sample.
      const sampleDrops: Array<{ t: number; drop: number; lowerOnRight: boolean }> = []
      for (let s = 0; s <= stepsAlong; s++) {
        const t = s / stepsAlong
        const pLat = a.lat + dLat * t
        const pLng = a.lng + dLng * t
        const rightLat = pLat + perpLatPerUnit
        const rightLng = pLng + perpLngPerUnit
        const leftLat  = pLat - perpLatPerUnit
        const leftLng  = pLng - perpLngPerUnit
        const hR = sampleHeight(rightLat, rightLng)
        const hL = sampleHeight(leftLat, leftLng)
        if (hR == null || hL == null) continue
        const diff = hR - hL
        const absDiff = Math.abs(diff)
        if (absDiff < threshold) continue
        sampleDrops.push({ t, drop: absDiff, lowerOnRight: diff < 0 })
      }
      if (sampleDrops.length === 0) continue

      // Coalesce into the strongest contiguous run. Adjacent samples
      // (Δt within 1.5/stepsAlong) belong to the same physical step.
      const dtClump = 1.5 / stepsAlong
      let runs: Array<typeof sampleDrops> = []
      let cur: typeof sampleDrops = []
      let lastT = -Infinity
      for (const sd of sampleDrops) {
        if (cur.length === 0 || sd.t - lastT <= dtClump) cur.push(sd)
        else { runs.push(cur); cur = [sd] }
        lastT = sd.t
      }
      if (cur.length) runs.push(cur)
      const best = runs.reduce((winner, r) => {
        const peak = r.reduce((m, x) => Math.max(m, x.drop), 0)
        const winnerPeak = winner.length ? winner.reduce((m, x) => Math.max(m, x.drop), 0) : 0
        return peak > winnerPeak ? r : winner
      }, [] as typeof sampleDrops)
      if (!best.length) continue
      const midT = best[Math.floor(best.length / 2)].t
      const peakDrop = best.reduce((m, x) => Math.max(m, x.drop), 0)
      const lowerOnRight = best.filter(x => x.lowerOnRight).length >= best.length / 2
      const midLat = a.lat + dLat * midT
      const midLng = a.lng + dLng * midT
      // Bearing from edge midpoint toward the LOWER side. Right-hand normal
      // = clockwise 90° from edge direction; flip if lower is on the left.
      const edgeBearing = bearingDeg(a, b)
      const perpBearing = (edgeBearing + (lowerOnRight ? 90 : -90) + 360) % 360
      steps.push({
        edge_index: i,
        mid_lat: midLat,
        mid_lng: midLng,
        drop_m: Math.round(peakDrop * 10) / 10,
        perp_bearing_deg: Math.round(perpBearing),
      })
    }

    return {
      available: true,
      steps,
      imagery_date: meta?.imageryDate ? formatImageryDate(meta.imageryDate) : undefined,
    }
  } catch (e: any) {
    console.warn('[dsm-step-detection] failed:', e?.message)
    return { available: false, steps: [] }
  }
}

function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000
  const toRad = (x: number) => x * Math.PI / 180
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat)
  const Δφ = toRad(b.lat - a.lat), Δλ = toRad(b.lng - a.lng)
  const s = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

function bearingDeg(a: LatLng, b: LatLng): number {
  const toRad = (x: number) => x * Math.PI / 180
  const toDeg = (x: number) => x * 180 / Math.PI
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat)
  const Δλ = toRad(b.lng - a.lng)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

function formatImageryDate(d: any): string | undefined {
  try {
    if (d?.year) return `${d.year}-${String(d.month || 1).padStart(2, '0')}-${String(d.day || 1).padStart(2, '0')}`
  } catch { /* */ }
  return undefined
}
