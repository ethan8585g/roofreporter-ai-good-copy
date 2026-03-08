// ============================================================
// RoofReporterAI — Geospatial Math Utilities
// Pure geometric/pixel computation functions.
// No external dependencies — fully testable.
// ============================================================

import type { AIMeasurementAnalysis } from '../types'

/** Convert decimal feet to feet-inches string (e.g., 12.5 → "12' 6\"") */
export function feetToFeetInches(ft: number): string {
  const wholeFeet = Math.floor(ft)
  const inches = Math.round((ft - wholeFeet) * 12)
  if (inches === 0 || inches === 12) {
    return `${inches === 12 ? wholeFeet + 1 : wholeFeet}'`
  }
  return `${wholeFeet}' ${inches}"`
}

/**
 * Convert lat/lng to pixel coordinates on a Google Maps Static image.
 * Uses Web Mercator projection (EPSG:3857).
 */
export function latLngToPixels(
  lat: number, lng: number,
  centerLat: number, centerLng: number,
  zoom: number,
  imgWidth: number = 640, imgHeight: number = 640
): { x: number; y: number } {
  const toWorld = (latDeg: number, lngDeg: number) => {
    const latRad = (latDeg * Math.PI) / 180
    return {
      wx: ((lngDeg + 180) / 360) * 256,
      wy: (0.5 - Math.log(Math.tan(Math.PI / 4 + latRad / 2)) / (2 * Math.PI)) * 256
    }
  }
  const scale = Math.pow(2, zoom)
  const center = toWorld(centerLat, centerLng)
  const point = toWorld(lat, lng)
  const centerPx = { x: center.wx * scale, y: center.wy * scale }
  const pointPx = { x: point.wx * scale, y: point.wy * scale }
  return {
    x: imgWidth / 2 + (pointPx.x - centerPx.x),
    y: imgHeight / 2 + (pointPx.y - centerPx.y)
  }
}

/** Pixel distance between two points on the 640px canvas */
export function pixelDistance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
}

/**
 * Shoelace formula: compute the absolute area of a polygon from its vertices.
 * Returns area in pixel² (on the 640x640 coordinate space).
 */
export function polygonPixelArea(points: { x: number; y: number }[]): number {
  if (!points || points.length < 3) return 0
  let area = 0
  const n = points.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += points[i].x * points[j].y
    area -= points[j].x * points[i].y
  }
  return Math.abs(area) / 2
}

/**
 * Compute scale factor: sqft per pixel² on the 640x640 satellite image.
 * Uses AI geometry facet areas or perimeter polygon, falls back to zoom-based estimate.
 */
export function computePixelToSqftScale(
  aiGeometry: AIMeasurementAnalysis | null | undefined,
  totalFootprintSqft: number,
  latitude?: number | null,
  zoom?: number
): number {
  if (!totalFootprintSqft || totalFootprintSqft <= 0) return 0

  if (aiGeometry?.facets && aiGeometry.facets.length >= 2) {
    const totalFacetPx = aiGeometry.facets.reduce((sum, f) => {
      return sum + polygonPixelArea(f.points || [])
    }, 0)
    if (totalFacetPx > 100) return totalFootprintSqft / totalFacetPx
  }

  if (aiGeometry?.perimeter && aiGeometry.perimeter.length >= 3) {
    const perimPx = polygonPixelArea(aiGeometry.perimeter)
    if (perimPx > 100) return totalFootprintSqft / perimPx
  }

  if (latitude && zoom) {
    const metersPerPx640 = (156543.03392 * Math.cos((latitude || 53) * Math.PI / 180)) / Math.pow(2, zoom) * 2
    const sqftPerPx2 = (metersPerPx640 * metersPerPx640) * 10.7639
    return sqftPerPx2
  }

  return 0
}

/** Parse pitch from AI facet's pitch string (e.g. "25 deg", "6/12", "22.5°") */
export function parseFacetPitch(pitchStr: string | undefined, defaultDeg: number): number {
  if (!pitchStr) return defaultDeg
  const ratioMatch = pitchStr.match(/(\d+(?:\.\d+)?)\s*\/\s*12/)
  if (ratioMatch) return Math.atan(parseFloat(ratioMatch[1]) / 12) * 180 / Math.PI
  const degMatch = pitchStr.match(/(\d+(?:\.\d+)?)\s*(?:deg|°)/)
  if (degMatch) return parseFloat(degMatch[1])
  const num = parseFloat(pitchStr)
  if (!isNaN(num) && num > 0 && num < 90) return num
  return defaultDeg
}

/** Parse azimuth from AI facet's azimuth string (e.g. "180 deg", "South", "SW") */
export function parseFacetAzimuth(azStr: string | undefined): number {
  if (!azStr) return 180
  const degMatch = azStr.match(/(\d+(?:\.\d+)?)\s*(?:deg|°)?/)
  if (degMatch) return parseFloat(degMatch[1])
  const cardinals: Record<string, number> = {
    'N': 0, 'NNE': 22.5, 'NE': 45, 'ENE': 67.5, 'E': 90, 'ESE': 112.5,
    'SE': 135, 'SSE': 157.5, 'S': 180, 'SSW': 202.5, 'SW': 225, 'WSW': 247.5,
    'W': 270, 'WNW': 292.5, 'NW': 315, 'NNW': 337.5,
    'NORTH': 0, 'SOUTH': 180, 'EAST': 90, 'WEST': 270
  }
  const upper = azStr.trim().toUpperCase()
  if (cardinals[upper] !== undefined) return cardinals[upper]
  return 180
}

/** Calculate rotation angle for SVG label along a line (never upside-down) */
export function lineAngleDeg(x1: number, y1: number, x2: number, y2: number): number {
  let angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI
  if (angle > 90) angle -= 180
  if (angle < -90) angle += 180
  return angle
}

/**
 * Smart edge footage redistribution.
 * Handles RAKE↔HIP mismatch where Gemini labels hip-roof diagonal edges as RAKE.
 */
export function smartEdgeFootage(
  edgeSummary: { total_ridge_ft: number; total_hip_ft: number; total_valley_ft: number; total_eave_ft: number; total_rake_ft: number }
): Record<string, number> {
  const result: Record<string, number> = {
    'EAVE': edgeSummary.total_eave_ft,
    'RAKE': edgeSummary.total_rake_ft,
    'HIP': edgeSummary.total_hip_ft,
    'RIDGE': edgeSummary.total_ridge_ft,
    'VALLEY': edgeSummary.total_valley_ft,
  }

  if (result['RAKE'] === 0 && result['HIP'] > 0) {
    result['RAKE'] = result['HIP']
  } else if (result['HIP'] === 0 && result['RAKE'] > 0) {
    result['HIP'] = result['RAKE']
  }

  const totalPerim = result['EAVE'] + result['RAKE'] + result['HIP']
  if (totalPerim === 0) {
    const totalLinear = edgeSummary.total_eave_ft + edgeSummary.total_rake_ft + edgeSummary.total_hip_ft + edgeSummary.total_ridge_ft + edgeSummary.total_valley_ft
    result['EAVE'] = totalLinear * 0.5
    result['RAKE'] = totalLinear * 0.25
    result['HIP'] = totalLinear * 0.25
  }

  return result
}

/** Edge type color map for SVG diagrams */
export const EDGE_COLORS: Record<string, string> = {
  'RIDGE': '#C62828', 'HIP': '#C62828', 'VALLEY': '#1565C0',
  'EAVE': '#1B2838', 'RAKE': '#E91E63',
}

/** Edge type stroke widths */
export const EDGE_WIDTHS: Record<string, number> = {
  'RIDGE': 3.5, 'HIP': 3, 'VALLEY': 3, 'EAVE': 2.5, 'RAKE': 2.5,
}

/** Standard segment colors palette */
export const SEGMENT_COLORS = [
  '#4A90D9', '#5BA55B', '#CC7832', '#9876AA', '#D4A017',
  '#6897BB', '#A8A852', '#D98880', '#76B5C5', '#B39DDB'
]
