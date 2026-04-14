// ============================================================
// Storm Scout — NOAA/NWS data service
// Free, anonymous APIs (User-Agent header required by api.weather.gov).
// ============================================================

import type { StormEvent, StormSeverity, StormType } from './storm-data'

const UA = 'RoofManager-StormScout/1.0 (support@roofmanager.ca)'

export interface HailReport {
  id: string
  lat: number
  lng: number
  sizeInches: number
  timestamp: string
  source: 'nws-lsr' | 'iem'
  type: 'hail' | 'wind' | 'tornado'
  magnitude?: number     // e.g. wind gust mph, or tornado EF
  remarks?: string
  city?: string
  state?: string
}

function centroidOfGeoJSON(geom: any): { lat: number; lng: number } | null {
  if (!geom) return null
  if (geom.type === 'Point' && Array.isArray(geom.coordinates)) {
    return { lng: geom.coordinates[0], lat: geom.coordinates[1] }
  }
  const flatten = (g: any): number[][] => {
    if (g.type === 'Polygon') return g.coordinates[0]
    if (g.type === 'MultiPolygon') return g.coordinates[0][0]
    return []
  }
  const pts = flatten(geom)
  if (!pts.length) return null
  let lat = 0, lng = 0
  for (const p of pts) { lng += p[0]; lat += p[1] }
  return { lat: lat / pts.length, lng: lng / pts.length }
}

function polygonFromGeoJSON(geom: any): Array<{ lat: number; lng: number }> | undefined {
  if (!geom) return undefined
  const toLL = (c: any) => ({ lat: c[1], lng: c[0] })
  if (geom.type === 'Polygon') return geom.coordinates[0].map(toLL)
  if (geom.type === 'MultiPolygon') return geom.coordinates[0][0].map(toLL)
  return undefined
}

function classifyNWSType(event: string): StormType | null {
  const e = event.toLowerCase()
  if (e.includes('tornado')) return 'tornado'
  if (e.includes('hail')) return 'hail'
  if (e.includes('severe thunderstorm') || e.includes('thunderstorm')) return 'thunderstorm'
  if (e.includes('wind')) return 'wind'
  return null
}

function classifyNWSSeverity(severity: string, event: string): StormSeverity {
  const s = (severity || '').toLowerCase()
  const e = (event || '').toLowerCase()
  if (s.includes('extreme')) return 'extreme'
  if (e.includes('warning')) return 'warning'
  if (e.includes('watch')) return 'watch'
  if (s.includes('severe')) return 'warning'
  return 'advisory'
}

// ------------------------------------------------------------
// Active alerts — api.weather.gov
// ------------------------------------------------------------
export async function fetchNWSAlerts(): Promise<StormEvent[]> {
  const url = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert'
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/geo+json' } })
  if (!res.ok) throw new Error(`NWS alerts HTTP ${res.status}`)
  const json: any = await res.json()
  const features: any[] = Array.isArray(json?.features) ? json.features : []

  const out: StormEvent[] = []
  for (const f of features) {
    try {
    const p = f.properties || {}
    const eventStr: string = p.event || ''
    const type = classifyNWSType(eventStr)
    if (!type) continue

    const poly = polygonFromGeoJSON(f.geometry)
    const centroid = centroidOfGeoJSON(f.geometry)
    if (!centroid) continue

    // Extract hail size / wind from parameters or description — tolerant of
    // shape changes (NWS occasionally ships scalars instead of arrays).
    let hailSize: number | undefined
    let windKmh: number | undefined
    const params = p.parameters || {}
    const rawHail = Array.isArray(params.maxHailSize) ? params.maxHailSize[0] : params.maxHailSize
    if (rawHail != null) {
      const n = parseFloat(String(rawHail))
      if (Number.isFinite(n) && n > 0 && n < 20) hailSize = n
    }
    const rawWind = Array.isArray(params.maxWindGust) ? params.maxWindGust[0] : params.maxWindGust
    if (rawWind != null) {
      const m = String(rawWind).match(/(\d+)/)
      if (m) {
        const mph = parseInt(m[1], 10)
        if (Number.isFinite(mph) && mph > 0 && mph < 400) windKmh = Math.round(mph * 1.609)
      }
    }

    out.push({
      id: `nws:${p.id || f.id || crypto.randomUUID()}`,
      source: 'nws',
      type,
      severity: classifyNWSSeverity(p.severity, eventStr),
      coordinates: centroid,
      polygon: poly,
      hailSizeInches: hailSize,
      windSpeedKmh: windKmh,
      timestamp: p.sent || p.effective || p.onset || new Date().toISOString(),
      expiresAt: p.expires || p.ends || undefined,
      description: p.description || p.headline || eventStr,
      headline: p.headline || eventStr
    })
    } catch (err) {
      console.warn('[storm-scout] NWS feature parse failed:', (err as any)?.message)
    }
  }
  return out
}

// ------------------------------------------------------------
// Local Storm Reports via Iowa Environmental Mesonet
// Free GeoJSON — no key. Docs: mesonet.agron.iastate.edu/GIS/apps/rview/
// ------------------------------------------------------------
export async function fetchIEMLocalStormReports(daysBack: number): Promise<HailReport[]> {
  const now = new Date()
  const start = new Date(now.getTime() - daysBack * 24 * 3600 * 1000)
  // IEM LSR endpoint accepts sts/ets (start/end) in UTC as YYYYMMDDHHMM
  const utc = (d: Date) => d.toISOString().replace(/[-:T]/g, '').slice(0, 12)
  const url = `https://mesonet.agron.iastate.edu/geojson/lsr.geojson?sts=${utc(start)}&ets=${utc(now)}`
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`IEM LSR HTTP ${res.status}`)
  const json: any = await res.json()
  const features: any[] = Array.isArray(json?.features) ? json.features : []

  const reports: HailReport[] = []
  for (const f of features) {
    try {
    const p = f.properties || {}
    const typeRaw: string = String(p.type || p.typetext || '').toLowerCase()
    let type: HailReport['type'] | null = null
    if (typeRaw.includes('hail')) type = 'hail'
    else if (typeRaw.includes('tornado')) type = 'tornado'
    else if (typeRaw.includes('wind') || typeRaw.includes('tstm wnd') || typeRaw.includes('gust')) type = 'wind'
    if (!type) continue

    const geom = f.geometry
    if (!geom || geom.type !== 'Point') continue
    const lng = geom.coordinates[0], lat = geom.coordinates[1]

    // Magnitude: for hail, in inches; for wind, in mph; for tornado, EF number.
    const mag = p.magnitude != null ? parseFloat(String(p.magnitude)) : NaN
    const sizeInches = type === 'hail' && !isNaN(mag) ? mag : 0

    // Skip tiny hail (< 0.5") — too small to cause roof damage
    if (type === 'hail' && sizeInches < 0.5) continue

    reports.push({
      id: `iem:${p.valid}_${lat}_${lng}_${type}`,
      lat, lng,
      sizeInches,
      timestamp: p.valid || new Date().toISOString(),
      source: 'iem',
      type,
      magnitude: !isNaN(mag) ? mag : undefined,
      remarks: p.remark || p.remarks,
      city: p.city,
      state: p.st || p.state
    })
    } catch (err) {
      console.warn('[storm-scout] IEM LSR parse failed:', (err as any)?.message)
    }
  }
  return reports
}
