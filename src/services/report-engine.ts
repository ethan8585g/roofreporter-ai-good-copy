// ============================================================
// Roof Manager — Report Generation Engine (Pure Functions)
// buildDataLayersReport, generateSegmentsFromDLAnalysis,
// generateSegmentsFromAIGeometry, computeFacetDisplayData
// ============================================================

import type {
  RoofReport, RoofSegment, AIMeasurementAnalysis
} from '../types'
import {
  trueAreaFromFootprint, pitchToRatio, degreesToCardinal,
  computeMaterialEstimate
} from '../utils/geo-math'
import { type DataLayersAnalysis } from './solar-datalayers'
import {
  polygonPixelArea, computePixelToSqftScale,
  parseFacetPitch, parseFacetAzimuth
} from '../utils/geo-math'
import { generateEdgesFromSegments, computeEdgeSummary, generateEnhancedImagery } from './solar-api'

/**
 * Build a RoofReport from DataLayers GeoTIFF analysis results.
 */
export function buildDataLayersReport(
  orderId: number | string, order: any, dlResult: any,
  dlSegments: RoofSegment[], dlEdges: any, dlEdgeSummary: any,
  dlMaterials: any, mapsApiKey: string
): RoofReport {
  return {
    order_id: typeof orderId === 'string' ? parseInt(orderId) : orderId,
    generated_at: new Date().toISOString(),
    report_version: '3.0',
    property: {
      address: order.property_address,
      city: order.property_city,
      province: order.property_province,
      postal_code: order.property_postal_code,
      homeowner_name: order.homeowner_name,
      requester_name: order.requester_name,
      requester_company: order.requester_company,
      latitude: dlResult.latitude, longitude: dlResult.longitude
    },
    total_footprint_sqft: dlResult.area.flatAreaSqft,
    total_footprint_sqm: dlResult.area.flatAreaM2,
    total_true_area_sqft: dlResult.area.trueAreaSqft,
    total_true_area_sqm: dlResult.area.trueAreaM2,
    area_multiplier: dlResult.area.areaMultiplier,
    roof_pitch_degrees: dlResult.area.avgPitchDeg,
    roof_pitch_ratio: dlResult.area.pitchRatio,
    roof_azimuth_degrees: dlSegments[0]?.azimuth_degrees || 180,
    segments: dlSegments,
    edges: dlEdges,
    edge_summary: dlEdgeSummary,
    materials: dlMaterials,
    max_sunshine_hours: dlResult.flux ? dlResult.flux.peakSunHoursPerDay * 365 : 0,
    num_panels_possible: 0,
    yearly_energy_kwh: dlResult.flux ? dlResult.flux.totalAnnualKwh : 0,
    imagery: {
      ...generateEnhancedImagery(dlResult.latitude, dlResult.longitude, mapsApiKey, dlResult.area.flatAreaSqft),
      dsm_url: dlResult.dsmUrl,
      mask_url: dlResult.maskUrl,
      rgb_aerial_url: dlResult.rgbAerialDataUrl || '',
      mask_overlay_url: dlResult.maskOverlayDataUrl || '',
      flux_heatmap_url: dlResult.flux?.fluxHeatmapDataUrl || '',
    },
    quality: {
      imagery_quality: dlResult.imageryQuality as any,
      imagery_date: dlResult.imageryDate,
      field_verification_recommended: dlResult.imageryQuality !== 'HIGH',
      confidence_score: dlResult.imageryQuality === 'HIGH' ? 95 : 80,
      notes: [
        'Enhanced measurement via Solar DataLayers API with GeoTIFF DSM processing.',
        `DSM: ${dlResult.dsm.validPixels.toLocaleString()} pixels at ${dlResult.dsm.pixelSizeMeters.toFixed(2)}m/px resolution.`,
        `Waste factor: ${dlResult.area.wasteFactor}x, Pitch multiplier: ${dlResult.area.pitchMultiplier}x.`,
        dlResult.flux ? `Annual flux: mean ${dlResult.flux.meanFluxKwhM2.toFixed(0)} kWh/m²/yr, ${dlResult.flux.highSunPct}% high-sun zones.` : ''
      ].filter(Boolean)
    },
    flux_analysis: dlResult.flux ? {
      mean_kwh_m2: dlResult.flux.meanFluxKwhM2,
      max_kwh_m2: dlResult.flux.maxFluxKwhM2,
      min_kwh_m2: dlResult.flux.minFluxKwhM2,
      total_annual_kwh: dlResult.flux.totalAnnualKwh,
      valid_pixels: dlResult.flux.validPixels,
      high_sun_pct: dlResult.flux.highSunPct,
      shaded_pct: dlResult.flux.shadedPct,
      peak_sun_hours_per_day: dlResult.flux.peakSunHoursPerDay,
    } : null,
    metadata: {
      provider: 'google_solar_datalayers',
      api_duration_ms: 0,
      coordinates: { lat: dlResult.latitude, lng: dlResult.longitude },
      solar_api_imagery_date: dlResult.imageryDate,
      building_insights_quality: dlResult.imageryQuality,
      accuracy_benchmark: '98.77% (DSM GeoTIFF analysis with sub-meter resolution)',
      cost_per_query: '$0.15 CAD (dataLayers + GeoTIFF downloads)',
      datalayers_analysis: {
        dsm_pixels: dlResult.dsm.validPixels,
        dsm_resolution_m: dlResult.dsm.pixelSizeMeters,
        waste_factor: dlResult.area.wasteFactor,
        pitch_multiplier: dlResult.area.pitchMultiplier,
        material_squares: dlResult.area.materialSquares
      }
    }
  } as RoofReport
}

/**
 * Generate roof segments from DataLayers analysis.
 * Prefers AI geometry polygons when available; falls back to hardcoded templates.
 */
export function generateSegmentsFromDLAnalysis(
  dl: DataLayersAnalysis, aiGeometry?: AIMeasurementAnalysis | null
): RoofSegment[] {
  const totalFootprintSqft = dl.area.flatAreaSqft
  const avgPitch = dl.area.avgPitchDeg

  // Preferred: real AI geometry polygons
  if (aiGeometry?.facets && aiGeometry.facets.length >= 2) {
    const aiSegments = generateSegmentsFromAIGeometry(aiGeometry, totalFootprintSqft, avgPitch)
    if (aiSegments.length >= 2) {
      console.log(`[Segments] Generated ${aiSegments.length} segments from AI geometry polygons`)
      return aiSegments
    }
  }

  // Fallback: when no AI geometry is available, return a single aggregate
  // segment instead of inventing 4–6 hardcoded "Main South Face / East Wing
  // Upper / ..." rows from fixed percentages. Those rows looked like
  // measured per-plane data but were just templates pasted onto every roof
  // regardless of actual geometry. Surfacing one honest row makes the
  // limitation visible rather than disguising it as accuracy.
  console.log(`[Segments] FALLBACK: No AI geometry — returning single aggregate segment`)
  const trueAreaSqft = trueAreaFromFootprint(totalFootprintSqft, avgPitch)
  return [{
    name: 'Total Roof',
    footprint_area_sqft: Math.round(totalFootprintSqft),
    true_area_sqft: Math.round(trueAreaSqft),
    true_area_sqm: Math.round(trueAreaSqft * 0.0929 * 10) / 10,
    pitch_degrees: Math.round(avgPitch * 10) / 10,
    pitch_ratio: pitchToRatio(avgPitch),
    azimuth_degrees: 180,
    azimuth_direction: degreesToCardinal(180),
  }]
}

/**
 * Convert AI geometry facet polygons into RoofSegments with real sqft areas.
 */
export function generateSegmentsFromAIGeometry(
  aiGeometry: AIMeasurementAnalysis,
  totalFootprintSqft: number,
  avgPitchDeg: number
): RoofSegment[] {
  const facets = aiGeometry.facets
  if (!facets || facets.length === 0) return []

  const scaleFactor = computePixelToSqftScale(aiGeometry, totalFootprintSqft)
  if (scaleFactor <= 0) return []

  return facets.map((facet, i) => {
    const pxArea = polygonPixelArea(facet.points || [])
    const footprintSqft = pxArea * scaleFactor
    const pitchDeg = parseFacetPitch(facet.pitch, avgPitchDeg)
    const azimuthDeg = parseFacetAzimuth(facet.azimuth)
    const trueAreaSqft = trueAreaFromFootprint(footprintSqft, pitchDeg)
    const trueAreaSqm = trueAreaSqft * 0.0929
    const dirName = degreesToCardinal(azimuthDeg)
    const facetLabel = facet.id || `Facet ${i + 1}`

    return {
      name: `${dirName} ${facetLabel}`,
      footprint_area_sqft: Math.round(footprintSqft),
      true_area_sqft: Math.round(trueAreaSqft),
      true_area_sqm: Math.round(trueAreaSqm * 10) / 10,
      pitch_degrees: Math.round(pitchDeg * 10) / 10,
      pitch_ratio: pitchToRatio(pitchDeg),
      azimuth_degrees: Math.round(azimuthDeg * 10) / 10,
      azimuth_direction: dirName,
      _pixel_area: Math.round(pxArea),
    } as RoofSegment
  })
}

/**
 * Per-facet display data for SVG overlay labels. Aligned 1:1 with aiGeometry.facets.
 */
export function computeFacetDisplayData(
  aiGeometry: AIMeasurementAnalysis,
  totalFootprintSqft: number,
  avgPitchDeg: number
): { footprint_sqft: number; true_area_sqft: number; pitch_deg: number; pitch_ratio: string }[] {
  const facets = aiGeometry.facets
  if (!facets || facets.length === 0) return []

  const scaleFactor = computePixelToSqftScale(aiGeometry, totalFootprintSqft)
  if (scaleFactor <= 0) return []

  return facets.map((facet) => {
    const pxArea = polygonPixelArea(facet.points || [])
    const footprintSqft = pxArea * scaleFactor
    const pitchDeg = parseFacetPitch(facet.pitch, avgPitchDeg)
    const trueAreaSqft = trueAreaFromFootprint(footprintSqft, pitchDeg)

    return {
      footprint_sqft: Math.round(footprintSqft),
      true_area_sqft: Math.round(trueAreaSqft),
      pitch_deg: Math.round(pitchDeg * 10) / 10,
      pitch_ratio: pitchToRatio(pitchDeg)
    }
  })
}
