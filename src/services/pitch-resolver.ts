// ============================================================
// Pitch Resolver — Centralizes the Google Solar pitch fetch +
// fallback logic that was previously duplicated across
// /calculate-from-trace, /auto-trace, and the report generator.
//
// Returns the best pitch the system can produce, plus enough
// provenance data (source, confidence, delta vs user default)
// to drive downstream "how sure are we?" UI.
//
// Phase 1 update: new source priority when RANSAC data is available:
//   ransac_dsm (confidence ≥ 0.85) > solar_api > user_default > engine_default
// ============================================================

import { fetchSolarPitchAndImagery } from './solar-api'
import type { PlaneSegment } from './edge-classifier'

export type PitchSource = 'solar_api' | 'ransac_dsm' | 'user_default' | 'engine_default'
export type PitchConfidence = 'high' | 'medium' | 'low'

export interface PerSegmentPitch {
  segment_id: string
  pitch_rise: number
  pitch_deg: number
  source: PitchSource
  confidence: number
}

export interface ResolvedPitch {
  pitch_rise: number              // chosen pitch (in rise:12 units)
  pitch_source: PitchSource       // which input won
  pitch_confidence: PitchConfidence
  solar_pitch_rise: number | null
  solar_pitch_deg: number | null
  solar_footprint_ft2: number     // 0 when unavailable
  solar_imagery_quality: string | null   // 'HIGH' | 'MEDIUM' | 'BASE' | null
  solar_imagery_reliability: 'high' | 'medium' | 'low' | null
  solar_imagery_warning: string | null
  /**
   * Per-segment pitches when RANSAC data is available.
   * Array is empty when no RANSAC planes are provided.
   */
  per_segment_pitches: PerSegmentPitch[]
  /**
   * Non-null when Solar API pitch disagreed with the user-supplied default
   * by ≥ 1.5 rise — surface this in the UI so the customer can acknowledge.
   */
  audit: null | {
    status: 'mismatch'
    solar_rise: number
    user_default_rise: number
    delta: number
    msg: string
  }
}

export interface PitchResolverInput {
  centroidLat: number
  centroidLng: number
  solarApiKey?: string | null
  mapsApiKey?: string | null
  houseSqftHint?: number
  /** Caller-supplied default (e.g. from order form). Used if Solar fails. */
  userDefaultRise?: number | null
  /** Engine's hard fallback when nothing else works. */
  engineFallbackRise?: number
  logTag?: string
  /**
   * RANSAC plane segments from edge-classifier.ts.
   * When provided and at least one plane has confidence ≥ 0.85,
   * ransac_dsm takes priority over solar_api.
   */
  ransacPlanes?: PlaneSegment[] | null
  /** Imagery quality — required to compute per-segment confidence cap */
  imageryQuality?: 'HIGH' | 'MEDIUM' | 'BASE' | null
}

const DEFAULT_FALLBACK_RISE = 5.0
const MISMATCH_THRESHOLD_RISE = 1.5
const RANSAC_CONFIDENCE_THRESHOLD = 0.85

// imagery_quality_factor matches Phase 1 spec
const IMAGERY_QUALITY_FACTOR: Record<string, number> = {
  HIGH: 1.0,
  MEDIUM: 0.75,
  BASE: 0.4,
}

export async function resolvePitch(input: PitchResolverInput): Promise<ResolvedPitch> {
  const {
    centroidLat, centroidLng,
    solarApiKey, mapsApiKey,
    houseSqftHint = 1500,
    userDefaultRise,
    engineFallbackRise = DEFAULT_FALLBACK_RISE,
    logTag = 'PitchResolver',
    ransacPlanes,
    imageryQuality,
  } = input

  const qualityFactor = IMAGERY_QUALITY_FACTOR[imageryQuality || ''] ?? 1.0

  const apiKey = solarApiKey || mapsApiKey
  let solar_pitch_rise: number | null = null
  let solar_pitch_deg:  number | null = null
  let solar_footprint_ft2 = 0
  let solar_imagery_quality: string | null = null
  let solar_imagery_reliability: 'high' | 'medium' | 'low' | null = null
  let solar_imagery_warning: string | null = null

  if (apiKey && isFinite(centroidLat) && isFinite(centroidLng)) {
    try {
      const result = await fetchSolarPitchAndImagery(
        centroidLat, centroidLng,
        apiKey, mapsApiKey || apiKey,
        houseSqftHint
      )
      if (result.pitch_degrees > 0) {
        solar_pitch_deg  = result.pitch_degrees
        solar_pitch_rise = Math.round(12 * Math.tan(result.pitch_degrees * Math.PI / 180) * 10) / 10
        console.log(`[${logTag}] Solar API pitch: ${result.pitch_degrees}° → ${solar_pitch_rise}:12`)
      }
      if (result.roof_footprint_ft2 > 0) {
        solar_footprint_ft2 = result.roof_footprint_ft2
      }
      if (result.imagery_quality) {
        solar_imagery_quality = result.imagery_quality
        if (result.imagery_quality === 'HIGH') {
          solar_imagery_reliability = 'high'
        } else if (result.imagery_quality === 'MEDIUM') {
          solar_imagery_reliability = 'medium'
          solar_imagery_warning = 'Satellite imagery is MEDIUM resolution (0.25 m/px). Measurements are usable for estimates; field verify before ordering materials.'
        } else {
          solar_imagery_reliability = 'low'
          solar_imagery_warning = `Satellite imagery is ${result.imagery_quality} resolution — considerably coarser than HIGH (0.1 m/px). Field verification strongly recommended before committing material orders.`
        }
      }
    } catch (e: any) {
      console.warn(`[${logTag}] Solar API failed: ${e.message}`)
    }
  }

  // ── Build per-segment pitches from RANSAC planes ─────────────
  const per_segment_pitches: PerSegmentPitch[] = []

  if (ransacPlanes && ransacPlanes.length > 0) {
    const totalAreaM2 = ransacPlanes.reduce((s, p) => s + p.areaM2, 0)
    for (const plane of ransacPlanes) {
      const inlierRatio = totalAreaM2 > 0 ? plane.areaM2 / totalAreaM2 : 0
      const confidence = Math.min(inlierRatio + 0.4, qualityFactor)  // inlier ratio anchored with quality cap
      const pitchRise = Math.round(12 * Math.tan(plane.pitchDeg * Math.PI / 180) * 10) / 10
      per_segment_pitches.push({
        segment_id: `ransac_plane_${plane.id}`,
        pitch_rise: pitchRise,
        pitch_deg: Math.round(plane.pitchDeg * 10) / 10,
        source: 'ransac_dsm',
        confidence: Math.round(confidence * 100) / 100,
      })
    }
    console.log(`[${logTag}] RANSAC per-segment pitches: ${per_segment_pitches.map(s => `${s.pitch_rise}:12 (${s.confidence})`).join(', ')}`)
  }

  // ── Priority: ransac_dsm > solar_api > user_default > engine_default ──
  let pitch_rise: number
  let pitch_source: PitchSource
  let pitch_confidence: PitchConfidence

  // Find the dominant RANSAC pitch (largest plane that meets confidence threshold)
  const dominantRansacPlane = ransacPlanes && ransacPlanes.length > 0
    ? [...ransacPlanes].sort((a, b) => b.areaM2 - a.areaM2)[0]
    : null

  const ransacPitch = dominantRansacPlane
    ? per_segment_pitches.find(s => s.segment_id === `ransac_plane_${dominantRansacPlane.id}`)
    : null

  const ransacConfidenceOk = ransacPitch && ransacPitch.confidence >= RANSAC_CONFIDENCE_THRESHOLD

  if (ransacConfidenceOk && ransacPitch) {
    pitch_rise = ransacPitch.pitch_rise
    pitch_source = 'ransac_dsm'
    pitch_confidence = 'high'
    console.log(`[${logTag}] Using RANSAC pitch: ${pitch_rise}:12 (confidence=${ransacPitch.confidence})`)

    // ── ±1.5 rise audit against Solar API ──────────────────────
    // Phase 1 cross-checks RANSAC against Solar API instead of just
    // Solar API vs user default.
    if (solar_pitch_rise != null && Math.abs(pitch_rise - solar_pitch_rise) >= MISMATCH_THRESHOLD_RISE) {
      console.warn(`[${logTag}] RANSAC pitch (${pitch_rise}:12) differs from Solar API (${solar_pitch_rise}:12) by ${Math.abs(pitch_rise - solar_pitch_rise).toFixed(1)} rise — review recommended`)
    }
  } else if (solar_pitch_rise != null) {
    pitch_rise = solar_pitch_rise
    pitch_source = 'solar_api'
    pitch_confidence = 'high'
  } else if (userDefaultRise != null && isFinite(userDefaultRise) && userDefaultRise > 0) {
    pitch_rise = userDefaultRise
    pitch_source = 'user_default'
    pitch_confidence = 'medium'
  } else {
    pitch_rise = engineFallbackRise
    pitch_source = 'engine_default'
    pitch_confidence = 'low'
  }

  // Audit: call out large disagreement between Solar and user default
  let audit: ResolvedPitch['audit'] = null
  if (solar_pitch_rise != null && userDefaultRise != null
      && Math.abs(solar_pitch_rise - userDefaultRise) >= MISMATCH_THRESHOLD_RISE) {
    audit = {
      status: 'mismatch',
      solar_rise: solar_pitch_rise,
      user_default_rise: userDefaultRise,
      delta: Math.round((solar_pitch_rise - userDefaultRise) * 10) / 10,
      msg: `Google Solar pitch (${solar_pitch_rise}:12) differs from provided default (${userDefaultRise}:12) by ${Math.abs(solar_pitch_rise - userDefaultRise).toFixed(1)} rise. Using Solar value — review if this looks wrong.`,
    }
  }

  return {
    pitch_rise,
    pitch_source,
    pitch_confidence,
    solar_pitch_rise,
    solar_pitch_deg,
    solar_footprint_ft2,
    solar_imagery_quality,
    solar_imagery_reliability,
    solar_imagery_warning,
    per_segment_pitches,
    audit,
  }
}
