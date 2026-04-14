// ============================================================
// Solar Panel Layout Generator
//
// Algorithmically places PV panels on a roof using one of two
// geometry sources:
//   (1) SEGMENTS from Google Solar API — axis-aligned bounding
//       boxes with pitch + azimuth per segment.
//   (2) FACES from the RoofMeasurementEngine — lat/lng polygon
//       vertices per face, with pitch and (optional) azimuth.
//
// The engine:
//   - Converts each face/segment into a local tangent plane
//     rotated so rows align with the face's azimuth (ridge line).
//   - Applies setback buffers (NFPA 1, IRC 2021):
//       * Eaves:    18 in (0.457 m) default
//       * Ridge:    36 in (0.914 m) default
//       * Sides:    12 in (0.305 m) default
//   - Grid-packs both PORTRAIT and LANDSCAPE orientations, picks
//     whichever fits more panels per face.
//   - Subtracts obstruction polygons (chimneys / skylights / vents).
//   - Estimates per-panel DC kWh/yr using a simple pitch+azimuth
//     irradiance model (Liu-Jordan style) when Google Solar
//     yearly-energy data isn't available.
//
// Output is the same shape the solar-proposal template already
// expects: `suggested_panels: {lat,lng,orientation,segment_index,
// yearly_energy_kwh}[]` plus per-face placement diagnostics.
// ============================================================

export interface LatLng { lat: number; lng: number }

export interface LayoutSegmentInput {
  // Required: which face/segment
  index: number
  pitch_deg: number
  azimuth_deg: number         // 180 = south-facing in northern hemisphere
  // Provide EITHER a bounding box OR a polygon of vertices
  bbox?: { sw: LatLng; ne: LatLng }
  polygon?: LatLng[]          // preferred — full face geometry
}

export interface LayoutObstruction {
  // Polygon in lat/lng (already projected — vents/chimneys/skylights)
  poly?: LatLng[]
  // Or a point + radius (simpler)
  center?: LatLng
  radius_m?: number
}

export interface PanelLayoutOptions {
  panel_height_m?: number     // default 1.879 (standard residential module)
  panel_width_m?: number      // default 1.045
  panel_watts?: number        // default 400
  setback_eave_m?: number     // default 0.457 (18")
  setback_ridge_m?: number    // default 0.914 (36")
  setback_side_m?: number     // default 0.305 (12")
  panel_gap_m?: number        // default 0.02 (≈0.8" row gap)
  include_landscape?: boolean // default true — try both orientations
  // If provided, panel kWh/yr = (per_panel_kwh) — used when Google
  // data is available (yearlyEnergyDcKwh / panelCount).
  reference_panel_kwh?: number
  // Latitude for the site — used for the Liu-Jordan fallback only.
  site_latitude?: number
}

export interface PlacedPanel {
  lat: number
  lng: number
  orientation: 'PORTRAIT' | 'LANDSCAPE'
  segment_index: number
  yearly_energy_kwh: number
}

export interface PanelLayoutResult {
  suggested_panels: PlacedPanel[]
  panel_count: number
  yearly_energy_kwh: number
  panel_capacity_watts: number
  panel_height_meters: number
  panel_width_meters: number
  segments_placed: {
    segment_index: number
    panel_count: number
    orientation: 'PORTRAIT' | 'LANDSCAPE'
    usable_area_m2: number
    pitch_deg: number
    azimuth_deg: number
    reason?: string           // if zero panels, why
  }[]
  warnings: string[]
}

// ─── Constants ──────────────────────────────────────────────
const M_PER_DEG_LAT = 111_320
const DEG = Math.PI / 180

// ─── Lat/Lng ↔ local meters (equirectangular around origin) ─
function mPerDegLng(lat: number) { return M_PER_DEG_LAT * Math.cos(lat * DEG) }

function toLocal(p: LatLng, origin: LatLng): { x: number; y: number } {
  return {
    x: (p.lng - origin.lng) * mPerDegLng(origin.lat),
    y: (p.lat - origin.lat) * M_PER_DEG_LAT,
  }
}

function fromLocal(x: number, y: number, origin: LatLng): LatLng {
  return {
    lat: origin.lat + y / M_PER_DEG_LAT,
    lng: origin.lng + x / mPerDegLng(origin.lat),
  }
}

// Rotate (x,y) by angleRad around origin — positive = CCW
function rotate(x: number, y: number, angleRad: number) {
  const c = Math.cos(angleRad), s = Math.sin(angleRad)
  return { x: x * c - y * s, y: x * s + y * c }
}

function centroid(poly: LatLng[]): LatLng {
  const lat = poly.reduce((s, p) => s + p.lat, 0) / poly.length
  const lng = poly.reduce((s, p) => s + p.lng, 0) / poly.length
  return { lat, lng }
}

// ── Point-in-polygon (ray casting, local coords) ────────────
function pointInPolygonLocal(x: number, y: number, ring: { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y
    const xj = ring[j].x, yj = ring[j].y
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

// Test whether a rectangle (given by 4 corner points in local coords)
// fully lies inside a polygon ring.
function rectInsidePolygon(
  corners: { x: number; y: number }[],
  ring: { x: number; y: number }[]
): boolean {
  for (const c of corners) {
    if (!pointInPolygonLocal(c.x, c.y, ring)) return false
  }
  return true
}

// Liu-Jordan-ish fallback: approximate annual DC yield for one
// panel given tilt + azimuth deviation from south + latitude.
// Returns kWh/yr. Very rough — a real model would use TMY data.
function estimatePanelKwh(
  panelWatts: number,
  pitchDeg: number,
  azimuthDeg: number,
  latitude: number,
  derate = 0.78        // inverter + DC wiring + soiling
): number {
  // Peak sun-hours baseline for latitude band (very rough table)
  const absLat = Math.abs(latitude)
  let psh = 4.5 // default mid-latitude (~40°)
  if (absLat < 25) psh = 5.3
  else if (absLat < 35) psh = 5.0
  else if (absLat < 45) psh = 4.4
  else if (absLat < 55) psh = 3.6
  else psh = 3.0

  // Tilt match: optimal ≈ latitude. Penalize deviation.
  const tiltErr = Math.abs(pitchDeg - absLat)
  const tiltFactor = 1 - Math.min(0.18, tiltErr / 90)   // up to −18%

  // Azimuth match: optimal = 180° (S) in N-hemisphere.
  const target = latitude >= 0 ? 180 : 0
  let azDev = Math.abs(((azimuthDeg - target + 540) % 360) - 180)
  if (azDev > 180) azDev = 360 - azDev
  // Cosine-like falloff: due-south = 1, due-E/W ≈ 0.85, due-N ≈ 0.5
  const azFactor = 0.5 + 0.5 * Math.cos(azDev * DEG)

  return panelWatts * psh * 365 * tiltFactor * azFactor * derate / 1000
}

// ─── Core: pack panels on one segment ────────────────────────

function packSegment(
  seg: LayoutSegmentInput,
  options: Required<PanelLayoutOptions>,
  obstructionsLatLng: LatLng[][]
): {
  panels: PlacedPanel[]
  orientation: 'PORTRAIT' | 'LANDSCAPE'
  usable_area_m2: number
  reason?: string
} {
  // Build a polygon representing the placeable face area.
  const poly: LatLng[] = seg.polygon && seg.polygon.length >= 3
    ? seg.polygon
    : seg.bbox
      ? [
          seg.bbox.sw,
          { lat: seg.bbox.sw.lat, lng: seg.bbox.ne.lng },
          seg.bbox.ne,
          { lat: seg.bbox.ne.lat, lng: seg.bbox.sw.lng },
        ]
      : []
  if (poly.length < 3) {
    return { panels: [], orientation: 'PORTRAIT', usable_area_m2: 0, reason: 'no geometry' }
  }

  const origin = centroid(poly)

  // Project to local plane (meters)
  const localPoly = poly.map(p => toLocal(p, origin))

  // Rotate so +y points "up the slope" (toward ridge).
  // Convention: azimuth is the compass bearing of the face's downslope
  // normal (0 = N, 90 = E, 180 = S). "Up-slope" in local frame points
  // opposite the azimuth. We want to align our rows perpendicular to
  // the fall-line, i.e. rows run horizontally across the roof.
  const rotAngle = -seg.azimuth_deg * DEG
  const rotPoly = localPoly.map(p => rotate(p.x, p.y, rotAngle))

  // Face AABB in the rotated frame
  const minX = Math.min(...rotPoly.map(p => p.x))
  const maxX = Math.max(...rotPoly.map(p => p.x))
  const minY = Math.min(...rotPoly.map(p => p.y))
  const maxY = Math.max(...rotPoly.map(p => p.y))

  // Apply setback buffers. Top edge (maxY) is the ridge, bottom (minY)
  // is the eave. NOTE: this is a simplification — real ridges often
  // follow a diagonal. For typical hip/gable faces it's close enough.
  const usableMinX = minX + options.setback_side_m
  const usableMaxX = maxX - options.setback_side_m
  const usableMinY = minY + options.setback_eave_m
  const usableMaxY = maxY - options.setback_ridge_m

  if (usableMaxX <= usableMinX || usableMaxY <= usableMinY) {
    return { panels: [], orientation: 'PORTRAIT', usable_area_m2: 0, reason: 'too small after setback' }
  }

  // Pre-project obstructions into the same rotated frame
  const rotObstructions: { x: number; y: number }[][] = obstructionsLatLng
    .map(o => o.map(p => toLocal(p, origin)).map(p => rotate(p.x, p.y, rotAngle)))

  const tryOrientation = (w: number, h: number): { panels: PlacedPanel[] } => {
    const rows = Math.floor((usableMaxY - usableMinY + options.panel_gap_m) / (h + options.panel_gap_m))
    const cols = Math.floor((usableMaxX - usableMinX + options.panel_gap_m) / (w + options.panel_gap_m))
    if (rows <= 0 || cols <= 0) return { panels: [] }

    // Center the grid inside the usable band
    const gridWidth  = cols * w + (cols - 1) * options.panel_gap_m
    const gridHeight = rows * h + (rows - 1) * options.panel_gap_m
    const startX = usableMinX + ((usableMaxX - usableMinX) - gridWidth) / 2
    const startY = usableMinY + ((usableMaxY - usableMinY) - gridHeight) / 2

    const placed: PlacedPanel[] = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = startX + c * (w + options.panel_gap_m)
        const y0 = startY + r * (h + options.panel_gap_m)
        const corners = [
          { x: x0,     y: y0 },
          { x: x0 + w, y: y0 },
          { x: x0 + w, y: y0 + h },
          { x: x0,     y: y0 + h },
        ]
        // Must lie inside the face polygon (handles non-rect roofs)
        if (!rectInsidePolygon(corners, rotPoly)) continue

        // Must not overlap any obstruction
        const cx = x0 + w / 2, cy = y0 + h / 2
        let blocked = false
        for (const obs of rotObstructions) {
          if (pointInPolygonLocal(cx, cy, obs)) { blocked = true; break }
          // Also reject if ANY corner falls inside the obstruction
          for (const k of corners) {
            if (pointInPolygonLocal(k.x, k.y, obs)) { blocked = true; break }
          }
          if (blocked) break
        }
        if (blocked) continue

        // Back-project center to lat/lng
        const backRot = rotate(cx, cy, -rotAngle)
        const ll = fromLocal(backRot.x, backRot.y, origin)

        const perPanelKwh = options.reference_panel_kwh > 0
          ? options.reference_panel_kwh
          : estimatePanelKwh(options.panel_watts, seg.pitch_deg, seg.azimuth_deg, options.site_latitude)

        placed.push({
          lat: ll.lat,
          lng: ll.lng,
          orientation: w > h ? 'LANDSCAPE' : 'PORTRAIT',
          segment_index: seg.index,
          yearly_energy_kwh: Math.round(perPanelKwh * 10) / 10,
        })
      }
    }
    return { panels: placed }
  }

  // Try portrait (w < h), and optionally landscape — pick the winner
  const portrait  = tryOrientation(options.panel_width_m, options.panel_height_m)
  const landscape = options.include_landscape
    ? tryOrientation(options.panel_height_m, options.panel_width_m)
    : { panels: [] as PlacedPanel[] }

  const winner = landscape.panels.length > portrait.panels.length ? landscape : portrait
  const orientation: 'PORTRAIT' | 'LANDSCAPE' =
    landscape.panels.length > portrait.panels.length ? 'LANDSCAPE' : 'PORTRAIT'

  const usable_area_m2 =
    Math.max(0, usableMaxX - usableMinX) * Math.max(0, usableMaxY - usableMinY)

  return {
    panels: winner.panels,
    orientation,
    usable_area_m2,
    reason: winner.panels.length === 0 ? 'no panels fit after setback + obstruction check' : undefined,
  }
}

// ─── Public API ──────────────────────────────────────────────

export function generatePanelLayout(
  segments: LayoutSegmentInput[],
  obstructions: LayoutObstruction[] = [],
  opts: PanelLayoutOptions = {}
): PanelLayoutResult {
  const options: Required<PanelLayoutOptions> = {
    panel_height_m:     opts.panel_height_m     ?? 1.879,
    panel_width_m:      opts.panel_width_m      ?? 1.045,
    panel_watts:        opts.panel_watts        ?? 400,
    setback_eave_m:     opts.setback_eave_m     ?? 0.457,
    setback_ridge_m:    opts.setback_ridge_m    ?? 0.914,
    setback_side_m:     opts.setback_side_m     ?? 0.305,
    panel_gap_m:        opts.panel_gap_m        ?? 0.02,
    include_landscape:  opts.include_landscape  ?? true,
    reference_panel_kwh: opts.reference_panel_kwh ?? 0,
    site_latitude:      opts.site_latitude      ?? 45,
  }

  // Normalize obstruction inputs into polygon rings (lat/lng)
  const obstructionPolys: LatLng[][] = []
  for (const o of obstructions) {
    if (o.poly && o.poly.length >= 3) {
      obstructionPolys.push(o.poly)
    } else if (o.center && o.radius_m && o.radius_m > 0) {
      // Approximate disc as 12-sided polygon
      const steps = 12
      const dLat = o.radius_m / M_PER_DEG_LAT
      const dLng = o.radius_m / mPerDegLng(o.center.lat)
      const ring: LatLng[] = []
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * 2 * Math.PI
        ring.push({
          lat: o.center.lat + Math.sin(a) * dLat,
          lng: o.center.lng + Math.cos(a) * dLng,
        })
      }
      obstructionPolys.push(ring)
    }
  }

  const warnings: string[] = []
  const allPanels: PlacedPanel[] = []
  const perSeg: PanelLayoutResult['segments_placed'] = []

  for (const seg of segments) {
    if (!isFinite(seg.pitch_deg) || !isFinite(seg.azimuth_deg)) {
      warnings.push(`Segment ${seg.index}: missing pitch/azimuth — skipped.`)
      perSeg.push({
        segment_index: seg.index, panel_count: 0, orientation: 'PORTRAIT',
        usable_area_m2: 0, pitch_deg: seg.pitch_deg, azimuth_deg: seg.azimuth_deg,
        reason: 'missing pitch/azimuth',
      })
      continue
    }
    // Skip steep or near-flat faces at operator's option (typical rules:
    // < 2° = built-up, needs ballast; > 45° = hard to mount on).
    if (seg.pitch_deg > 55) {
      warnings.push(`Segment ${seg.index}: pitch ${seg.pitch_deg.toFixed(1)}° exceeds 55° — too steep for standard racking.`)
    }
    const result = packSegment(seg, options, obstructionPolys)
    allPanels.push(...result.panels)
    perSeg.push({
      segment_index: seg.index,
      panel_count: result.panels.length,
      orientation: result.orientation,
      usable_area_m2: Math.round(result.usable_area_m2 * 10) / 10,
      pitch_deg: seg.pitch_deg,
      azimuth_deg: seg.azimuth_deg,
      reason: result.reason,
    })
  }

  const yearly = allPanels.reduce((s, p) => s + p.yearly_energy_kwh, 0)

  return {
    suggested_panels: allPanels,
    panel_count: allPanels.length,
    yearly_energy_kwh: Math.round(yearly),
    panel_capacity_watts: options.panel_watts,
    panel_height_meters: options.panel_height_m,
    panel_width_meters: options.panel_width_m,
    segments_placed: perSeg,
    warnings,
  }
}
