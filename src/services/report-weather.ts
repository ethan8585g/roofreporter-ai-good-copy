// ============================================================
// Weather-risk lookups for the Pro-tier report.
// ============================================================
// Wraps fetchIEMLocalStormReports() with:
//   - Cloudflare edge cache (caches.default), keyed by rounded lat/lng + window
//   - Exponential backoff on transient failures (NWS/IEM endpoints are flaky)
//   - Distance-windowed scoring so a single hailstorm 200 km away doesn't
//     spike the homeowner's roof risk score
// ============================================================

import type { WeatherRisk } from '../types'
import { fetchIEMLocalStormReports } from './nws-data'

const SAMPLE_RADIUS_KM = 25
const SAMPLE_WINDOW_DAYS = 1825 // 5 years
const CACHE_VERSION = 'v1'
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60

function roundCoord(v: number): string {
  return v.toFixed(2) // ~1km precision is plenty for risk scoring
}

function buildCacheKey(lat: number, lng: number): Request {
  const url = `https://weather-risk-cache.local/${CACHE_VERSION}/${roundCoord(lat)}/${roundCoord(lng)}/${SAMPLE_WINDOW_DAYS}d`
  return new Request(url, { method: 'GET' })
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const sa = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(sa))
}

async function fetchWithBackoff<T>(fn: () => Promise<T>, label: string, maxAttempts = 3): Promise<T> {
  let lastErr: any
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      lastErr = err
      if (attempt === maxAttempts) break
      // Exponential backoff: 400ms, 1200ms, then give up. NWS errors are usually
      // transient bursts, so a tight retry tends to recover before the user notices.
      const delayMs = 400 * Math.pow(3, attempt - 1)
      console.warn(`[report-weather] ${label} attempt ${attempt} failed (${err?.message}); retrying in ${delayMs}ms`)
      await new Promise(r => setTimeout(r, delayMs))
    }
  }
  throw lastErr
}

function scoreEvents(reports: { lat: number; lng: number; sizeInches: number; magnitude?: number; timestamp: string; type: string }[],
                     center: { lat: number; lng: number }) {
  const now = Date.now()
  const radiusKm = SAMPLE_RADIUS_KM
  let hailScore = 0, windScore = 0
  let hailCount = 0, windCount = 0
  let largestHailIn = 0, peakWindKmh = 0
  let lastEventAt: string | null = null

  for (const ev of reports) {
    const d = haversineKm(center, ev)
    if (d > radiusKm) continue

    const ageDays = (now - new Date(ev.timestamp).getTime()) / (1000 * 60 * 60 * 24)
    if (!Number.isFinite(ageDays) || ageDays < 0 || ageDays > SAMPLE_WINDOW_DAYS) continue

    // Decay: full weight for last year, halves every additional 365 days.
    const recency = 1 / Math.pow(2, Math.max(0, (ageDays - 365) / 365))
    // Distance falloff: linear from 1.0 at center to 0.2 at radius edge.
    const proximity = 1 - 0.8 * (d / radiusKm)

    if (ev.type === 'hail') {
      // Severity weight: 0.25" → 1, 1.0" → 4, 2.0" → 9 (≈ size² scaling).
      const sev = Math.min(20, Math.max(1, Math.pow(ev.sizeInches * 4, 1.6)))
      hailScore += sev * recency * proximity
      hailCount += 1
      if (ev.sizeInches > largestHailIn) largestHailIn = ev.sizeInches
    } else if (ev.type === 'wind') {
      const mag = Number(ev.magnitude || 0)
      const sev = Math.min(15, Math.max(1, (mag - 40) / 5))
      windScore += sev * recency * proximity
      windCount += 1
      const kmh = Math.round(mag * 1.609)
      if (kmh > peakWindKmh) peakWindKmh = kmh
    }

    if (!lastEventAt || ev.timestamp > lastEventAt) lastEventAt = ev.timestamp
  }

  return {
    hail_score: Math.min(100, Math.round(hailScore * 5)),
    wind_score: Math.min(100, Math.round(windScore * 6)),
    hail_event_count: hailCount,
    wind_event_count: windCount,
    largest_hail_inches: Math.round(largestHailIn * 100) / 100,
    peak_wind_kmh: peakWindKmh,
    last_event_at: lastEventAt,
  }
}

/**
 * Compute hail/wind exposure for a property. Cached at the edge for a week so
 * regenerating the same report doesn't re-hammer the NWS endpoints.
 */
export async function getWeatherRiskForLocation(lat: number, lng: number): Promise<WeatherRisk | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  const cache = (globalThis as any).caches?.default as Cache | undefined
  const cacheKey = buildCacheKey(lat, lng)

  if (cache) {
    try {
      const hit = await cache.match(cacheKey)
      if (hit) return (await hit.json()) as WeatherRisk
    } catch (err) {
      console.warn('[report-weather] cache.match failed:', (err as Error).message)
    }
  }

  let events: any[] = []
  try {
    events = await fetchWithBackoff(() => fetchIEMLocalStormReports(SAMPLE_WINDOW_DAYS), 'IEM LSR')
  } catch (err: any) {
    console.warn('[report-weather] IEM lookup failed after retries:', err?.message)
    return null
  }

  const scored = scoreEvents(events, { lat, lng })
  const risk: WeatherRisk = {
    ...scored,
    sample_radius_km: SAMPLE_RADIUS_KM,
    sample_window_days: SAMPLE_WINDOW_DAYS,
    computed_at: new Date().toISOString(),
  }

  if (cache) {
    try {
      const body = JSON.stringify(risk)
      const response = new Response(body, {
        headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${CACHE_TTL_SECONDS}` },
      })
      await cache.put(cacheKey, response)
    } catch (err) {
      console.warn('[report-weather] cache.put failed:', (err as Error).message)
    }
  }

  return risk
}
