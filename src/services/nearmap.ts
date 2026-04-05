// ============================================================
// Roof Manager — Nearmap Imagery Integration
// ============================================================
// Provides 7.5cm/pixel (GSD) aerial imagery from Nearmap's
// tile API for roof reports. Significantly higher resolution
// than Google Maps Static API tiles (~8.9cm/px at zoom 20).
//
// Nearmap covers major metros in US, Canada, Australia, and NZ.
// For Alberta: Edmonton and Calgary metro areas are covered.
//
// API Reference: https://developer.nearmap.com/docs/tile-api
// Auth: ?apikey=YOUR_KEY or Authorization: Apikey YOUR_KEY
//
// Tile scheme: Standard XYZ (Google/OSM slippy tiles)
//   URL: https://api.nearmap.com/tiles/v3/Vert/{z}/{x}/{y}.jpg?apikey=KEY
//   Panorama (oblique): /tiles/v3/North|South|East|West/{z}/{x}/{y}.jpg
//
// Coverage API: https://developer.nearmap.com/docs/coverage-api
//   Point check: /coverage/v2/point/{lng},{lat}
//   Returns: survey dates, content types, resolution
// ============================================================

const NEARMAP_TILE_BASE = 'https://api.nearmap.com/tiles/v3'
const NEARMAP_COVERAGE_BASE = 'https://api.nearmap.com/coverage/v2'

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export interface NearmapCoverage {
  hasCoverage: boolean
  latestSurveyDate?: string     // YYYY-MM-DD
  latestSurveyId?: string
  surveyCount?: number
  contentTypes?: string[]       // e.g. ['Vert', 'North', 'South', 'East', 'West']
  gsd_meters?: number
}

export interface NearmapImagerySet {
  provider: 'nearmap'
  gsd_meters: number
  latestSurveyDate?: string

  // Primary overhead (vertical)
  satellite_url: string
  satellite_overhead_url: string
  satellite_medium_url: string
  satellite_context_url: string

  // Oblique/panorama directional views (if available)
  north_url: string | null
  south_url: string | null
  east_url: string | null
  west_url: string | null

  // Close-up quadrants (tighter zoom on roof corners)
  closeup_nw_url: string | null
  closeup_ne_url: string | null
  closeup_sw_url: string | null
  closeup_se_url: string | null

  // Street view placeholder (Nearmap doesn't have street view — use Google)
  street_view_url: string | null

  // Medium-zoom bridge view
  satellite_medium_url_extra?: string
}

// ============================================================
// TILE COORDINATE MATH
// ============================================================

/** Convert lat/lng to XYZ tile coordinates at a given zoom level */
function latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom)
  const x = Math.floor((lng + 180) / 360 * n)
  const latRad = lat * Math.PI / 180
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n)
  return { x, y }
}

/** Convert XYZ tile back to lat/lng (top-left corner of tile) */
function tileToLatLng(x: number, y: number, zoom: number): { lat: number; lng: number } {
  const n = Math.pow(2, zoom)
  const lng = x / n * 360 - 180
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)))
  const lat = latRad * 180 / Math.PI
  return { lat, lng }
}

// ============================================================
// COVERAGE CHECK — Verify Nearmap has imagery for a location
// ============================================================
// Uses the Coverage API point endpoint (free/low-cost).
// Returns survey metadata including latest capture date.
// ============================================================
export async function checkNearmapCoverage(
  lat: number,
  lng: number,
  apiKey: string,
  options?: { timeoutMs?: number }
): Promise<NearmapCoverage> {
  const timeout = options?.timeoutMs || 6000
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    // Coverage API uses lng,lat order (not lat,lng!)
    const url = `${NEARMAP_COVERAGE_BASE}/point/${lng},${lat}?apikey=${apiKey}&limit=5&fields=captureDate,id,resources`
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timeoutId)

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        console.warn(`[Nearmap] Auth failed (${response.status}) — check API key`)
        return { hasCoverage: false }
      }
      console.warn(`[Nearmap] Coverage API ${response.status}`)
      return { hasCoverage: false }
    }

    const data = await response.json() as any
    const surveys = data?.surveys || []

    if (surveys.length === 0) {
      return { hasCoverage: false }
    }

    const latest = surveys[0]
    const contentTypes = latest.resources?.map((r: any) => r.type) || []

    return {
      hasCoverage: true,
      latestSurveyDate: latest.captureDate,
      latestSurveyId: latest.id,
      surveyCount: surveys.length,
      contentTypes,
      gsd_meters: 0.075,
    }
  } catch (e: any) {
    clearTimeout(timeoutId)
    if (e.name === 'AbortError') {
      console.warn(`[Nearmap] Coverage check timed out (${timeout}ms)`)
    } else {
      console.warn(`[Nearmap] Coverage check error: ${e.message}`)
    }
    return { hasCoverage: false }
  }
}

// ============================================================
// GENERATE NEARMAP IMAGERY URLS
// ============================================================
// Builds tile URLs for all imagery views (overhead, directional,
// quadrant close-ups). Uses the same URL structure as
// generateEnhancedImagery() in solar-api.ts.
//
// Key differences from Google Maps Static:
//   - Nearmap tiles are always 256x256px (no scale parameter)
//   - Higher GSD (7.5cm vs ~8.9cm at zoom 20)
//   - No size/scale params — use higher zoom for more detail
//   - Supports oblique/panorama views (North/South/East/West)
//   - Uses survey-specific endpoints for date control
// ============================================================
export function generateNearmapImagery(
  lat: number,
  lng: number,
  apiKey: string,
  footprintSqft: number = 1500,
  options?: {
    surveyId?: string        // Specific survey date (from coverage API)
    hasObliques?: boolean    // Whether oblique views are available
  }
): NearmapImagerySet {
  const footprintM2 = footprintSqft / 10.7639

  // Zoom levels — Nearmap supports up to zoom 23
  // Nearmap tiles are 256px, so zoom 21 ≈ ~8m across per tile
  // For residential roofs, zoom 21 is ideal (similar to Google zoom 20 at scale=2)
  const roofZoom = footprintM2 > 2000 ? 19
    : footprintM2 > 800 ? 20
    : footprintM2 > 100 ? 21
    : 21
  const mediumZoom = roofZoom - 1
  const contextZoom = roofZoom - 3
  const closeupZoom = Math.min(roofZoom + 1, 23)

  // Build tile URL helper
  const tileUrl = (tLat: number, tLng: number, zoom: number, contentType: string = 'Vert'): string => {
    const { x, y } = latLngToTile(tLat, tLng, zoom)
    if (options?.surveyId) {
      return `${NEARMAP_TILE_BASE}/surveys/${options.surveyId}/${contentType}/${zoom}/${x}/${y}.jpg?apikey=${apiKey}`
    }
    return `${NEARMAP_TILE_BASE}/${contentType}/${zoom}/${x}/${y}.jpg?apikey=${apiKey}`
  }

  // Quadrant offsets (same logic as solar-api.ts)
  const latDegPerMeter = 1 / 111320
  const lngDegPerMeter = 1 / (111320 * Math.cos(lat * Math.PI / 180))
  const roofSideMeters = Math.sqrt(footprintM2)
  const halfSide = roofSideMeters / 2
  const quadOffsetMeters = Math.max(2, Math.min(halfSide * 0.25, 6))
  const quadLat = quadOffsetMeters * latDegPerMeter
  const quadLng = quadOffsetMeters * lngDegPerMeter

  // Directional offset for oblique views
  const dirOffsetMeters = 8
  const offsetLat = dirOffsetMeters * latDegPerMeter
  const offsetLng = dirOffsetMeters * lngDegPerMeter

  const hasObliques = options?.hasObliques || false

  return {
    provider: 'nearmap',
    gsd_meters: 0.075,
    latestSurveyDate: undefined,

    // Primary overhead
    satellite_url: tileUrl(lat, lng, roofZoom),
    satellite_overhead_url: tileUrl(lat, lng, roofZoom),
    satellite_medium_url: tileUrl(lat, lng, mediumZoom),
    satellite_context_url: tileUrl(lat, lng, contextZoom),

    // Oblique directional views (Nearmap-specific — not available from Google Static Maps)
    // These show the building from each compass direction at an angle
    north_url: hasObliques ? tileUrl(lat, lng, roofZoom, 'North') : null,
    south_url: hasObliques ? tileUrl(lat, lng, roofZoom, 'South') : null,
    east_url: hasObliques ? tileUrl(lat, lng, roofZoom, 'East') : null,
    west_url: hasObliques ? tileUrl(lat, lng, roofZoom, 'West') : null,

    // Close-up quadrants (tight zoom at roof corners)
    closeup_nw_url: tileUrl(lat + quadLat, lng - quadLng, closeupZoom),
    closeup_ne_url: tileUrl(lat + quadLat, lng + quadLng, closeupZoom),
    closeup_sw_url: tileUrl(lat - quadLat, lng - quadLng, closeupZoom),
    closeup_se_url: tileUrl(lat - quadLat, lng + quadLng, closeupZoom),

    // Street view — Nearmap doesn't offer this; leave null (Google fallback)
    street_view_url: null,
  }
}

// ============================================================
// FETCH NEARMAP IMAGERY FOR REPORT — Full workflow
// ============================================================
// 1. Check coverage (is Nearmap available for this address?)
// 2. If yes → generate all imagery URLs
// 3. If no → return null (caller falls back to Google)
//
// This is the main entry point for the report pipeline.
// ============================================================
export async function fetchNearmapImageryForReport(
  lat: number,
  lng: number,
  apiKey: string,
  footprintSqft: number = 1500,
  options?: { timeoutMs?: number }
): Promise<{ imagery: NearmapImagerySet; coverage: NearmapCoverage } | null> {
  console.log(`[Nearmap] Checking coverage at ${lat.toFixed(5)}, ${lng.toFixed(5)}`)

  const coverage = await checkNearmapCoverage(lat, lng, apiKey, { timeoutMs: options?.timeoutMs || 5000 })

  if (!coverage.hasCoverage) {
    console.log(`[Nearmap] No coverage at this location — falling back to Google`)
    return null
  }

  console.log(`[Nearmap] Coverage found: ${coverage.surveyCount} surveys, latest: ${coverage.latestSurveyDate}, types: ${coverage.contentTypes?.join(', ')}`)

  const hasObliques = coverage.contentTypes?.some(t =>
    ['North', 'South', 'East', 'West'].includes(t)
  ) || false

  const imagery = generateNearmapImagery(lat, lng, apiKey, footprintSqft, {
    surveyId: coverage.latestSurveyId,
    hasObliques,
  })

  imagery.latestSurveyDate = coverage.latestSurveyDate

  return { imagery, coverage }
}
