// ============================================================
// Storm Scout — Matcher (Phase 3)
// Geometry helpers + event-to-area matching. Pure functions, no DB.
// ============================================================

export type LatLng = { lat: number; lng: number }
export type Ring = LatLng[]

export interface ServiceArea {
  id: number
  customer_id: number
  name: string
  polygon: Ring                          // outer ring in lat/lng
  min_hail_inches: number
  min_wind_kmh: number
  types: string[]                        // e.g. ['hail','wind','tornado','thunderstorm']
  notify_email: boolean
  notify_push: boolean
}

export interface StormEventLite {
  id: string
  source: string
  type: string
  severity: string
  timestamp: string
  hailSizeInches?: number
  windSpeedKmh?: number
  coordinates?: LatLng
  polygon?: Ring
  description?: string
  headline?: string
}

export interface HailReportLite {
  id: string
  lat: number
  lng: number
  sizeInches: number
  timestamp: string
  type: string
  remarks?: string
}

export interface Match {
  area: ServiceArea
  eventType: string
  source: string
  severity: string
  timestamp: string
  hailInches?: number
  windKmh?: number
  lat: number
  lng: number
  description: string
  dedupeKey: string
}

// ------------------------------------------------------------
// Geometry — ray-casting point-in-polygon. Works in lat/lng
// (treated as planar — fine at roofer scale).
// ------------------------------------------------------------
export function pointInPolygon(pt: LatLng, ring: Ring): boolean {
  if (!ring || ring.length < 3) return false
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng, yi = ring[i].lat
    const xj = ring[j].lng, yj = ring[j].lat
    const intersect = ((yi > pt.lat) !== (yj > pt.lat)) &&
      (pt.lng < ((xj - xi) * (pt.lat - yi)) / ((yj - yi) || 1e-12) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

export function ringBounds(ring: Ring): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
  for (const p of ring) {
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
    if (p.lng < minLng) minLng = p.lng
    if (p.lng > maxLng) maxLng = p.lng
  }
  return { minLat, maxLat, minLng, maxLng }
}

export function ringCentroid(ring: Ring): LatLng {
  let lat = 0, lng = 0
  for (const p of ring) { lat += p.lat; lng += p.lng }
  return { lat: lat / ring.length, lng: lng / ring.length }
}

// Fast bbox overlap check (used as a prefilter before point-in-polygon).
export function bboxOverlaps(a: Ring, b: Ring): boolean {
  const A = ringBounds(a), B = ringBounds(b)
  return !(A.maxLat < B.minLat || A.minLat > B.maxLat || A.maxLng < B.minLng || A.minLng > B.maxLng)
}

// ------------------------------------------------------------
// Matcher
// ------------------------------------------------------------
function passesThreshold(area: ServiceArea, ev: { type: string; hailSizeInches?: number; windSpeedKmh?: number }): boolean {
  if (area.types.length && area.types.indexOf(ev.type) < 0) return false
  if (ev.type === 'hail') {
    if ((ev.hailSizeInches || 0) < area.min_hail_inches) return false
  }
  if (ev.type === 'wind') {
    if ((ev.windSpeedKmh || 0) < area.min_wind_kmh) return false
  }
  // tornado / thunderstorm: any severity counts if the type is enabled
  return true
}

function dedupe(customerId: number, areaId: number, evId: string): string {
  return `${customerId}:${areaId}:${evId}`
}

export function matchEvents(
  areas: ServiceArea[],
  alerts: StormEventLite[],
  hailReports: HailReportLite[]
): Match[] {
  const matches: Match[] = []
  if (!areas.length) return matches

  // Precompute bboxes
  const areaBoxes = areas.map(a => ({ area: a, bounds: ringBounds(a.polygon) }))

  // --- Alert polygons ---
  for (const ev of alerts) {
    const evRing = ev.polygon
    const evCentroid = ev.coordinates || (evRing ? ringCentroid(evRing) : null)
    if (!evCentroid) continue

    for (const { area, bounds } of areaBoxes) {
      if (!passesThreshold(area, ev)) continue
      // Cheap check: centroid in area?
      const centroidIn = pointInPolygon(evCentroid, area.polygon)
      // If alert has a polygon, also consider its bbox vs area bbox
      let polyOverlap = false
      if (evRing && evRing.length >= 3) {
        const evBounds = ringBounds(evRing)
        const bboxHit = !(evBounds.maxLat < bounds.minLat || evBounds.minLat > bounds.maxLat ||
                          evBounds.maxLng < bounds.minLng || evBounds.minLng > bounds.maxLng)
        if (bboxHit) {
          // Any vertex of the alert polygon inside the area counts as overlap.
          for (const v of evRing) { if (pointInPolygon(v, area.polygon)) { polyOverlap = true; break } }
        }
      }
      if (!centroidIn && !polyOverlap) continue

      matches.push({
        area,
        eventType: ev.type,
        source: ev.source,
        severity: ev.severity,
        timestamp: ev.timestamp,
        hailInches: ev.hailSizeInches,
        windKmh: ev.windSpeedKmh,
        lat: evCentroid.lat,
        lng: evCentroid.lng,
        description: ev.headline || ev.description || `${ev.type} ${ev.severity}`,
        dedupeKey: dedupe(area.customer_id, area.id, ev.id)
      })
    }
  }

  // --- Hail point reports ---
  for (const r of hailReports) {
    const pt = { lat: r.lat, lng: r.lng }
    for (const { area } of areaBoxes) {
      if (!passesThreshold(area, { type: 'hail', hailSizeInches: r.sizeInches })) continue
      if (!pointInPolygon(pt, area.polygon)) continue
      matches.push({
        area,
        eventType: 'hail',
        source: 'iem',
        severity: 'lsr',
        timestamp: r.timestamp,
        hailInches: r.sizeInches,
        lat: r.lat,
        lng: r.lng,
        description: `${r.sizeInches.toFixed(2)}" hail report${r.remarks ? ' — ' + r.remarks.slice(0, 120) : ''}`,
        dedupeKey: dedupe(area.customer_id, area.id, r.id)
      })
    }
  }

  return matches
}
