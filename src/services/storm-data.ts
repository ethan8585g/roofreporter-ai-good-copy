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

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

const ALERT_TTL_MS = 15 * 60 * 1000
const HAIL_TTL_MS = 2 * 60 * 60 * 1000
let cache: CacheEntry<StormEvent[]> | null = null
let hailCache: Record<number, CacheEntry<any[]>> = {}

export function stormCacheClear() { cache = null; hailCache = {} }

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
  if (!geom || !geom.type || !Array.isArray(geom.coordinates)) return undefined
  const toLL = (c: any) => (Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    ? { lat: c[1], lng: c[0] } : null
  try {
    let ring: any[] | null = null
    if (geom.type === 'Polygon' && Array.isArray(geom.coordinates[0])) ring = geom.coordinates[0]
    else if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates[0]?.[0])) ring = geom.coordinates[0][0]
    if (!ring || ring.length < 3) return undefined
    const pts = ring.map(toLL).filter((p: any) => p) as Array<{ lat: number; lng: number }>
    return pts.length >= 3 ? pts : undefined
  } catch {
    return undefined
  }
}

function centroidOf(pts: Array<{ lat: number; lng: number }>): { lat: number; lng: number } {
  let lat = 0, lng = 0
  for (const p of pts) { lat += p.lat; lng += p.lng }
  return { lat: lat / pts.length, lng: lng / pts.length }
}

// ------------------------------------------------------------
// Environment Canada (MSC GeoMet, OGC-API)
// Public, anonymous — no key required.
// Collection id is `weather-alerts` (the legacy `alerts` id was removed).
// ------------------------------------------------------------
export async function fetchECCCAlerts(): Promise<StormEvent[]> {
  const url = 'https://api.weather.gc.ca/collections/weather-alerts/items?f=json&limit=500'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  let res: Response
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/geo+json,application/json' }
    })
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error('ECCC alerts timeout after 15s')
    throw err
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) throw new Error(`ECCC alerts HTTP ${res.status}`)
  const json: any = await res.json()
  const features: any[] = Array.isArray(json?.features) ? json.features : []

  const events: StormEvent[] = []
  for (const f of features) {
    try {
    const p = f.properties || {}
    // ECCC GeoMet `weather-alerts` field shape differs from the legacy `alerts`
    // collection — headline lives in alert_name_en, body in alert_text_en,
    // timestamps in publication_datetime / expiration_datetime. Keep legacy
    // fallbacks so a future schema revert doesn't silently break the mapping.
    const headline: string = p.alert_name_en || p.alert_short_name_en || p.headline || p.event || p.alert_type || 'Weather alert'
    const desc: string = p.alert_text_en || p.descrip_en || p.description || p.summary || headline
    const severityText: string = p.alert_type || ''
    const text = `${headline} ${desc} ${severityText}`
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
      timestamp: p.publication_datetime || p.sent || p.effective || p.onset || new Date().toISOString(),
      expiresAt: p.expiration_datetime || p.event_end_datetime || p.expires || p.ends || undefined,
      description: desc,
      headline
    })
    } catch (err) {
      console.warn('[storm-scout] ECCC feature parse failed:', (err as any)?.message)
    }
  }
  return events
}

// ------------------------------------------------------------
// Cached fetcher — single entry point for the route layer
// ------------------------------------------------------------
export async function getActiveAlerts(): Promise<{ events: StormEvent[]; cached: boolean; stale?: boolean; fetchedAt: string; sources: Record<string, number | string> }> {
  if (cache && Date.now() < cache.expiresAt) {
    return { events: cache.data, cached: true, fetchedAt: new Date(cache.expiresAt - ALERT_TTL_MS).toISOString(), sources: { cache: 'hit' } }
  }
  const { fetchNWSAlerts } = await import('./nws-data')
  const results = await Promise.allSettled([fetchECCCAlerts(), fetchNWSAlerts()])
  const events: StormEvent[] = []
  const sources: Record<string, number | string> = {}
  const eccc = results[0]
  const nws = results[1]
  if (eccc.status === 'fulfilled') { events.push(...eccc.value); sources.eccc = eccc.value.length }
  else sources.eccc = 'error: ' + (eccc.reason?.message || 'unknown')
  if (nws.status === 'fulfilled') { events.push(...nws.value); sources.nws = nws.value.length }
  else sources.nws = 'error: ' + (nws.reason?.message || 'unknown')

  // Stale-while-error: if both upstreams failed but we have a prior cache, serve
  // it rather than leaving the Live view empty. The cache TTL is already past at
  // this point, so flag `stale: true` so the UI can indicate it.
  const bothFailed = eccc.status === 'rejected' && nws.status === 'rejected'
  if ((events.length === 0 || bothFailed) && cache) {
    return { events: cache.data, cached: true, stale: true, fetchedAt: new Date(cache.expiresAt - ALERT_TTL_MS).toISOString(), sources }
  }
  cache = { data: events, expiresAt: Date.now() + ALERT_TTL_MS }
  return { events, cached: false, fetchedAt: new Date().toISOString(), sources }
}

export async function getHailReports(daysBack: number): Promise<{ reports: any[]; cached: boolean; stale?: boolean; fetchedAt: string }> {
  const days = Math.max(1, Math.min(30, Math.round(daysBack)))
  const entry = hailCache[days]
  if (entry && Date.now() < entry.expiresAt) {
    return { reports: entry.data, cached: true, fetchedAt: new Date(entry.expiresAt - HAIL_TTL_MS).toISOString() }
  }
  const { fetchIEMLocalStormReports } = await import('./nws-data')
  try {
    const reports = await fetchIEMLocalStormReports(days)
    hailCache[days] = { data: reports, expiresAt: Date.now() + HAIL_TTL_MS }
    return { reports, cached: false, fetchedAt: new Date().toISOString() }
  } catch (err) {
    // IEM LSR is occasionally very slow (7-day window regularly takes 30s+),
    // which can time out a Workers request. If we have a stale snapshot, serve
    // it so "Live" doesn't go blank while the upstream recovers.
    if (entry) {
      return { reports: entry.data, cached: true, stale: true, fetchedAt: new Date(entry.expiresAt - HAIL_TTL_MS).toISOString() }
    }
    throw err
  }
}
