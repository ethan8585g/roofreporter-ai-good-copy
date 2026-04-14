// ============================================================
// Storm Scout — Storm data service
// Fetches live severe-weather alerts from free government APIs
// and normalizes them into a unified StormEvent shape.
// ============================================================

export type StormSource = 'eccc' | 'nws' | 'mrms'
export type StormType = 'hail' | 'wind' | 'tornado' | 'thunderstorm' | 'other'
export type StormSeverity = 'advisory' | 'watch' | 'warning' | 'extreme'

export interface StormEvent {
  id: string
  source: StormSource
  type: StormType
  severity: StormSeverity
  coordinates: { lat: number; lng: number }
  polygon?: Array<{ lat: number; lng: number }>
  hailSizeInches?: number
  windSpeedKmh?: number
  timestamp: string
  expiresAt?: string
  description: string
  headline?: string
}

interface CacheEntry {
  data: StormEvent[]
  expiresAt: number
}

const ALERT_TTL_MS = 15 * 60 * 1000
let cache: CacheEntry | null = null

export function stormCacheClear() { cache = null }

function classifyType(text: string): StormType {
  const t = text.toLowerCase()
  if (t.includes('tornado')) return 'tornado'
  if (t.includes('hail')) return 'hail'
  if (t.includes('wind')) return 'wind'
  if (t.includes('thunderstorm') || t.includes('severe')) return 'thunderstorm'
  return 'other'
}

function classifySeverity(text: string): StormSeverity {
  const t = text.toLowerCase()
  if (t.includes('extreme') || t.includes('emergency')) return 'extreme'
  if (t.includes('warning')) return 'warning'
  if (t.includes('watch')) return 'watch'
  return 'advisory'
}

function flattenPolygon(geom: any): Array<{ lat: number; lng: number }> | undefined {
  if (!geom || !geom.type) return undefined
  // GeoJSON is [lng, lat]
  const toLL = (c: any) => ({ lat: c[1], lng: c[0] })
  if (geom.type === 'Polygon' && Array.isArray(geom.coordinates?.[0])) {
    return geom.coordinates[0].map(toLL)
  }
  if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates?.[0]?.[0])) {
    return geom.coordinates[0][0].map(toLL)
  }
  return undefined
}

function centroidOf(pts: Array<{ lat: number; lng: number }>): { lat: number; lng: number } {
  let lat = 0, lng = 0
  for (const p of pts) { lat += p.lat; lng += p.lng }
  return { lat: lat / pts.length, lng: lng / pts.length }
}

// ------------------------------------------------------------
// Environment Canada (MSC GeoMet, OGC-API)
// Public, anonymous — no key required.
// ------------------------------------------------------------
export async function fetchECCCAlerts(): Promise<StormEvent[]> {
  const url = 'https://api.weather.gc.ca/collections/alerts/items?f=json&limit=500'
  const res = await fetch(url, { headers: { Accept: 'application/geo+json,application/json' } })
  if (!res.ok) throw new Error(`ECCC alerts HTTP ${res.status}`)
  const json: any = await res.json()
  const features: any[] = Array.isArray(json?.features) ? json.features : []

  const events: StormEvent[] = []
  for (const f of features) {
    const p = f.properties || {}
    const headline: string = p.headline || p.event || p.alert_type || 'Weather alert'
    const desc: string = p.descrip_en || p.description || p.summary || headline
    const text = `${headline} ${desc}`
    const type = classifyType(text)
    // Only keep storm-related alerts (skip e.g. air quality, fog, freezing rain advisories
    // that aren't actionable for roofers). Keep thunderstorm/hail/wind/tornado.
    if (type === 'other') continue

    const poly = flattenPolygon(f.geometry)
    const coords = poly && poly.length ? centroidOf(poly) : { lat: 0, lng: 0 }

    events.push({
      id: `eccc:${f.id || p.identifier || p.alert_id || crypto.randomUUID()}`,
      source: 'eccc',
      type,
      severity: classifySeverity(text),
      coordinates: coords,
      polygon: poly,
      timestamp: p.sent || p.effective || p.onset || new Date().toISOString(),
      expiresAt: p.expires || p.ends || undefined,
      description: desc,
      headline
    })
  }
  return events
}

// ------------------------------------------------------------
// Cached fetcher — single entry point for the route layer
// ------------------------------------------------------------
export async function getActiveAlerts(): Promise<{ events: StormEvent[]; cached: boolean; fetchedAt: string }> {
  if (cache && Date.now() < cache.expiresAt) {
    return { events: cache.data, cached: true, fetchedAt: new Date(cache.expiresAt - ALERT_TTL_MS).toISOString() }
  }
  let events: StormEvent[] = []
  try {
    events = await fetchECCCAlerts()
  } catch (err) {
    if (cache) return { events: cache.data, cached: true, fetchedAt: new Date(cache.expiresAt - ALERT_TTL_MS).toISOString() }
    throw err
  }
  cache = { data: events, expiresAt: Date.now() + ALERT_TTL_MS }
  return { events, cached: false, fetchedAt: new Date().toISOString() }
}
