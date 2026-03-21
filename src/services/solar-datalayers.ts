// ============================================================
// RoofReporterAI - Solar DataLayers Engine v1.0
// ============================================================
// Enhanced roof measurement using Google Solar API DataLayers:
//   1. Geocode address → lat/lng
//   2. Call dataLayers:get → DSM, mask, RGB GeoTIFF URLs
//   3. Download & parse GeoTIFFs using geotiff.js (pure JS, Workers-compatible)
//   4. Extract roof height map from DSM + mask
//   5. Compute slope/pitch via gradient analysis
//   6. Calculate flat area, true 3D area, waste factor, pitch multiplier
//
// This is the TypeScript/Cloudflare Workers port of the Python
// execute_roof_order() template from the roofing_analysis_engine.py
//
// Key formulas from the Python template:
//   - flat_area = np.count_nonzero(~np.isnan(height_map)) * pixel_area_m2
//   - slope = gradient(height_map) → pitch_deg = degrees(arctan(slope))
//   - true_area = flat_area / cos(radians(pitch_deg))
//   - waste_factor = 1.15 if area > 2000 sqft else 1.05
//   - pitch_multiplier = sqrt(1 + (pitch_deg/45)^2)
//   - squares = (true_area * waste_factor * pitch_multiplier) / 100
// ============================================================

import * as geotiff from 'geotiff'
import { fetchNearmapImageryForReport } from './nearmap'

// ============================================================
// CONSTANTS
// ============================================================
const SQFT_PER_SQM = 10.7639
const SOLAR_DATALAYERS_URL = 'https://solar.googleapis.com/v1/dataLayers:get'
const GEOCODING_URL = 'https://maps.googleapis.com/maps/api/geocode/json'

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export interface DataLayersResponse {
  imageryDate: { year: number; month: number; day: number }
  imageryProcessedDate: { year: number; month: number; day: number }
  dsmUrl: string
  rgbUrl: string
  maskUrl: string
  annualFluxUrl: string
  monthlyFluxUrl: string
  hourlyShadeUrls: string[]
  imageryQuality: 'HIGH' | 'MEDIUM' | 'BASE'
}

export interface GeoTiffData {
  width: number
  height: number
  rasters: number[][]
  bounds: {
    north: number
    south: number
    east: number
    west: number
  }
  pixelSizeMeters: number
}

export interface DSMAnalysis {
  heightMap: Float64Array
  width: number
  height: number
  validPixelCount: number
  pixelSizeMeters: number
  minHeight: number
  maxHeight: number
  meanHeight: number
}

export interface SlopeAnalysis {
  slopeMap: Float64Array
  pitchMap: Float64Array   // degrees
  avgSlopeDeg: number
  maxSlopeDeg: number
  medianSlopeDeg: number
  weightedAvgPitchDeg: number
}

export interface RoofAreaCalculation {
  // From DSM + mask
  flatAreaM2: number
  flatAreaSqft: number
  // Pitch-adjusted (true 3D surface area)
  trueAreaM2: number
  trueAreaSqft: number
  // Area multiplier (true/flat)
  areaMultiplier: number
  // Pitch
  avgPitchDeg: number
  pitchRatio: string   // "X:12" format
  // Waste & multipliers
  wasteFactor: number
  pitchMultiplier: number
  // Final material area
  materialAreaSqft: number
  materialSquares: number
}

export interface FluxAnalysis {
  /** Mean annual solar flux across roof pixels (kWh/m²/year) */
  meanFluxKwhM2: number
  /** Maximum annual solar flux pixel (kWh/m²/year) */
  maxFluxKwhM2: number
  /** Minimum annual solar flux pixel (kWh/m²/year) */
  minFluxKwhM2: number
  /** Total annual energy across entire roof (kWh/year) */
  totalAnnualKwh: number
  /** Number of valid flux pixels analyzed */
  validPixels: number
  /** Percentage of roof receiving >1000 kWh/m²/year ("high sun" zones) */
  highSunPct: number
  /** Percentage of roof receiving <600 kWh/m²/year ("shaded" zones) */
  shadedPct: number
  /** Equivalent peak sun hours per day (meanFlux / 365) */
  peakSunHoursPerDay: number
  /** Base64 data URL of the flux heatmap visualization */
  fluxHeatmapDataUrl: string
}

export interface DataLayersAnalysis {
  // Geocoded location
  latitude: number
  longitude: number
  formattedAddress: string
  // Imagery info
  imageryDate: string
  imageryQuality: string
  // Area calculations
  area: RoofAreaCalculation
  // Slope analysis
  slope: SlopeAnalysis
  // DSM stats
  dsm: {
    minHeight: number
    maxHeight: number
    meanHeight: number
    validPixels: number
    pixelSizeMeters: number
  }
  // Annual flux / solar exposure analysis
  flux: FluxAnalysis | null
  // Image URLs (for report display)
  dsmUrl: string
  maskUrl: string
  rgbUrl: string
  annualFluxUrl: string
  /** Base64 data URL of the Solar API's aerial RGB image (0.1-0.5m/pixel resolution) */
  rgbAerialDataUrl: string
  /** Base64 data URL of the mask overlay visualization (roof highlighted in blue) */
  maskOverlayDataUrl: string
  satelliteUrl: string
  /** High-res overhead satellite URL (640x640 square, optimal zoom for roof measurement) */
  satelliteOverheadUrl: string
  /** Wider context satellite URL (zoom-3, 640x640) */
  satelliteContextUrl: string
  /** Medium-zoom bridge view (zoom-1, 640x640) */
  satelliteMediumUrl: string
  // Performance
  durationMs: number
  provider: string
}

// ============================================================
// GEOCODING — Address → Lat/Lng
// ============================================================
export async function geocodeAddress(
  address: string,
  apiKey: string
): Promise<{ lat: number; lng: number; formattedAddress: string } | null> {
  try {
    const params = new URLSearchParams({
      address: address,
      key: apiKey
    })
    const response = await fetch(`${GEOCODING_URL}?${params}`)
    const data: any = await response.json()

    if (data.status === 'OK' && data.results?.length > 0) {
      const result = data.results[0]
      return {
        lat: result.geometry.location.lat,
        lng: result.geometry.location.lng,
        formattedAddress: result.formatted_address
      }
    }
    console.warn(`[Geocode] Failed for '${address}': ${data.status}`)
    return null
  } catch (e: any) {
    console.error(`[Geocode] Error: ${e.message}`)
    return null
  }
}

// ============================================================
// SOLAR DATALAYERS API — Get GeoTIFF URLs
// ============================================================
export async function getDataLayerUrls(
  lat: number,
  lng: number,
  apiKey: string,
  radiusMeters: number = 50
): Promise<DataLayersResponse> {
  const params = new URLSearchParams({
    'location.latitude': lat.toFixed(5),
    'location.longitude': lng.toFixed(5),
    radiusMeters: radiusMeters.toString(),
    view: 'FULL_LAYERS',
    requiredQuality: 'HIGH',
    pixelSizeMeters: '0.5',  // 0.5m/pixel (reduces memory by 25x vs 0.1m/pixel)
    key: apiKey
  })

  console.log(`[DataLayers] Requesting: lat=${lat}, lng=${lng}, radius=${radiusMeters}m`)
  const response = await fetch(`${SOLAR_DATALAYERS_URL}?${params}`)

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Solar DataLayers API error ${response.status}: ${errText}`)
  }

  const data = await response.json() as DataLayersResponse
  console.log(`[DataLayers] Received: quality=${data.imageryQuality}, DSM=${!!data.dsmUrl}, mask=${!!data.maskUrl}`)
  return data
}

// ============================================================
// GEOTIFF DOWNLOAD & PARSE — Pure JS (Cloudflare Workers compatible)
// ============================================================
export async function downloadGeoTIFF(
  url: string,
  apiKey: string
): Promise<GeoTiffData> {
  // Append API key to Solar API URLs
  const fetchUrl = url.includes('solar.googleapis.com')
    ? `${url}&key=${apiKey}`
    : url

  console.log(`[GeoTIFF] Downloading: ${url.substring(0, 80)}...`)
  const response = await fetch(fetchUrl)

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`GeoTIFF download failed (${response.status}): ${errText.substring(0, 200)}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  console.log(`[GeoTIFF] Downloaded ${(arrayBuffer.byteLength / 1024).toFixed(1)} KB`)

  // Parse with geotiff.js
  const tiff = await geotiff.fromArrayBuffer(arrayBuffer)
  const image = await tiff.getImage()
  const rasters = await image.readRasters()

  // Extract bounding box from GeoTIFF metadata
  const bbox = image.getBoundingBox()
  const fileDir = image.getFileDirectory()
  const width = image.getWidth()
  const height = image.getHeight()

  // Calculate pixel size from image dimensions and bounding box
  // The bbox is in the projection's CRS (often meters for UTM)
  const pixelWidth = (bbox[2] - bbox[0]) / width
  const pixelHeight = (bbox[3] - bbox[1]) / height
  const pixelSizeMeters = Math.abs(pixelWidth) // Approximate; assumes metric CRS

  // Convert rasters to plain arrays
  const rasterArrays: number[][] = []
  for (let i = 0; i < rasters.length; i++) {
    rasterArrays.push(Array.from(rasters[i] as any))
  }

  // For bounding box, try to get lat/lng
  // The GeoTIFF may be in UTM or another projection
  // We use a simplified bounding box here — the exact projection
  // transform would need proj4, but for area calculation we use
  // the pixel size directly from the image resolution
  const bounds = {
    north: bbox[3],
    south: bbox[1],
    east: bbox[2],
    west: bbox[0]
  }

  return {
    width,
    height,
    rasters: rasterArrays,
    bounds,
    pixelSizeMeters
  }
}

// ============================================================
// RGB GEOTIFF → BASE64 PNG — Convert Solar API aerial imagery
// to an embeddable data URL for high-res roof report images.
//
// The Solar API rgbUrl returns a 3-band (R, G, B) GeoTIFF
// at 0.1m/pixel (HIGH) or 0.25m/pixel (MEDIUM/BASE).
// This is actual aerial photography — far superior to Google
// Static Maps satellite tiles which are just web map tiles.
//
// We convert to BMP format (simple, no compression library needed)
// and then base64 encode for embedding in HTML reports.
// ============================================================
async function convertRgbGeoTiffToDataUrl(
  rgbUrl: string,
  apiKey: string
): Promise<string> {
  const fetchUrl = rgbUrl.includes('solar.googleapis.com')
    ? `${rgbUrl}&key=${apiKey}`
    : rgbUrl

  const response = await fetch(fetchUrl)
  if (!response.ok) {
    throw new Error(`RGB GeoTIFF download failed (${response.status})`)
  }

  const arrayBuffer = await response.arrayBuffer()
  console.log(`[RGB] Downloaded ${(arrayBuffer.byteLength / 1024).toFixed(1)} KB`)

  const tiff = await geotiff.fromArrayBuffer(arrayBuffer)
  const image = await tiff.getImage()
  const rasters = await image.readRasters()
  const width = image.getWidth()
  const height = image.getHeight()

  console.log(`[RGB] Image: ${width}x${height}, ${rasters.length} bands`)

  // Guard: skip conversion if image is too large (> 800x800 pixels)
  // This prevents memory issues in Cloudflare Workers
  if (width > 800 || height > 800) {
    console.warn(`[RGB] Image too large for data URL embedding (${width}x${height}), skipping`)
    return ''
  }

  if (rasters.length < 3) {
    throw new Error(`RGB GeoTIFF has only ${rasters.length} bands, expected 3+`)
  }

  const r = rasters[0] as any
  const g = rasters[1] as any
  const b = rasters[2] as any

  // Build BMP file in memory (uncompressed 24-bit bitmap)
  // BMP is simple to construct without any encoding library
  const rowSize = Math.ceil(width * 3 / 4) * 4  // rows must be padded to 4 bytes
  const pixelDataSize = rowSize * height
  const fileSize = 54 + pixelDataSize  // 14 byte header + 40 byte info header + pixel data

  const bmp = new Uint8Array(fileSize)
  const view = new DataView(bmp.buffer)

  // BMP File Header (14 bytes)
  bmp[0] = 0x42; bmp[1] = 0x4D  // 'BM'
  view.setUint32(2, fileSize, true)
  view.setUint32(10, 54, true)  // pixel data offset

  // BMP Info Header (40 bytes)
  view.setUint32(14, 40, true)  // header size
  view.setInt32(18, width, true)
  view.setInt32(22, height, true)
  view.setUint16(26, 1, true)   // planes
  view.setUint16(28, 24, true)  // bits per pixel
  view.setUint32(34, pixelDataSize, true)

  // Pixel data (BMP is bottom-up, BGR order)
  for (let y = 0; y < height; y++) {
    const bmpRow = height - 1 - y  // BMP rows are bottom-to-top
    for (let x = 0; x < width; x++) {
      const srcIdx = y * width + x
      const dstIdx = 54 + bmpRow * rowSize + x * 3
      // Clamp values to 0-255 (GeoTIFF might have values outside range)
      bmp[dstIdx]     = Math.max(0, Math.min(255, Math.round(b[srcIdx])))  // Blue
      bmp[dstIdx + 1] = Math.max(0, Math.min(255, Math.round(g[srcIdx])))  // Green
      bmp[dstIdx + 2] = Math.max(0, Math.min(255, Math.round(r[srcIdx])))  // Red
    }
  }

  // Convert to base64 data URL
  // Cloudflare Workers supports btoa() for base64 encoding
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bmp.length; i += chunkSize) {
    const chunk = bmp.subarray(i, Math.min(i + chunkSize, bmp.length))
    binary += String.fromCharCode(...chunk)
  }

  const base64 = btoa(binary)
  const dataUrl = `data:image/bmp;base64,${base64}`

  console.log(`[RGB] Converted to BMP data URL: ${width}x${height}, ${(dataUrl.length / 1024).toFixed(0)} KB`)
  return dataUrl
}

// ============================================================
// DSM ANALYSIS — Extract roof height map
// The mask GeoTIFF indicates which pixels belong to buildings.
// If mask has different dimensions from DSM, resample using
// nearest-neighbor interpolation.
// ============================================================
export function analyzeDSM(
  dsmData: GeoTiffData,
  maskData: GeoTiffData | null
): DSMAnalysis {
  const dsm = dsmData.rasters[0] // First band is the elevation data
  const width = dsmData.width
  const height = dsmData.height

  // Build resampled mask if dimensions differ
  let mask: number[] | null = null
  if (maskData && maskData.rasters[0]) {
    const rawMask = maskData.rasters[0]
    if (maskData.width === width && maskData.height === height) {
      // Same dimensions — use directly
      mask = rawMask
    } else {
      // Different dimensions — resample mask to DSM dimensions
      // using nearest-neighbor interpolation
      console.log(`[DSM] Resampling mask ${maskData.width}x${maskData.height} → ${width}x${height}`)
      mask = new Array(width * height)
      const xRatio = maskData.width / width
      const yRatio = maskData.height / height
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const srcX = Math.min(Math.floor(x * xRatio), maskData.width - 1)
          const srcY = Math.min(Math.floor(y * yRatio), maskData.height - 1)
          mask[y * width + x] = rawMask[srcY * maskData.width + srcX]
        }
      }
    }
  }

  // Build height map — only keep pixels where mask indicates building/roof
  const heightMap = new Float64Array(width * height)
  let validCount = 0
  let minH = Infinity
  let maxH = -Infinity
  let sumH = 0

  // First pass: compute height statistics to identify the "roof zone"
  // The DSM includes ground and buildings. We need to filter to just roofs.
  const allHeights: number[] = []
  for (let i = 0; i < dsm.length; i++) {
    const h = dsm[i]
    if (!isNaN(h) && isFinite(h) && h > 0) {
      allHeights.push(h)
    }
  }

  // If mask exists, use it; otherwise use height-based filtering
  // to identify elevated pixels (buildings vs ground)
  let groundLevel = 0
  let roofThreshold = 0
  if (!mask && allHeights.length > 0) {
    // No mask: estimate ground level from height distribution
    allHeights.sort((a, b) => a - b)
    groundLevel = allHeights[Math.floor(allHeights.length * 0.1)] // 10th percentile ≈ ground
    const heightRange = allHeights[allHeights.length - 1] - groundLevel
    roofThreshold = groundLevel + Math.max(2.5, heightRange * 0.3) // At least 2.5m above ground
    console.log(`[DSM] No mask: ground=${groundLevel.toFixed(1)}m, roof threshold=${roofThreshold.toFixed(1)}m`)
  }

  for (let i = 0; i < dsm.length; i++) {
    const h = dsm[i]
    if (isNaN(h) || !isFinite(h) || h <= 0) {
      heightMap[i] = NaN
      continue
    }

    let isRoof: boolean
    if (mask) {
      // Mask value > 0 means building/roof pixel
      isRoof = mask[i] > 0
    } else {
      // Height-based: pixel is roof if above ground + threshold
      isRoof = h > roofThreshold
    }

    if (isRoof) {
      heightMap[i] = h
      validCount++
      if (h < minH) minH = h
      if (h > maxH) maxH = h
      sumH += h
    } else {
      heightMap[i] = NaN
    }
  }

  const meanH = validCount > 0 ? sumH / validCount : 0

  console.log(`[DSM] Analyzed: ${validCount} valid roof pixels out of ${width * height} total, height ${minH.toFixed(1)}-${maxH.toFixed(1)}m, mean ${meanH.toFixed(1)}m`)

  return {
    heightMap,
    width,
    height,
    validPixelCount: validCount,
    pixelSizeMeters: dsmData.pixelSizeMeters,
    minHeight: minH === Infinity ? 0 : minH,
    maxHeight: maxH === -Infinity ? 0 : maxH,
    meanHeight: meanH
  }
}

// ============================================================
// SLOPE/PITCH CALCULATION — Gradient analysis on height map
// Port of: slope = gradient(height_map)
//          pitch_deg = degrees(arctan(slope))
// ============================================================
export function computeSlope(dsm: DSMAnalysis): SlopeAnalysis {
  const { heightMap, width, height, pixelSizeMeters } = dsm
  const slopeMap = new Float64Array(width * height)
  const pitchMap = new Float64Array(width * height)

  let slopeSum = 0
  let slopeCount = 0
  let maxSlope = 0
  const validSlopes: number[] = []

  // Compute gradient (Sobel-like finite differences)
  // For each pixel, compute dz/dx and dz/dy, then magnitude
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x
      const h = heightMap[idx]
      if (isNaN(h)) continue

      // Get neighbor heights
      const hN = heightMap[(y - 1) * width + x]
      const hS = heightMap[(y + 1) * width + x]
      const hW = heightMap[y * width + (x - 1)]
      const hE = heightMap[y * width + (x + 1)]

      // Skip if any neighbor is invalid
      if (isNaN(hN) || isNaN(hS) || isNaN(hW) || isNaN(hE)) continue

      // Central difference gradient
      const dzdx = (hE - hW) / (2 * pixelSizeMeters)
      const dzdy = (hS - hN) / (2 * pixelSizeMeters)

      // Slope magnitude
      const slopeMag = Math.sqrt(dzdx * dzdx + dzdy * dzdy)
      const pitchDeg = Math.atan(slopeMag) * (180 / Math.PI)

      slopeMap[idx] = slopeMag
      pitchMap[idx] = pitchDeg

      slopeSum += pitchDeg
      slopeCount++
      if (pitchDeg > maxSlope) maxSlope = pitchDeg
      validSlopes.push(pitchDeg)
    }
  }

  const avgSlope = slopeCount > 0 ? slopeSum / slopeCount : 0

  // Median slope
  validSlopes.sort((a, b) => a - b)
  const medianSlope = validSlopes.length > 0
    ? validSlopes[Math.floor(validSlopes.length / 2)]
    : 0

  // Weighted average pitch — weighted by how many pixels share that slope
  // This gives more weight to larger facets
  const weightedAvgPitch = avgSlope // For now, use arithmetic mean

  console.log(`[Slope] Analyzed ${slopeCount} pixels: avg=${avgSlope.toFixed(1)}°, median=${medianSlope.toFixed(1)}°, max=${maxSlope.toFixed(1)}°`)

  return {
    slopeMap,
    pitchMap,
    avgSlopeDeg: Math.round(avgSlope * 10) / 10,
    maxSlopeDeg: Math.round(maxSlope * 10) / 10,
    medianSlopeDeg: Math.round(medianSlope * 10) / 10,
    weightedAvgPitchDeg: Math.round(avgSlope * 10) / 10
  }
}

// ============================================================
// AREA CALCULATION — Flat area, true area, waste, pitch multiplier
// Port of execute_roof_order() formulas:
//   flat_area_m2 = valid_pixel_count * pixel_area_m2
//   true_area = flat_area / cos(radians(pitch_deg))
//   waste_factor = 1.15 if area > 2000 sqft else 1.05
//   pitch_multiplier = sqrt(1 + (pitch_deg/45)^2)
// ============================================================
export function calculateRoofArea(
  dsm: DSMAnalysis,
  slope: SlopeAnalysis
): RoofAreaCalculation {
  // Pixel area in square meters
  const pixelAreaM2 = dsm.pixelSizeMeters * dsm.pixelSizeMeters

  // Flat roof area = number of valid (non-NaN) pixels * pixel area
  const flatAreaM2 = dsm.validPixelCount * pixelAreaM2
  const flatAreaSqft = flatAreaM2 * SQFT_PER_SQM

  // Average pitch from gradient analysis
  const avgPitchDeg = slope.weightedAvgPitchDeg

  // True 3D surface area = flat_area / cos(pitch_rad)
  const pitchRad = avgPitchDeg * (Math.PI / 180)
  const cosP = Math.cos(pitchRad)
  const trueAreaM2 = cosP > 0 ? flatAreaM2 / cosP : flatAreaM2
  const trueAreaSqft = trueAreaM2 * SQFT_PER_SQM

  // Area multiplier
  const areaMultiplier = flatAreaSqft > 0 ? trueAreaSqft / flatAreaSqft : 1.0

  // Pitch ratio (X:12 format)
  const pitchRatio = pitchToRatio12(avgPitchDeg)

  // Waste factor: +5% safety margin per Reuse Canada standard
  //   1.20 if area > 2000 sqft, else 1.10
  const wasteFactor = trueAreaSqft > 2000 ? 1.20 : 1.10

  // Pitch multiplier from execute_roof_order() template:
  //   sqrt(1 + (pitch_deg/45)^2)
  const pitchMultiplier = Math.sqrt(1 + Math.pow(avgPitchDeg / 45, 2))

  // Final material area with waste and pitch adjustment
  const materialAreaSqft = trueAreaSqft * wasteFactor * pitchMultiplier
  const materialSquares = materialAreaSqft / 100

  console.log(`[Area] flat=${flatAreaSqft.toFixed(0)} sqft, true=${trueAreaSqft.toFixed(0)} sqft, ` +
    `pitch=${avgPitchDeg.toFixed(1)}° (${pitchRatio}), waste=${wasteFactor}, ` +
    `pitchMult=${pitchMultiplier.toFixed(3)}, material=${materialAreaSqft.toFixed(0)} sqft (${materialSquares.toFixed(1)} sq)`)

  return {
    flatAreaM2: Math.round(flatAreaM2 * 10) / 10,
    flatAreaSqft: Math.round(flatAreaSqft),
    trueAreaM2: Math.round(trueAreaM2 * 10) / 10,
    trueAreaSqft: Math.round(trueAreaSqft),
    areaMultiplier: Math.round(areaMultiplier * 1000) / 1000,
    avgPitchDeg: Math.round(avgPitchDeg * 10) / 10,
    pitchRatio,
    wasteFactor,
    pitchMultiplier: Math.round(pitchMultiplier * 1000) / 1000,
    materialAreaSqft: Math.round(materialAreaSqft),
    materialSquares: Math.round(materialSquares * 10) / 10
  }
}

// ============================================================
// HELPER: Pitch degrees → X:12 ratio
// ============================================================
function pitchToRatio12(degrees: number): string {
  if (degrees <= 0 || degrees >= 90) return '0:12'
  const rise = 12 * Math.tan(degrees * Math.PI / 180)
  return `${(Math.round(rise * 10) / 10)}:12`
}

// ============================================================
// FULL EXECUTE PIPELINE — Port of execute_roof_order()
//
// HYBRID APPROACH (most accurate):
//   1. Geocode address → lat/lng
//   2. Call buildingInsights API → get roof footprint area & segments
//   3. Call DataLayers API → download DSM GeoTIFF
//   4. Parse DSM → compute slope/pitch from actual elevation data
//   5. Apply pitch from DSM to footprint from buildingInsights
//   6. Calculate true 3D area, waste factor, pitch multiplier
//
// This combines the best of both APIs:
//   - buildingInsights: accurate building footprint boundary
//   - DataLayers DSM: precise slope/pitch from elevation model
// ============================================================
export async function executeRoofOrder(
  address: string,
  apiKey: string,
  mapsApiKey?: string,
  options?: {
    radiusMeters?: number
    skipMask?: boolean
    lat?: number
    lng?: number
    fastMode?: boolean  // Skip RGB, mask overlay, flux — only DSM+mask for measurements
    nearmapApiKey?: string  // If set, prefer Nearmap 7.5cm/px imagery over Google Maps Static
  }
): Promise<DataLayersAnalysis> {
  const startTime = Date.now()
  const geocodeKey = mapsApiKey || apiKey

  // Step 1: Geocode address (or use provided coords)
  let lat: number, lng: number, formattedAddress: string

  if (options?.lat && options?.lng) {
    lat = options.lat
    lng = options.lng
    formattedAddress = address
    console.log(`[Pipeline] Using provided coordinates: ${lat}, ${lng}`)
  } else {
    console.log(`[Pipeline] Step 1: Geocoding '${address}'`)
    const geocoded = await geocodeAddress(address, geocodeKey)
    if (!geocoded) {
      throw new Error(`Failed to geocode address: ${address}`)
    }
    lat = geocoded.lat
    lng = geocoded.lng
    formattedAddress = geocoded.formattedAddress
    console.log(`[Pipeline] Geocoded: ${formattedAddress} → ${lat}, ${lng}`)
  }

  // Step 2: Call buildingInsights for footprint area (parallel with DataLayers)
  console.log(`[Pipeline] Step 2: Calling buildingInsights + DataLayers in parallel`)
  const biUrl = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=HIGH&key=${apiKey}`

  const [biResponse, dataLayers] = await Promise.all([
    fetch(biUrl).then(r => r.ok ? r.json() : null).catch(() => null),
    getDataLayerUrls(lat, lng, apiKey, options?.radiusMeters || 50)
  ])

  // Extract footprint from buildingInsights (most reliable for building boundaries)
  let buildingFootprintM2 = 0
  let biSegments: any[] = []
  if (biResponse) {
    const sp = (biResponse as any).solarPotential
    if (sp?.wholeRoofStats?.areaMeters2) {
      buildingFootprintM2 = sp.wholeRoofStats.areaMeters2
    }
    biSegments = sp?.roofSegmentStats || []
    console.log(`[Pipeline] buildingInsights: ${buildingFootprintM2.toFixed(1)}m² footprint, ${biSegments.length} segments`)
  }

  // Step 3: Download DSM GeoTIFF for slope analysis
  console.log(`[Pipeline] Step 3: Downloading DSM GeoTIFF`)
  const dsmGeoTiff = await downloadGeoTIFF(dataLayers.dsmUrl, apiKey)

  // Also download mask for building boundary identification
  let maskGeoTiff: GeoTiffData | null = null
  if (dataLayers.maskUrl) {
    try {
      maskGeoTiff = await downloadGeoTIFF(dataLayers.maskUrl, apiKey)
    } catch (e) {
      console.warn(`[Pipeline] Mask download failed, using height-based filtering`)
    }
  }

  // Step 3b: RGB aerial GeoTIFF — MASK-CROPPED
  // Download the high-res RGB and use the mask to crop to just the building footprint.
  // This gives us actual aerial photography (0.1-0.5m/pixel) focused on the roof only.
  // FAST MODE: Skip these heavy downloads to stay within CF Workers timeout
  let rgbAerialDataUrl = ''
  let maskOverlayDataUrl = ''
  if (!options?.fastMode) {
  try {
    if (dataLayers.rgbUrl && maskGeoTiff) {
      console.log(`[Pipeline] Step 3b: Converting RGB GeoTIFF with mask crop`)
      rgbAerialDataUrl = await convertRgbWithMaskCrop(dataLayers.rgbUrl, apiKey, maskGeoTiff)
      console.log(`[Pipeline] RGB aerial: ${rgbAerialDataUrl ? `${(rgbAerialDataUrl.length/1024).toFixed(0)}KB` : 'skipped'}`)
    }
    // Generate mask overlay visualization (roof highlighted on satellite)
    if (maskGeoTiff) {
      console.log(`[Pipeline] Step 3c: Generating mask overlay visualization`)
      maskOverlayDataUrl = generateMaskOverlayBMP(maskGeoTiff, dsmGeoTiff)
      console.log(`[Pipeline] Mask overlay: ${maskOverlayDataUrl ? `${(maskOverlayDataUrl.length/1024).toFixed(0)}KB` : 'skipped'}`)
    }
  } catch (rgbErr: any) {
    console.warn(`[Pipeline] RGB/Mask visualization failed (non-critical): ${rgbErr.message}`)
  }
  } else {
    console.log(`[Pipeline] Step 3b/3c: FAST MODE — skipping RGB & mask overlay downloads`)
  }

  // Step 3d: Annual Flux GeoTIFF — solar exposure analysis
  let fluxAnalysis: FluxAnalysis | null = null
  if (!options?.fastMode) {
  try {
    if (dataLayers.annualFluxUrl) {
      console.log(`[Pipeline] Step 3d: Downloading Annual Flux GeoTIFF`)
      const fluxGeoTiff = await downloadGeoTIFF(dataLayers.annualFluxUrl, apiKey)
      fluxAnalysis = analyzeAnnualFlux(fluxGeoTiff, maskGeoTiff, dsmGeoTiff.pixelSizeMeters)
      console.log(`[Pipeline] Flux: mean=${fluxAnalysis.meanFluxKwhM2.toFixed(0)} kWh/m²/yr, total=${fluxAnalysis.totalAnnualKwh.toFixed(0)} kWh/yr, highSun=${fluxAnalysis.highSunPct.toFixed(1)}%`)
    }
  } catch (fluxErr: any) {
    console.warn(`[Pipeline] Flux analysis failed (non-critical): ${fluxErr.message}`)
  }
  } else {
    console.log(`[Pipeline] Step 3d: FAST MODE — skipping Flux GeoTIFF download`)
  }

  // Step 4: Analyze DSM with mask
  console.log(`[Pipeline] Step 4: Analyzing DSM (${dsmGeoTiff.width}x${dsmGeoTiff.height} pixels)`)
  const dsmAnalysis = analyzeDSM(dsmGeoTiff, maskGeoTiff)

  // Step 5: Compute slope/pitch from DSM
  console.log(`[Pipeline] Step 5: Computing slope/pitch from DSM`)
  const slopeAnalysis = computeSlope(dsmAnalysis)

  // Step 6: Calculate areas using HYBRID approach:
  //   - Footprint from buildingInsights (accurate building boundary)
  //   - Pitch from DSM gradient analysis (precise slope measurement)
  console.log(`[Pipeline] Step 6: Calculating roof areas (hybrid approach)`)

  // Use buildingInsights footprint if available (much more accurate for building size)
  // Fall back to DSM pixel count if buildingInsights not available
  let flatAreaM2: number
  let flatAreaSqft: number

  if (buildingFootprintM2 > 0) {
    flatAreaM2 = buildingFootprintM2
    flatAreaSqft = buildingFootprintM2 * SQFT_PER_SQM
    console.log(`[Pipeline] Using buildingInsights footprint: ${flatAreaSqft.toFixed(0)} sqft`)
  } else {
    // Fallback: use DSM pixel count (may overestimate for large radius)
    const pixelArea = dsmAnalysis.pixelSizeMeters * dsmAnalysis.pixelSizeMeters
    flatAreaM2 = dsmAnalysis.validPixelCount * pixelArea
    flatAreaSqft = flatAreaM2 * SQFT_PER_SQM
    console.log(`[Pipeline] Using DSM pixel count: ${flatAreaSqft.toFixed(0)} sqft (${dsmAnalysis.validPixelCount} pixels)`)
  }

  // Use HYBRID pitch: prefer buildingInsights per-segment pitch (from actual 
  // roof model) when available, verified against DSM gradient analysis.
  // buildingInsights segments have direct pitch measurements per roof plane.
  // DSM gradient measures slope of ALL pixels (including ground, terrain edges)
  // which can overestimate pitch for flat/low-pitch roofs.
  let avgPitchDeg: number

  if (biSegments.length > 0) {
    // Weighted average pitch from buildingInsights segments (most accurate for roof planes)
    const totalSegArea = biSegments.reduce((s: number, seg: any) => s + (seg.stats?.areaMeters2 || 0), 0)
    avgPitchDeg = totalSegArea > 0
      ? biSegments.reduce((s: number, seg: any) => {
          const segArea = seg.stats?.areaMeters2 || 0
          const segPitch = seg.pitchDegrees || 0
          return s + segPitch * segArea
        }, 0) / totalSegArea
      : slopeAnalysis.weightedAvgPitchDeg

    console.log(`[Pipeline] Using buildingInsights pitch: ${avgPitchDeg.toFixed(1)}° (DSM slope: ${slopeAnalysis.weightedAvgPitchDeg}° for reference)`)
  } else {
    // Fallback to DSM gradient pitch
    avgPitchDeg = slopeAnalysis.weightedAvgPitchDeg
    console.log(`[Pipeline] Using DSM slope pitch: ${avgPitchDeg.toFixed(1)}° (no buildingInsights segments)`)
  }

  // True 3D area = flat / cos(pitch)
  const pitchRad = avgPitchDeg * (Math.PI / 180)
  const cosP = Math.cos(pitchRad)
  const trueAreaM2 = cosP > 0 ? flatAreaM2 / cosP : flatAreaM2
  const trueAreaSqft = trueAreaM2 * SQFT_PER_SQM

  // Area multiplier
  const areaMultiplier = flatAreaSqft > 0 ? trueAreaSqft / flatAreaSqft : 1.0

  // Waste factor: +5% safety margin per Reuse Canada standard
  const wasteFactor = trueAreaSqft > 2000 ? 1.20 : 1.10

  // Pitch multiplier: sqrt(1 + (pitch_deg/45)^2)
  const pitchMultiplier = Math.sqrt(1 + Math.pow(avgPitchDeg / 45, 2))

  // Material area
  const materialAreaSqft = trueAreaSqft * wasteFactor * pitchMultiplier
  const materialSquares = materialAreaSqft / 100

  const pitchRatio = pitchToRatio12(avgPitchDeg)

  const areaCalc: RoofAreaCalculation = {
    flatAreaM2: Math.round(flatAreaM2 * 10) / 10,
    flatAreaSqft: Math.round(flatAreaSqft),
    trueAreaM2: Math.round(trueAreaM2 * 10) / 10,
    trueAreaSqft: Math.round(trueAreaSqft),
    areaMultiplier: Math.round(areaMultiplier * 1000) / 1000,
    avgPitchDeg: Math.round(avgPitchDeg * 10) / 10,
    pitchRatio,
    wasteFactor,
    pitchMultiplier: Math.round(pitchMultiplier * 1000) / 1000,
    materialAreaSqft: Math.round(materialAreaSqft),
    materialSquares: Math.round(materialSquares * 10) / 10
  }

  const durationMs = Date.now() - startTime

  // Build imagery date string
  const imgDate = dataLayers.imageryDate
  const imageryDateStr = imgDate
    ? `${imgDate.year}-${String(imgDate.month).padStart(2, '0')}-${String(imgDate.day).padStart(2, '0')}`
    : 'unknown'

  // Zoom levels — tight on the roof for measurement quality
  // Zoom 20 (~30m across at scale=2) is ideal for most residential roofs
  // Only zoom out to 19 for very large commercial (>2000 m²)
  const footprintM2 = areaCalc.flatAreaSqft / 10.7639
  const roofZoom = footprintM2 > 2000 ? 19 : footprintM2 > 800 ? 20 : 20
  const contextZoom = roofZoom - 3
  const mediumZoom = roofZoom - 1

  // ── IMAGERY: Prefer Nearmap (7.5cm/px) over Google Maps Static ──
  let satelliteOverheadUrl: string
  let satelliteContextUrl: string
  let satelliteMediumUrl: string
  let imageryProvider = 'google_maps_static'

  if (options?.nearmapApiKey) {
    try {
      const nmResult = await fetchNearmapImageryForReport(lat, lng, options.nearmapApiKey, areaCalc.flatAreaSqft, { timeoutMs: 5000 })
      if (nmResult) {
        satelliteOverheadUrl = nmResult.imagery.satellite_overhead_url
        satelliteContextUrl = nmResult.imagery.satellite_context_url
        satelliteMediumUrl = nmResult.imagery.satellite_medium_url
        imageryProvider = 'nearmap'
        console.log(`[Pipeline] Using Nearmap imagery (7.5cm/px) — survey: ${nmResult.coverage.latestSurveyDate}`)
      } else {
        satelliteOverheadUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${roofZoom}&size=800x800&scale=2&maptype=satellite&key=${geocodeKey}`
        satelliteContextUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${contextZoom}&size=640x640&scale=2&maptype=satellite&key=${geocodeKey}`
        satelliteMediumUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${mediumZoom}&size=640x640&scale=2&maptype=satellite&key=${geocodeKey}`
        console.log(`[Pipeline] Nearmap: no coverage — using Google Maps Static`)
      }
    } catch (e: any) {
      console.warn(`[Pipeline] Nearmap failed (${e.message}) — using Google Maps Static`)
      satelliteOverheadUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${roofZoom}&size=800x800&scale=2&maptype=satellite&key=${geocodeKey}`
      satelliteContextUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${contextZoom}&size=640x640&scale=2&maptype=satellite&key=${geocodeKey}`
      satelliteMediumUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${mediumZoom}&size=640x640&scale=2&maptype=satellite&key=${geocodeKey}`
    }
  } else {
    // Default: Google Maps Static API
    satelliteOverheadUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${roofZoom}&size=800x800&scale=2&maptype=satellite&key=${geocodeKey}`
    satelliteContextUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${contextZoom}&size=640x640&scale=2&maptype=satellite&key=${geocodeKey}`
    satelliteMediumUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${mediumZoom}&size=640x640&scale=2&maptype=satellite&key=${geocodeKey}`
  }
  // Legacy compatible URL
  const satelliteUrl = satelliteOverheadUrl

  console.log(`[Pipeline] Complete in ${durationMs}ms: flat=${areaCalc.flatAreaSqft} sqft → true=${areaCalc.trueAreaSqft} sqft, pitch=${areaCalc.avgPitchDeg}° (${pitchRatio}), material=${areaCalc.materialSquares} sq`)

  return {
    latitude: lat,
    longitude: lng,
    formattedAddress,
    imageryDate: imageryDateStr,
    imageryQuality: dataLayers.imageryQuality,
    area: areaCalc,
    slope: slopeAnalysis,
    dsm: {
      minHeight: dsmAnalysis.minHeight,
      maxHeight: dsmAnalysis.maxHeight,
      meanHeight: dsmAnalysis.meanHeight,
      validPixels: dsmAnalysis.validPixelCount,
      pixelSizeMeters: dsmAnalysis.pixelSizeMeters
    },
    flux: fluxAnalysis,
    dsmUrl: dataLayers.dsmUrl,
    maskUrl: dataLayers.maskUrl || '',
    rgbUrl: dataLayers.rgbUrl || '',
    annualFluxUrl: dataLayers.annualFluxUrl || '',
    rgbAerialDataUrl: rgbAerialDataUrl,
    maskOverlayDataUrl: maskOverlayDataUrl,
    satelliteUrl,
    satelliteOverheadUrl,
    satelliteContextUrl,
    satelliteMediumUrl,
    durationMs,
    provider: 'google_solar_datalayers'
  }
}

// ============================================================
// RGB GEOTIFF WITH MASK CROP — Crop aerial imagery to roof footprint
// Downloads the high-res RGB GeoTIFF and applies the building mask
// to show only roof pixels (everything else becomes transparent/grey).
// This produces a focused roof image at 0.1-0.5m/pixel resolution.
// ============================================================
async function convertRgbWithMaskCrop(
  rgbUrl: string,
  apiKey: string,
  maskData: GeoTiffData
): Promise<string> {
  const fetchUrl = rgbUrl.includes('solar.googleapis.com')
    ? `${rgbUrl}&key=${apiKey}`
    : rgbUrl

  const response = await fetch(fetchUrl)
  if (!response.ok) {
    throw new Error(`RGB GeoTIFF download failed (${response.status})`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const tiff = await geotiff.fromArrayBuffer(arrayBuffer)
  const image = await tiff.getImage()
  const rasters = await image.readRasters()
  const width = image.getWidth()
  const height = image.getHeight()

  console.log(`[RGB-Crop] Image: ${width}x${height}, ${rasters.length} bands, mask: ${maskData.width}x${maskData.height}`)

  // Skip if too large for Workers memory
  if (width > 800 || height > 800) {
    console.warn(`[RGB-Crop] Image too large (${width}x${height}), skipping`)
    return ''
  }

  if (rasters.length < 3) return ''

  const r = rasters[0] as any
  const g = rasters[1] as any
  const b = rasters[2] as any
  const rawMask = maskData.rasters[0]

  // Resample mask to RGB dimensions if they differ
  const xRatio = maskData.width / width
  const yRatio = maskData.height / height

  // Find bounding box of roof pixels to crop tightly
  let minX = width, maxX = 0, minY = height, maxY = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcX = Math.min(Math.floor(x * xRatio), maskData.width - 1)
      const srcY = Math.min(Math.floor(y * yRatio), maskData.height - 1)
      if (rawMask[srcY * maskData.width + srcX] > 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  if (maxX <= minX || maxY <= minY) {
    console.warn('[RGB-Crop] No roof pixels found in mask')
    return ''
  }

  // Add 10px padding around the crop box
  const pad = 10
  minX = Math.max(0, minX - pad)
  minY = Math.max(0, minY - pad)
  maxX = Math.min(width - 1, maxX + pad)
  maxY = Math.min(height - 1, maxY + pad)

  const cropW = maxX - minX + 1
  const cropH = maxY - minY + 1

  // Limit cropped size
  if (cropW > 500 || cropH > 500) {
    console.warn(`[RGB-Crop] Crop too large (${cropW}x${cropH}), skipping`)
    return ''
  }

  console.log(`[RGB-Crop] Cropping to ${cropW}x${cropH} (from ${minX},${minY} to ${maxX},${maxY})`)

  // Build BMP with mask applied — non-roof pixels dimmed to 30% opacity
  const rowSize = Math.ceil(cropW * 3 / 4) * 4
  const pixelDataSize = rowSize * cropH
  const fileSize = 54 + pixelDataSize
  const bmp = new Uint8Array(fileSize)
  const view = new DataView(bmp.buffer)

  // BMP File Header
  bmp[0] = 0x42; bmp[1] = 0x4D
  view.setUint32(2, fileSize, true)
  view.setUint32(10, 54, true)

  // BMP Info Header
  view.setUint32(14, 40, true)
  view.setInt32(18, cropW, true)
  view.setInt32(22, cropH, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, 24, true)
  view.setUint32(34, pixelDataSize, true)

  // Pixel data with mask-based dimming
  for (let cy = 0; cy < cropH; cy++) {
    const srcY = cy + minY
    const bmpRow = cropH - 1 - cy
    for (let cx = 0; cx < cropW; cx++) {
      const srcX = cx + minX
      const srcIdx = srcY * width + srcX

      // Check mask
      const maskSrcX = Math.min(Math.floor(srcX * xRatio), maskData.width - 1)
      const maskSrcY = Math.min(Math.floor(srcY * yRatio), maskData.height - 1)
      const isRoof = rawMask[maskSrcY * maskData.width + maskSrcX] > 0

      const dstIdx = 54 + bmpRow * rowSize + cx * 3
      let rv = Math.max(0, Math.min(255, Math.round(r[srcIdx])))
      let gv = Math.max(0, Math.min(255, Math.round(g[srcIdx])))
      let bv = Math.max(0, Math.min(255, Math.round(b[srcIdx])))

      if (!isRoof) {
        // Dim non-roof pixels: blend to grey at 30%
        rv = Math.round(rv * 0.3 + 60)
        gv = Math.round(gv * 0.3 + 60)
        bv = Math.round(bv * 0.3 + 60)
      }

      bmp[dstIdx]     = bv
      bmp[dstIdx + 1] = gv
      bmp[dstIdx + 2] = rv
    }
  }

  // Convert to base64
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bmp.length; i += chunkSize) {
    const chunk = bmp.subarray(i, Math.min(i + chunkSize, bmp.length))
    binary += String.fromCharCode(...chunk)
  }
  return `data:image/bmp;base64,${btoa(binary)}`
}

// ============================================================
// MASK OVERLAY VISUALIZATION — Highlight roof pixels on DSM heightmap
// Creates a BMP showing the DSM as a greyscale heightmap with
// roof (mask) pixels highlighted in translucent blue.
// This helps users visualize exactly which pixels the algorithm
// considers to be "roof" vs "ground".
// ============================================================
function generateMaskOverlayBMP(
  maskData: GeoTiffData,
  dsmData: GeoTiffData
): string {
  const width = maskData.width
  const height = maskData.height
  const mask = maskData.rasters[0]

  if (width > 500 || height > 500) {
    console.warn(`[MaskOverlay] Image too large (${width}x${height}), skipping`)
    return ''
  }

  // Get DSM for greyscale background — resample if dimensions differ
  const dsm = dsmData.rasters[0]
  const dsmW = dsmData.width
  const dsmH = dsmData.height

  // Find DSM height range for normalization
  let minH = Infinity, maxH = -Infinity
  for (let i = 0; i < dsm.length; i++) {
    if (!isNaN(dsm[i]) && isFinite(dsm[i]) && dsm[i] > 0) {
      if (dsm[i] < minH) minH = dsm[i]
      if (dsm[i] > maxH) maxH = dsm[i]
    }
  }
  const hRange = maxH - minH || 1

  const rowSize = Math.ceil(width * 3 / 4) * 4
  const pixelDataSize = rowSize * height
  const fileSize = 54 + pixelDataSize
  const bmp = new Uint8Array(fileSize)
  const view = new DataView(bmp.buffer)

  // Headers
  bmp[0] = 0x42; bmp[1] = 0x4D
  view.setUint32(2, fileSize, true)
  view.setUint32(10, 54, true)
  view.setUint32(14, 40, true)
  view.setInt32(18, width, true)
  view.setInt32(22, height, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, 24, true)
  view.setUint32(34, pixelDataSize, true)

  const dsmXRatio = dsmW / width
  const dsmYRatio = dsmH / height

  for (let y = 0; y < height; y++) {
    const bmpRow = height - 1 - y
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const isRoof = mask[idx] > 0

      // Sample DSM height for greyscale
      const dsmSrcX = Math.min(Math.floor(x * dsmXRatio), dsmW - 1)
      const dsmSrcY = Math.min(Math.floor(y * dsmYRatio), dsmH - 1)
      const h = dsm[dsmSrcY * dsmW + dsmSrcX]
      const grey = (!isNaN(h) && isFinite(h) && h > 0)
        ? Math.round(((h - minH) / hRange) * 200 + 40)
        : 30

      const dstIdx = 54 + bmpRow * rowSize + x * 3

      if (isRoof) {
        // Blue-cyan highlight for roof pixels
        bmp[dstIdx]     = Math.min(255, grey + 100)  // Blue channel boosted
        bmp[dstIdx + 1] = Math.min(255, Math.round(grey * 0.6 + 80))  // Green
        bmp[dstIdx + 2] = Math.round(grey * 0.3)  // Red dimmed
      } else {
        // Dark greyscale for non-roof
        const dark = Math.round(grey * 0.4)
        bmp[dstIdx]     = dark
        bmp[dstIdx + 1] = dark
        bmp[dstIdx + 2] = dark
      }
    }
  }

  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bmp.length; i += chunkSize) {
    const chunk = bmp.subarray(i, Math.min(i + chunkSize, bmp.length))
    binary += String.fromCharCode(...chunk)
  }
  return `data:image/bmp;base64,${btoa(binary)}`
}

// ============================================================
// ANNUAL FLUX ANALYSIS — Extract solar exposure data from GeoTIFF
// The Annual Flux GeoTIFF contains kWh/m²/year per pixel.
// We mask it to roof pixels only and compute:
//   - Mean, min, max flux
//   - Total annual kWh yield
//   - High-sun and shaded zone percentages
//   - Equivalent peak sun hours per day
//   - A heatmap data URL for visualization
// ============================================================
function analyzeAnnualFlux(
  fluxData: GeoTiffData,
  maskData: GeoTiffData | null,
  pixelSizeMeters: number
): FluxAnalysis {
  const flux = fluxData.rasters[0]
  const width = fluxData.width
  const height = fluxData.height
  const pixelAreaM2 = pixelSizeMeters * pixelSizeMeters

  // Resample mask to flux dimensions if needed
  let mask: number[] | null = null
  if (maskData && maskData.rasters[0]) {
    const raw = maskData.rasters[0]
    if (maskData.width === width && maskData.height === height) {
      mask = raw
    } else {
      mask = new Array(width * height)
      const xR = maskData.width / width
      const yR = maskData.height / height
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const sx = Math.min(Math.floor(x * xR), maskData.width - 1)
          const sy = Math.min(Math.floor(y * yR), maskData.height - 1)
          mask[y * width + x] = raw[sy * maskData.width + sx]
        }
      }
    }
  }

  let sumFlux = 0, count = 0, minFlux = Infinity, maxFlux = -Infinity
  let highSunCount = 0, shadedCount = 0
  const validFluxValues: number[] = []

  for (let i = 0; i < flux.length; i++) {
    const v = flux[i]
    if (isNaN(v) || !isFinite(v) || v <= 0) continue
    if (mask && mask[i] <= 0) continue

    validFluxValues.push(v)
    sumFlux += v
    count++
    if (v < minFlux) minFlux = v
    if (v > maxFlux) maxFlux = v
    if (v >= 1000) highSunCount++
    if (v < 600) shadedCount++
  }

  const meanFlux = count > 0 ? sumFlux / count : 0
  const totalKwh = count > 0 ? sumFlux * pixelAreaM2 : 0

  // Generate flux heatmap BMP visualization
  let fluxHeatmapDataUrl = ''
  if (width <= 500 && height <= 500 && count > 0) {
    const fluxRange = (maxFlux - minFlux) || 1
    const rowSize = Math.ceil(width * 3 / 4) * 4
    const pixDataSize = rowSize * height
    const fSize = 54 + pixDataSize
    const bmp = new Uint8Array(fSize)
    const dv = new DataView(bmp.buffer)

    bmp[0] = 0x42; bmp[1] = 0x4D
    dv.setUint32(2, fSize, true)
    dv.setUint32(10, 54, true)
    dv.setUint32(14, 40, true)
    dv.setInt32(18, width, true)
    dv.setInt32(22, height, true)
    dv.setUint16(26, 1, true)
    dv.setUint16(28, 24, true)
    dv.setUint32(34, pixDataSize, true)

    for (let y = 0; y < height; y++) {
      const bmpRow = height - 1 - y
      for (let x = 0; x < width; x++) {
        const idx = y * width + x
        const v = flux[idx]
        const isMasked = mask ? mask[idx] <= 0 : false
        const dstIdx = 54 + bmpRow * rowSize + x * 3

        if (isNaN(v) || !isFinite(v) || v <= 0 || isMasked) {
          // Dark background for non-roof
          bmp[dstIdx] = 20; bmp[dstIdx + 1] = 20; bmp[dstIdx + 2] = 20
        } else {
          // Heatmap: blue (low) → green (mid) → yellow (high) → red (very high)
          const t = Math.max(0, Math.min(1, (v - minFlux) / fluxRange))
          let rv: number, gv: number, bv: number
          if (t < 0.25) {
            // Blue → Cyan
            const s = t / 0.25
            rv = 0; gv = Math.round(s * 180); bv = Math.round(180 + s * 75)
          } else if (t < 0.5) {
            // Cyan → Green
            const s = (t - 0.25) / 0.25
            rv = 0; gv = Math.round(180 + s * 75); bv = Math.round(255 - s * 255)
          } else if (t < 0.75) {
            // Green → Yellow
            const s = (t - 0.5) / 0.25
            rv = Math.round(s * 255); gv = 255; bv = 0
          } else {
            // Yellow → Red
            const s = (t - 0.75) / 0.25
            rv = 255; gv = Math.round(255 - s * 200); bv = 0
          }
          bmp[dstIdx] = bv; bmp[dstIdx + 1] = gv; bmp[dstIdx + 2] = rv
        }
      }
    }

    let binStr = ''
    const cs = 8192
    for (let i = 0; i < bmp.length; i += cs) {
      const chunk = bmp.subarray(i, Math.min(i + cs, bmp.length))
      binStr += String.fromCharCode(...chunk)
    }
    fluxHeatmapDataUrl = `data:image/bmp;base64,${btoa(binStr)}`
  }

  console.log(`[Flux] ${count} roof pixels: mean=${meanFlux.toFixed(0)} kWh/m²/yr, total=${totalKwh.toFixed(0)} kWh/yr`)

  return {
    meanFluxKwhM2: Math.round(meanFlux * 10) / 10,
    maxFluxKwhM2: maxFlux === -Infinity ? 0 : Math.round(maxFlux * 10) / 10,
    minFluxKwhM2: minFlux === Infinity ? 0 : Math.round(minFlux * 10) / 10,
    totalAnnualKwh: Math.round(totalKwh),
    validPixels: count,
    highSunPct: count > 0 ? Math.round(highSunCount / count * 1000) / 10 : 0,
    shadedPct: count > 0 ? Math.round(shadedCount / count * 1000) / 10 : 0,
    peakSunHoursPerDay: Math.round(meanFlux / 365 * 100) / 100,
    fluxHeatmapDataUrl
  }
}
