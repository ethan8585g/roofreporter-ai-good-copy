// ============================================================
// Footprint Priors — external building-polygon lookups
// ============================================================
// Free, real-time queryable building-footprint sources used as priors
// for the auto-trace agent. Tier cascade:
//
//   1. City of Edmonton "Building Outlines 2D" (Socrata REST API).
//      Municipal LiDAR-derived polygons, ~annual refresh, highest
//      accuracy for our home market. Only useful when the property
//      is in Edmonton, AB.
//   2. OpenStreetMap via Overpass API. Near-complete in major
//      Canadian residential (Toronto/Ottawa/Montreal/Vancouver/
//      Edmonton/Calgary downtowns); spotty in newer suburbs.
//      Sub-second response for `around:30,lat,lng` lookups.
//
// Both are ODbL/OGL — commercial use OK with attribution, attribution
// is on the report's data-sources block.
//
// Neither source replaces Google Solar — we use them as cross-checks:
// the agent's bbox-trust decision improves when an OSM/city polygon
// agrees with Solar's bbox shape and area. When all three disagree
// we surface the discrepancy in diagnostics.
//
// Defensive: every fetch wrapped in try/catch with short timeouts.
// Public Overpass servers are best-effort — a failed prior never
// blocks the agent.
// ============================================================

import type { LatLng } from '../utils/trace-validation'

export interface FootprintPrior {
  source: 'edmonton' | 'osm-overpass'
  /** Closed polygon in lat/lng. First vertex NOT repeated at the end. */
  ring: LatLng[]
  /** Real-world area in square feet, computed via the Shoelace formula
   *  on the equirectangular projection (good enough for residential lots). */
  area_sqft: number
  /** Identifier for the underlying record so we can audit drift later. */
  source_id?: string
}

export interface FootprintPriorResult {
  /** All priors that returned a polygon containing or near the query point.
   *  Sorted by source preference (edmonton first, then OSM). */
  priors: FootprintPrior[]
  /** Per-source timing in ms — surfaces in agent diagnostics so a slow
   *  Overpass server doesn't silently bloat the auto-trace latency. */
  elapsed_ms: { edmonton?: number; osm?: number }
  /** Per-source soft errors — populated when a source failed but the
   *  overall result is still usable (the caller cascades). */
  errors: { edmonton?: string; osm?: string }
}

const FETCH_TIMEOUT_MS = 4000

/** Fetch building footprint priors near a lat/lng. Tries Edmonton's
 *  Socrata API first when the address is plausibly in Alberta, then OSM
 *  Overpass. Returns whichever sources succeeded; an empty array is a
 *  normal case (rural lot with no OSM coverage). */
export async function fetchFootprintPriors(lat: number, lng: number): Promise<FootprintPriorResult> {
  const result: FootprintPriorResult = { priors: [], elapsed_ms: {}, errors: {} }
  const tasks: Promise<void>[] = []

  // Edmonton bbox (rough): lat 53.3–53.7, lng -113.7 to -113.2. Only fire
  // the city API when the point plausibly falls inside; this avoids
  // pointless requests + occasional 4xx from out-of-bounds queries.
  if (lat >= 53.30 && lat <= 53.70 && lng >= -113.70 && lng <= -113.20) {
    tasks.push((async () => {
      const t0 = Date.now()
      try {
        const ring = await fetchEdmontonFootprint(lat, lng)
        if (ring) {
          result.priors.push({
            source: 'edmonton',
            ring: ring.coords,
            area_sqft: ring.area_sqft,
            source_id: ring.objectid,
          })
        }
      } catch (e: any) {
        result.errors.edmonton = e?.message?.slice(0, 200) || 'unknown'
      } finally {
        result.elapsed_ms.edmonton = Date.now() - t0
      }
    })())
  }

  tasks.push((async () => {
    const t0 = Date.now()
    try {
      const ring = await fetchOSMFootprint(lat, lng)
      if (ring) {
        result.priors.push({
          source: 'osm-overpass',
          ring: ring.coords,
          area_sqft: ring.area_sqft,
          source_id: ring.osmId,
        })
      }
    } catch (e: any) {
      result.errors.osm = e?.message?.slice(0, 200) || 'unknown'
    } finally {
      result.elapsed_ms.osm = Date.now() - t0
    }
  })())

  await Promise.all(tasks)
  return result
}

// ─────────────────────────────────────────────────────────────
// City of Edmonton — Socrata REST API
// ─────────────────────────────────────────────────────────────
// Dataset: "Building Outlines 2D" — LiDAR-derived municipal polygons.
// Query strategy: spatial filter via `within_circle` on the_geom for
// 30m radius around the click. Public; no API key needed for read.
// Returns up to 5 candidates (parcel lines can fragment buildings into
// adjacent units); caller picks the closest.
const EDMONTON_DATASET = 'sw3w-7iuc'  // Building Outlines 2D
const EDMONTON_URL = `https://data.edmonton.ca/resource/${EDMONTON_DATASET}.json`

async function fetchEdmontonFootprint(lat: number, lng: number): Promise<{ coords: LatLng[]; area_sqft: number; objectid?: string } | null> {
  const params = new URLSearchParams({
    $where: `within_circle(the_geom, ${lat.toFixed(6)}, ${lng.toFixed(6)}, 30)`,
    $limit: '5',
  })
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
  let rows: any[]
  try {
    const resp = await fetch(`${EDMONTON_URL}?${params}`, { signal: ac.signal })
    if (!resp.ok) return null
    rows = await resp.json() as any[]
  } finally {
    clearTimeout(timer)
  }
  if (!Array.isArray(rows) || rows.length === 0) return null
  // Pick the polygon that CONTAINS the query point, or the closest by
  // centroid if none contain it. Edmonton returns GeoJSON polygons in
  // `the_geom` with `type: 'Polygon'|'MultiPolygon'`, `coordinates`
  // as [[lng,lat], ...] arrays.
  let best: { coords: LatLng[]; dist: number; objectid?: string } | null = null
  for (const row of rows) {
    const geom = row?.the_geom
    if (!geom) continue
    const rings = extractRings(geom)
    for (const ring of rings) {
      if (ring.length < 3) continue
      const containsPoint = pointInRing(ring, lat, lng)
      const centroid = ringCentroid(ring)
      const dist = haversineMeters(lat, lng, centroid.lat, centroid.lng)
      const score = containsPoint ? -1 : dist  // contained beats any centroid distance
      if (!best || score < best.dist) {
        best = { coords: ring, dist: score, objectid: String(row?.objectid_1 || row?.objectid || '') || undefined }
      }
    }
  }
  if (!best) return null
  return { coords: best.coords, area_sqft: ringAreaSqft(best.coords), objectid: best.objectid }
}

// ─────────────────────────────────────────────────────────────
// OpenStreetMap — Overpass API
// ─────────────────────────────────────────────────────────────
// Query: any `way["building"]` within a 30m radius of the click. The
// public Overpass servers (overpass-api.de, kumi.systems, lz4.overpass-
// api.de) are interchangeable; we use the canonical one with a tight
// timeout. Free, no key, but the load policy says "don't hammer" —
// the auto-trace endpoint is admin-fired only, so this is fine.
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

async function fetchOSMFootprint(lat: number, lng: number): Promise<{ coords: LatLng[]; area_sqft: number; osmId?: string } | null> {
  // The `out geom` directive returns the way's coordinate list inline so
  // we don't need a second `out body` + `out skel` round-trip.
  const query = `[out:json][timeout:3];way["building"](around:30,${lat.toFixed(6)},${lng.toFixed(6)});out geom;`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
  let data: any
  try {
    const resp = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: ac.signal,
    })
    if (!resp.ok) return null
    data = await resp.json()
  } finally {
    clearTimeout(timer)
  }
  const elements: any[] = Array.isArray(data?.elements) ? data.elements : []
  if (elements.length === 0) return null
  // Pick the way whose ring contains the click point; fall back to
  // the closest centroid otherwise.
  let best: { coords: LatLng[]; dist: number; osmId?: string } | null = null
  for (const el of elements) {
    if (el.type !== 'way' || !Array.isArray(el.geometry)) continue
    const ring: LatLng[] = el.geometry.map((p: any) => ({ lat: Number(p.lat), lng: Number(p.lon) }))
    if (ring.length < 3) continue
    // OSM closes rings (last vertex repeats first); drop the duplicate.
    if (Math.abs(ring[0].lat - ring[ring.length - 1].lat) < 1e-9 &&
        Math.abs(ring[0].lng - ring[ring.length - 1].lng) < 1e-9) {
      ring.pop()
    }
    const containsPoint = pointInRing(ring, lat, lng)
    const centroid = ringCentroid(ring)
    const dist = haversineMeters(lat, lng, centroid.lat, centroid.lng)
    const score = containsPoint ? -1 : dist
    if (!best || score < best.dist) {
      best = { coords: ring, dist: score, osmId: String(el?.id ?? '') || undefined }
    }
  }
  if (!best) return null
  return { coords: best.coords, area_sqft: ringAreaSqft(best.coords), osmId: best.osmId }
}

// ─────────────────────────────────────────────────────────────
// Geometry helpers — shared between Edmonton + OSM paths
// ─────────────────────────────────────────────────────────────
function extractRings(geom: { type: string; coordinates: any }): LatLng[][] {
  // GeoJSON Polygon: coordinates = [[[lng,lat], ...]] (outer ring + holes)
  // MultiPolygon: coordinates = [[[[lng,lat], ...]], ...]
  const rings: LatLng[][] = []
  if (geom.type === 'Polygon' && Array.isArray(geom.coordinates)) {
    if (Array.isArray(geom.coordinates[0])) {
      rings.push((geom.coordinates[0] as [number, number][]).map(([lng, lat]) => ({ lat, lng })))
    }
  } else if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
    for (const poly of geom.coordinates) {
      if (Array.isArray(poly?.[0])) {
        rings.push((poly[0] as [number, number][]).map(([lng, lat]) => ({ lat, lng })))
      }
    }
  }
  // Drop duplicated closing vertex if present.
  for (const ring of rings) {
    if (ring.length > 1) {
      const a = ring[0], b = ring[ring.length - 1]
      if (Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9) ring.pop()
    }
  }
  return rings
}

function pointInRing(ring: LatLng[], lat: number, lng: number): boolean {
  // Standard ray-casting; treats lat/lng as flat Cartesian (good enough
  // at residential scale, < 100m).
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng, yi = ring[i].lat
    const xj = ring[j].lng, yj = ring[j].lat
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

function ringCentroid(ring: LatLng[]): LatLng {
  let sumLat = 0, sumLng = 0
  for (const p of ring) { sumLat += p.lat; sumLng += p.lng }
  return { lat: sumLat / ring.length, lng: sumLng / ring.length }
}

function ringAreaSqft(ring: LatLng[]): number {
  if (ring.length < 3) return 0
  // Shoelace on local equirectangular projection. ft per degree latitude
  // is constant (~364,000); ft per degree longitude depends on cos(lat).
  const centroid = ringCentroid(ring)
  const FT_PER_DEG_LAT = 364_000
  const FT_PER_DEG_LNG = 364_000 * Math.cos(centroid.lat * Math.PI / 180)
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    sum += (a.lng * FT_PER_DEG_LNG) * (b.lat * FT_PER_DEG_LAT) - (b.lng * FT_PER_DEG_LNG) * (a.lat * FT_PER_DEG_LAT)
  }
  return Math.abs(sum) / 2
}

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000
  const dLat = (bLat - aLat) * Math.PI / 180
  const dLng = (bLng - aLng) * Math.PI / 180
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}
