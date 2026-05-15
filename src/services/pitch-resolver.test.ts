import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolvePitch } from './pitch-resolver'
import * as solarApi from './solar-api'

vi.mock('./solar-api', () => ({
  fetchSolarPitchAndImagery: vi.fn(),
}))

const mockSolar = (pitchDeg: number, opts: Partial<solarApi.SolarPitchAndImagery> = {}) => {
  ;(solarApi.fetchSolarPitchAndImagery as any).mockResolvedValueOnce({
    pitch_degrees: pitchDeg,
    pitch_ratio: `${Math.round(12 * Math.tan(pitchDeg * Math.PI / 180) * 10) / 10}:12`,
    segment_pitches: [],
    imagery: {} as any,
    imagery_quality: 'HIGH',
    imagery_date: '2024-01-01',
    api_duration_ms: 100,
    roof_footprint_ft2: 1800,
    ...opts,
  })
}

const failSolar = (msg = 'Google Solar API error 404: not found') => {
  ;(solarApi.fetchSolarPitchAndImagery as any).mockRejectedValueOnce(new Error(msg))
}

// Shared coords (Edmonton). Doesn't matter what they are — Solar is mocked.
const COORDS = { centroidLat: 53.55, centroidLng: -113.49, solarApiKey: 'test', mapsApiKey: 'test' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolvePitch — Solar succeeds', () => {
  it('Solar = 26.57° (6:12), no user default → Solar chosen, high confidence, no audit', async () => {
    mockSolar(26.57)
    const r = await resolvePitch({ ...COORDS })
    expect(r.pitch_source).toBe('solar_api')
    expect(r.pitch_confidence).toBe('high')
    expect(r.pitch_rise).toBe(6.0)
    expect(r.audit).toBeNull()
  })

  it('Solar = 6:12, user default = 6.5:12 (within new 1.0 threshold) → no audit', async () => {
    mockSolar(26.57)
    const r = await resolvePitch({ ...COORDS, userDefaultRise: 6.5 })
    expect(r.pitch_source).toBe('solar_api')
    expect(r.audit).toBeNull()
  })

  it('Solar = 6:12, user default = 4:12 (delta ≥ 1.0) → audit "mismatch" raised, Solar still chosen', async () => {
    mockSolar(26.57)
    const r = await resolvePitch({ ...COORDS, userDefaultRise: 4 })
    expect(r.pitch_source).toBe('solar_api')
    expect(r.pitch_rise).toBe(6.0)
    expect(r.audit?.status).toBe('mismatch')
    expect(r.audit?.delta).toBe(2.0)
  })
})

describe('resolvePitch — user-default floor (order-322 regression)', () => {
  it('Solar fails, user default = 0.5 → engine fallback (5.0), audit "low_pitch_floor_blocked"', async () => {
    failSolar()
    const r = await resolvePitch({ ...COORDS, userDefaultRise: 0.5 })
    expect(r.pitch_source).toBe('engine_default')
    expect(r.pitch_rise).toBe(5.0)
    expect(r.audit?.status).toBe('low_pitch_floor_blocked')
    expect(r.audit?.user_default_rise).toBe(0.5)
  })

  it('Solar fails, user default = 1.99 → blocked (boundary)', async () => {
    failSolar()
    const r = await resolvePitch({ ...COORDS, userDefaultRise: 1.99 })
    expect(r.pitch_source).toBe('engine_default')
    expect(r.audit?.status).toBe('low_pitch_floor_blocked')
  })

  it('Solar fails, user default = 2.0 → accepted (boundary)', async () => {
    failSolar()
    const r = await resolvePitch({ ...COORDS, userDefaultRise: 2.0 })
    expect(r.pitch_source).toBe('user_default')
    expect(r.pitch_rise).toBe(2.0)
    expect(r.audit).toBeNull()
  })

  it('Solar fails, user default = 7.0 → user default chosen', async () => {
    failSolar()
    const r = await resolvePitch({ ...COORDS, userDefaultRise: 7.0 })
    expect(r.pitch_source).toBe('user_default')
    expect(r.pitch_rise).toBe(7.0)
    expect(r.audit).toBeNull()
  })

  it('Solar fails, no user default → engine fallback', async () => {
    failSolar()
    const r = await resolvePitch({ ...COORDS })
    expect(r.pitch_source).toBe('engine_default')
    expect(r.pitch_rise).toBe(5.0)
    expect(r.pitch_confidence).toBe('low')
  })
})

describe('resolvePitch — DSM reconciliation', () => {
  it('Solar = 0.5:12, DSM = 30° (~6.9:12) → DSM chosen, "low_pitch_solar_disagrees" audit', async () => {
    // 0.5:12 in degrees: atan(0.5/12) ≈ 2.39°
    mockSolar(2.39)
    const r = await resolvePitch({ ...COORDS, dsmPitchDeg: 30 })
    expect(r.pitch_source).toBe('dsm')
    expect(r.pitch_confidence).toBe('medium')
    expect(r.pitch_rise).toBeCloseTo(6.9, 1)
    expect(r.audit?.status).toBe('low_pitch_solar_disagrees')
    expect(r.audit?.solar_rise).toBe(0.5)
    expect(r.audit?.dsm_rise).toBeCloseTo(6.9, 1)
  })

  it('Solar fails, DSM = 25° → DSM chosen, no audit', async () => {
    failSolar()
    const r = await resolvePitch({ ...COORDS, dsmPitchDeg: 25 })
    expect(r.pitch_source).toBe('dsm')
    expect(r.pitch_confidence).toBe('medium')
    expect(r.pitch_rise).toBeCloseTo(5.6, 1)
    expect(r.audit).toBeNull()
  })

  it('Solar = 6:12, DSM = 26° → Solar chosen (passes guard, no override)', async () => {
    mockSolar(26.57)
    const r = await resolvePitch({ ...COORDS, dsmPitchDeg: 26 })
    expect(r.pitch_source).toBe('solar_api')
    expect(r.pitch_rise).toBe(6.0)
    // DSM transparency still exposed
    expect(r.dsm_pitch_rise).toBeCloseTo(5.9, 1)
  })

  it('Solar = 1:12 (low), DSM = 1.5° (also low) → Solar still chosen (genuine low-slope)', async () => {
    // 1:12 ≈ 4.76°; DSM 1.5° → ~0.3:12, also below guard. No override possible.
    mockSolar(4.76)
    const r = await resolvePitch({ ...COORDS, dsmPitchDeg: 1.5 })
    expect(r.pitch_source).toBe('solar_api')
    expect(r.pitch_rise).toBe(1.0)
    expect(r.audit).toBeNull()
  })

  it('exposes dsm_pitch_rise + dsm_pitch_deg even when DSM is not the chosen source', async () => {
    mockSolar(26.57)
    const r = await resolvePitch({ ...COORDS, dsmPitchDeg: 27 })
    expect(r.dsm_pitch_deg).toBe(27)
    expect(r.dsm_pitch_rise).toBeCloseTo(6.1, 1)
  })
})

describe('resolvePitch — output invariants', () => {
  it('always returns dsm_pitch_rise + dsm_pitch_deg fields (null when DSM absent)', async () => {
    mockSolar(26.57)
    const r = await resolvePitch({ ...COORDS })
    expect(r.dsm_pitch_rise).toBeNull()
    expect(r.dsm_pitch_deg).toBeNull()
  })

  it('floor-blocked audit still fires when DSM wins (user is notified their input was discarded)', async () => {
    failSolar()
    const r = await resolvePitch({ ...COORDS, userDefaultRise: 0.5, dsmPitchDeg: 25 })
    expect(r.pitch_source).toBe('dsm')
    expect(r.audit?.status).toBe('low_pitch_floor_blocked')
    expect(r.audit?.chosen_rise).toBeCloseTo(5.6, 1)
    expect(r.audit?.dsm_rise).toBeCloseTo(5.6, 1)
  })
})
