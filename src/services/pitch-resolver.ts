// ============================================================
// Pitch Resolver — Centralizes the Google Solar pitch fetch +
// fallback logic that was previously duplicated across
// /calculate-from-trace, /auto-trace, and the report generator.
//
// Returns the best pitch the system can produce, plus enough
// provenance data (source, confidence, delta vs user default)
// to drive downstream "how sure are we?" UI.
// ============================================================

import { fetchSolarPitchAndImagery } from './solar-api'

export type PitchSource = 'solar_api' | 'user_default' | 'engine_default'
export type PitchConfidence = 'high' | 'medium' | 'low'

export interface ResolvedPitch {
  pitch_rise: number              // chosen pitch (in rise:12 units)
  pitch_source: PitchSource       // which input won
  pitch_confidence: PitchConfidence
  solar_pitch_rise: number | null
  solar_pitch_deg: number | null
  solar_footprint_ft2: number     // 0 when unavailable
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
}

const DEFAULT_FALLBACK_RISE = 5.0
const MISMATCH_THRESHOLD_RISE = 1.5

export async function resolvePitch(input: PitchResolverInput): Promise<ResolvedPitch> {
  const {
    centroidLat, centroidLng,
    solarApiKey, mapsApiKey,
    houseSqftHint = 1500,
    userDefaultRise,
    engineFallbackRise = DEFAULT_FALLBACK_RISE,
    logTag = 'PitchResolver',
  } = input

  const apiKey = solarApiKey || mapsApiKey
  let solar_pitch_rise: number | null = null
  let solar_pitch_deg:  number | null = null
  let solar_footprint_ft2 = 0

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
    } catch (e: any) {
      console.warn(`[${logTag}] Solar API failed: ${e.message}`)
    }
  }

  // Choose which pitch wins
  let pitch_rise: number
  let pitch_source: PitchSource
  let pitch_confidence: PitchConfidence
  if (solar_pitch_rise != null) {
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
    audit,
  }
}
