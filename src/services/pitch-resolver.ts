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

export type PitchSource = 'solar_api' | 'dsm' | 'user_default' | 'engine_default'
export type PitchConfidence = 'high' | 'medium' | 'low'

export type PitchAuditStatus =
  | 'mismatch'                    // Solar ≠ user default by ≥ MISMATCH_THRESHOLD_RISE
  | 'low_pitch_solar_disagrees'   // Solar said low, DSM said high — DSM won
  | 'low_pitch_floor_blocked'     // user default < MIN_PLAUSIBLE_RISE was ignored

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
  /** DSM-derived pitch (from DataLayers GeoTIFF gradient analysis) when caller supplied it. */
  dsm_pitch_rise: number | null
  dsm_pitch_deg: number | null
  /**
   * Non-null when the resolver flagged a low-pitch override, an ignored
   * sub-floor user default, or a Solar/user-default disagreement.
   */
  audit: null | {
    status: PitchAuditStatus
    solar_rise: number | null
    user_default_rise: number | null
    dsm_rise: number | null
    chosen_rise: number
    delta: number | null
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
  /**
   * DSM (Digital Surface Model) average pitch in degrees, when the caller
   * has already run `executeRoofOrder` and has access to the gradient
   * analysis. Acts as a reconciliation signal: if Solar returns an
   * implausibly low pitch, DSM can veto it. Optional — callers that don't
   * have it get the legacy Solar-only behaviour.
   */
  dsmPitchDeg?: number | null
  /** Engine's hard fallback when nothing else works. */
  engineFallbackRise?: number
  logTag?: string
}

const DEFAULT_FALLBACK_RISE = 5.0
const MISMATCH_THRESHOLD_RISE = 1.0
/** Hard floor for any user-supplied default. Sub-floor values are treated
 *  as "not provided" so the engine fallback takes over. Residential roofs
 *  below 2:12 are exceedingly rare and almost always indicate a data error
 *  (e.g. order 322 shipping 0.5:12 vs owner-confirmed 7:12). */
const MIN_PLAUSIBLE_RISE = 2.0
/** Any chosen pitch below this triggers extra scrutiny: if a disagreeing
 *  source exists, raise an audit so downstream surfaces flag it. */
const LOW_PITCH_GUARD_RISE = 3.0

export async function resolvePitch(input: PitchResolverInput): Promise<ResolvedPitch> {
  const {
    centroidLat, centroidLng,
    solarApiKey, mapsApiKey,
    houseSqftHint = 1500,
    userDefaultRise,
    dsmPitchDeg,
    engineFallbackRise = DEFAULT_FALLBACK_RISE,
    logTag = 'PitchResolver',
  } = input

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
        // HIGH = 0.1 m/px (confident), MEDIUM = 0.25 m/px (acceptable),
        // BASE = 1 m/px (coarse — field verification recommended)
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

  // DSM signal: convert degrees → rise:12 using the same formula as Solar
  let dsm_pitch_rise: number | null = null
  let dsm_pitch_deg:  number | null = null
  if (dsmPitchDeg != null && isFinite(dsmPitchDeg) && dsmPitchDeg > 0) {
    dsm_pitch_deg  = dsmPitchDeg
    dsm_pitch_rise = Math.round(12 * Math.tan(dsmPitchDeg * Math.PI / 180) * 10) / 10
    console.log(`[${logTag}] DSM pitch: ${dsmPitchDeg.toFixed(1)}° → ${dsm_pitch_rise}:12`)
  }

  // User-default floor: reject implausibly low values so a bad form input
  // (e.g. order 322's 0.5:12) doesn't get accepted as a legitimate default.
  let userDefaultFloorBlocked = false
  let userDefaultValid: number | null = null
  if (userDefaultRise != null && isFinite(userDefaultRise) && userDefaultRise > 0) {
    if (userDefaultRise >= MIN_PLAUSIBLE_RISE) {
      userDefaultValid = userDefaultRise
    } else {
      userDefaultFloorBlocked = true
      console.warn(`[${logTag}] User default ${userDefaultRise}:12 is below MIN_PLAUSIBLE_RISE (${MIN_PLAUSIBLE_RISE}:12) — ignoring`)
    }
  }

  // Resolution chain with DSM reconciliation
  let pitch_rise: number
  let pitch_source: PitchSource
  let pitch_confidence: PitchConfidence
  let lowPitchSolarDisagrees = false

  if (solar_pitch_rise != null && solar_pitch_rise >= LOW_PITCH_GUARD_RISE) {
    // Solar passed the low-pitch guard — trust it.
    pitch_rise = solar_pitch_rise
    pitch_source = 'solar_api'
    pitch_confidence = 'high'
  } else if (
    solar_pitch_rise != null
    && solar_pitch_rise < LOW_PITCH_GUARD_RISE
    && dsm_pitch_rise != null
    && dsm_pitch_rise >= LOW_PITCH_GUARD_RISE
  ) {
    // Solar returned a suspiciously low pitch but DSM disagrees — flip to DSM.
    // This is the order-322 hardening path.
    pitch_rise = dsm_pitch_rise
    pitch_source = 'dsm'
    pitch_confidence = 'medium'
    lowPitchSolarDisagrees = true
    console.warn(`[${logTag}] Solar low-pitch (${solar_pitch_rise}:12) overridden by DSM (${dsm_pitch_rise}:12)`)
  } else if (solar_pitch_rise != null) {
    // Solar present, low, and DSM either agrees or is absent — use Solar
    // (preserves legacy behaviour for genuine low-slope roofs).
    pitch_rise = solar_pitch_rise
    pitch_source = 'solar_api'
    pitch_confidence = 'high'
  } else if (dsm_pitch_rise != null) {
    // Solar failed entirely (404, timeout) — DSM is the next-best signal.
    pitch_rise = dsm_pitch_rise
    pitch_source = 'dsm'
    pitch_confidence = 'medium'
  } else if (userDefaultValid != null) {
    pitch_rise = userDefaultValid
    pitch_source = 'user_default'
    pitch_confidence = 'medium'
  } else {
    pitch_rise = engineFallbackRise
    pitch_source = 'engine_default'
    pitch_confidence = 'low'
  }

  // Audit emission — most-specific status wins
  let audit: ResolvedPitch['audit'] = null
  if (lowPitchSolarDisagrees && solar_pitch_rise != null && dsm_pitch_rise != null) {
    audit = {
      status: 'low_pitch_solar_disagrees',
      solar_rise: solar_pitch_rise,
      user_default_rise: userDefaultRise ?? null,
      dsm_rise: dsm_pitch_rise,
      chosen_rise: pitch_rise,
      delta: Math.round((dsm_pitch_rise - solar_pitch_rise) * 10) / 10,
      msg: `Google Solar pitch (${solar_pitch_rise}:12) is below the ${LOW_PITCH_GUARD_RISE}:12 plausibility floor; DSM (${dsm_pitch_rise}:12) disagrees and was used instead. Field-verify before ordering materials.`,
    }
  } else if (userDefaultFloorBlocked && userDefaultRise != null) {
    audit = {
      status: 'low_pitch_floor_blocked',
      solar_rise: solar_pitch_rise,
      user_default_rise: userDefaultRise,
      dsm_rise: dsm_pitch_rise,
      chosen_rise: pitch_rise,
      delta: null,
      msg: `Provided default pitch (${userDefaultRise}:12) is below the ${MIN_PLAUSIBLE_RISE}:12 plausibility floor and was ignored. Resolver fell back to ${pitch_source === 'engine_default' ? `engine default (${pitch_rise}:12)` : `${pitch_source} (${pitch_rise}:12)`}.`,
    }
  } else if (
    solar_pitch_rise != null
    && userDefaultRise != null
    && Math.abs(solar_pitch_rise - userDefaultRise) >= MISMATCH_THRESHOLD_RISE
  ) {
    audit = {
      status: 'mismatch',
      solar_rise: solar_pitch_rise,
      user_default_rise: userDefaultRise,
      dsm_rise: dsm_pitch_rise,
      chosen_rise: pitch_rise,
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
    dsm_pitch_rise,
    dsm_pitch_deg,
    audit,
  }
}
