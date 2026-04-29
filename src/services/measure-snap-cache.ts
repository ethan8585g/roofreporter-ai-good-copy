// ============================================================
// Measure snap-feature cache
// ============================================================
// Wraps the heavy DSM → RANSAC → edge-classifier → lat/lng projection
// pipeline behind Cloudflare's edge cache so repeat traces in the same
// neighborhood don't re-download the GeoTIFF.
//
// Cache key: rounded lat/lng (5 decimals = ~1.1m precision).
// Cache TTL: 14 days; the underlying Solar imagery rarely changes.
// ============================================================

import { downloadGeoTIFF, analyzeDSM, computeSlope, type GeoTiffData } from './solar-datalayers'
import { runEdgeClassifier, classifiedEdgesToLatLng, type SnapFeatures } from './edge-classifier'

interface SnapCacheEnv {
  GOOGLE_SOLAR_API_KEY?: string
  GOOGLE_MAPS_API_KEY?: string
}

const SNAP_CACHE_VERSION = 'v1'
const SNAP_CACHE_TTL_SECONDS = 14 * 24 * 60 * 60

function roundLatLng(value: number): string {
  return value.toFixed(5)
}

function buildCacheKey(lat: number, lng: number): Request {
  const url = `https://snap-cache.local/${SNAP_CACHE_VERSION}/${roundLatLng(lat)}/${roundLatLng(lng)}`
  return new Request(url, { method: 'GET' })
}

export async function getSnapFeatures(
  env: SnapCacheEnv,
  lat: number,
  lng: number,
): Promise<SnapFeatures | null> {
  if (!env.GOOGLE_SOLAR_API_KEY) return null

  const cache = (globalThis as any).caches?.default as Cache | undefined
  const cacheKey = buildCacheKey(lat, lng)

  if (cache) {
    try {
      const hit = await cache.match(cacheKey)
      if (hit) {
        const cached = (await hit.json()) as SnapFeatures
        return cached
      }
    } catch (err) {
      console.warn('[snap-cache] cache.match failed', (err as Error).message)
    }
  }

  const features = await computeSnapFeatures(env, lat, lng)
  if (!features) return null

  if (cache) {
    try {
      const body = JSON.stringify(features)
      const response = new Response(body, {
        headers: {
          'content-type': 'application/json',
          'cache-control': `public, max-age=${SNAP_CACHE_TTL_SECONDS}`,
        },
      })
      await cache.put(cacheKey, response)
    } catch (err) {
      console.warn('[snap-cache] cache.put failed', (err as Error).message)
    }
  }

  return features
}

async function computeSnapFeatures(
  env: SnapCacheEnv,
  lat: number,
  lng: number,
): Promise<SnapFeatures | null> {
  const apiKey = env.GOOGLE_SOLAR_API_KEY!

  let dataLayers: any
  try {
    const url = `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${lat}&location.longitude=${lng}&radiusMeters=50&view=FULL_LAYERS&requiredQuality=HIGH&key=${apiKey}`
    const res = await fetch(url)
    if (!res.ok) return null
    dataLayers = await res.json()
  } catch (err) {
    console.warn('[snap-cache] dataLayers fetch failed', (err as Error).message)
    return null
  }

  if (!dataLayers?.dsmUrl) return null

  let dsmGeoTiff: GeoTiffData
  try {
    dsmGeoTiff = await downloadGeoTIFF(dataLayers.dsmUrl, apiKey)
  } catch (err) {
    console.warn('[snap-cache] DSM download failed', (err as Error).message)
    return null
  }

  let maskGeoTiff: GeoTiffData | null = null
  if (dataLayers.maskUrl) {
    try {
      maskGeoTiff = await downloadGeoTIFF(dataLayers.maskUrl, apiKey)
    } catch {
      maskGeoTiff = null
    }
  }

  const dsm = analyzeDSM(dsmGeoTiff, maskGeoTiff)
  const slope = computeSlope(dsm)
  const classifier = runEdgeClassifier(dsm, slope)

  return classifiedEdgesToLatLng(
    classifier,
    dsmGeoTiff.pixelSizeMeters,
    dsmGeoTiff.width,
    dsmGeoTiff.height,
    dsmGeoTiff.bounds,
  )
}
