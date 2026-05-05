import { describe, it, expect } from 'vitest'
import {
  RoofMeasurementEngine,
  traceUiToEnginePayload,
  type TracePayload,
} from './roof-measurement-engine'
import { validateTraceUi } from '../utils/trace-validation'

// ───────────────────────────────────────────────────────────────────
// Test helpers
// ───────────────────────────────────────────────────────────────────

/** 1 metre offset in degrees latitude — used to build wall lines of
 *  known length. At any lat, 1° lat ≈ 111,320 m. */
const M_PER_DEG_LAT = 111_320

function squareEaves(centerLat: number, centerLng: number, sideM: number) {
  const halfDeg = (sideM / 2) / M_PER_DEG_LAT
  const halfLng = halfDeg / Math.cos(centerLat * Math.PI / 180)
  return [
    { lat: centerLat - halfDeg, lng: centerLng - halfLng },
    { lat: centerLat - halfDeg, lng: centerLng + halfLng },
    { lat: centerLat + halfDeg, lng: centerLng + halfLng },
    { lat: centerLat + halfDeg, lng: centerLng - halfLng },
  ]
}

/** Build a horizontal line of `lengthM` metres at (lat, lng) running due east. */
function horizontalLine(lat: number, lng: number, lengthM: number) {
  const dLng = (lengthM / M_PER_DEG_LAT) / Math.cos(lat * Math.PI / 180)
  return [
    { lat, lng },
    { lat, lng: lng + dLng },
  ]
}

const M_TO_FT = 3.28084

// ═══════════════════════════════════════════════════════════════════
// SCHEMA / VALIDATION TESTS
// ═══════════════════════════════════════════════════════════════════
describe('flashings — UI trace validation', () => {
  it('accepts walls + pipe_boots in the UI trace shape', () => {
    const eaves = squareEaves(40, -75, 10)
    const r = validateTraceUi({
      eaves,
      walls: [
        { pts: horizontalLine(40, -75, 6), kind: 'step' },
        { pts: horizontalLine(40.0001, -75, 4), kind: 'headwall' },
      ],
      annotations: {
        chimneys: [{ lat: 40, lng: -75 }],
        pipe_boots: [{ lat: 40, lng: -75 }, { lat: 40.0001, lng: -75 }],
      },
    })
    expect(r.valid).toBe(true)
    expect(r.walls_count).toBe(2)
    // chimneys (1) + pipe_boots (2) = 3 valid annotations
    expect(r.annotations_count).toBe(3)
  })

  it('warns on unknown wall kind but does not error', () => {
    const eaves = squareEaves(40, -75, 10)
    const r = validateTraceUi({
      eaves,
      walls: [{ pts: horizontalLine(40, -75, 6), kind: 'sidewall' as any }],
    })
    expect(r.valid).toBe(true)
    expect(r.warnings.some(w => w.code === 'bad_wall_kind')).toBe(true)
  })

  it('flags wall lines with < 2 points as warning (ignored)', () => {
    const eaves = squareEaves(40, -75, 10)
    const r = validateTraceUi({
      eaves,
      walls: [{ pts: [{ lat: 40, lng: -75 }], kind: 'step' }],
    })
    expect(r.warnings.some(w => w.code === 'walls_line_too_short')).toBe(true)
  })

  it('omitting walls / pipe_boots is back-compatible (no errors)', () => {
    const eaves = squareEaves(40, -75, 10)
    const r = validateTraceUi({ eaves })
    expect(r.valid).toBe(true)
    expect(r.walls_count).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════
// PAYLOAD CONVERSION
// ═══════════════════════════════════════════════════════════════════
describe('flashings — traceUiToEnginePayload', () => {
  it('computes haversine wall lengths and forwards counts', () => {
    const eaves = squareEaves(40, -75, 10)
    const payload = traceUiToEnginePayload(
      {
        eaves,
        walls: [
          { pts: horizontalLine(40, -75, 12), kind: 'step' },     // 12 m ≈ 39.4 ft
          { pts: horizontalLine(40.0002, -75, 6), kind: 'headwall' }, // 6 m ≈ 19.7 ft
        ],
        annotations: {
          chimneys: [{ lat: 40, lng: -75 }],
          pipe_boots: [
            { lat: 40, lng: -75 },
            { lat: 40, lng: -75.0001 },
            { lat: 40, lng: -75.0002 },
          ],
        },
      },
      {},
      4,
    )
    expect(payload.flashing_lengths_ft?.step).toBeGreaterThan(38)
    expect(payload.flashing_lengths_ft?.step).toBeLessThan(41)
    expect(payload.flashing_lengths_ft?.headwall).toBeGreaterThan(18)
    expect(payload.flashing_lengths_ft?.headwall).toBeLessThan(21)
    expect(payload.flashing_counts?.chimneys).toBe(1)
    expect(payload.flashing_counts?.pipe_boots).toBe(3)
    expect(payload.walls?.length).toBe(2)
  })

  it('defaults missing wall kind to "step"', () => {
    const payload = traceUiToEnginePayload(
      {
        eaves: squareEaves(40, -75, 10),
        walls: [{ pts: horizontalLine(40, -75, 5) } as any],
      },
      {},
      4,
    )
    expect(payload.walls?.[0].kind).toBe('step')
  })

  it('zeroes out flashings when not provided (back-compat)', () => {
    const payload = traceUiToEnginePayload(
      { eaves: squareEaves(40, -75, 10) },
      {},
      4,
    )
    expect(payload.flashing_lengths_ft?.step).toBe(0)
    expect(payload.flashing_lengths_ft?.headwall).toBe(0)
    expect(payload.flashing_counts?.chimneys).toBe(0)
    expect(payload.flashing_counts?.pipe_boots).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════
// END-TO-END ENGINE OUTPUT
// ═══════════════════════════════════════════════════════════════════
describe('flashings — engine output (linear_measurements + materials)', () => {
  it('surfaces step + headwall LF and chimney/pipe-boot counts', () => {
    const stepLine  = horizontalLine(40, -75, 9)   // 9 m ≈ 29.5 ft
    const headLine  = horizontalLine(40.0001, -75, 4) // 4 m ≈ 13.1 ft
    const STEP_FT_EXPECTED = 9 * M_TO_FT
    const HEAD_FT_EXPECTED = 4 * M_TO_FT
    const payload: TracePayload = {
      address: 'Flash Test',
      default_pitch: 6,
      eaves_outline: squareEaves(40, -75, 10),
      walls: [
        { id: 'w1', pitch: null, pts: stepLine.map(p => ({ ...p, elevation: null })), kind: 'step' },
        { id: 'w2', pitch: null, pts: headLine.map(p => ({ ...p, elevation: null })), kind: 'headwall' },
      ],
      flashing_lengths_ft: { step: STEP_FT_EXPECTED, headwall: HEAD_FT_EXPECTED },
      flashing_counts: { chimneys: 2, pipe_boots: 5 },
    }
    const r = new RoofMeasurementEngine(payload).run()

    // linear_measurements totals match the input footages
    expect(r.linear_measurements.step_flashing_total_ft).toBeCloseTo(STEP_FT_EXPECTED, 0)
    expect(r.linear_measurements.headwall_flashing_total_ft).toBeCloseTo(HEAD_FT_EXPECTED, 0)
    expect(r.linear_measurements.chimney_flashing_count).toBe(2)
    expect(r.linear_measurements.pipe_boot_count).toBe(5)

    // materials_estimate carries the flashing rows with waste pad applied
    const m = r.materials_estimate
    expect(m.step_flashing_lf).toBeGreaterThan(STEP_FT_EXPECTED)       // +10% waste pad
    expect(m.step_flashing_lf).toBeLessThan(STEP_FT_EXPECTED * 1.2)    // not too aggressive
    expect(m.headwall_flashing_lf).toBeGreaterThan(HEAD_FT_EXPECTED)   // +5% pad
    expect(m.headwall_flashing_lf).toBeLessThan(HEAD_FT_EXPECTED * 1.1)
    expect(m.chimney_flashing_count).toBe(2)
    expect(m.pipe_boot_count).toBe(5)
  })

  it('emits zeros + does not break when no flashings traced', () => {
    const payload: TracePayload = {
      address: 'No Flash Test',
      default_pitch: 6,
      eaves_outline: squareEaves(40, -75, 10),
    }
    const r = new RoofMeasurementEngine(payload).run()
    expect(r.linear_measurements.step_flashing_total_ft).toBe(0)
    expect(r.linear_measurements.headwall_flashing_total_ft).toBe(0)
    expect(r.linear_measurements.chimney_flashing_count).toBe(0)
    expect(r.linear_measurements.pipe_boot_count).toBe(0)
    expect(r.materials_estimate.step_flashing_lf).toBe(0)
    expect(r.materials_estimate.headwall_flashing_lf).toBe(0)
  })

  it('treats negative / NaN flashing inputs as zero (defensive)', () => {
    const payload: TracePayload = {
      address: 'Bad Input',
      default_pitch: 6,
      eaves_outline: squareEaves(40, -75, 10),
      flashing_lengths_ft: { step: -5, headwall: NaN as any },
      flashing_counts:     { chimneys: -3, pipe_boots: NaN as any },
    }
    const r = new RoofMeasurementEngine(payload).run()
    // negative/NaN coerce to 0 (counts) or pass-through length but
    // can't go below 0 for counts. Length is rounded to 1 decimal —
    // NaN headwall should not crash the engine.
    expect(r.linear_measurements.chimney_flashing_count).toBe(0)
    expect(r.linear_measurements.pipe_boot_count).toBe(0)
    expect(Number.isFinite(r.materials_estimate.step_flashing_lf)).toBe(true)
    expect(Number.isFinite(r.materials_estimate.headwall_flashing_lf)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════
// PRESSURE TEST — full UI → engine → BOM pipeline
// ═══════════════════════════════════════════════════════════════════
describe('flashings — full pipeline pressure test', () => {
  it('survives a busy roof with 12 wall lines + 4 chimneys + 8 pipe boots', () => {
    const eaves = squareEaves(45, -73, 14)
    const walls: any[] = []
    // Twelve 3-metre wall sections — alternating step / headwall
    for (let i = 0; i < 12; i++) {
      const lat = 45 + (i * 0.00001)
      walls.push({
        pts: horizontalLine(lat, -73, 3),
        kind: i % 2 === 0 ? 'step' : 'headwall',
      })
    }
    const chimneys = Array.from({ length: 4 }, (_, i) => ({
      lat: 45 + i * 0.00002, lng: -73,
    }))
    const pipeBoots = Array.from({ length: 8 }, (_, i) => ({
      lat: 45, lng: -73 + i * 0.00002,
    }))

    const validation = validateTraceUi({ eaves, walls, annotations: { chimneys, pipe_boots: pipeBoots } })
    expect(validation.valid).toBe(true)
    expect(validation.walls_count).toBe(12)

    const payload = traceUiToEnginePayload(
      { eaves, walls, annotations: { chimneys, pipe_boots: pipeBoots } },
      { property_address: 'Pressure', latitude: 45, longitude: -73 },
      6,
    )
    const r = new RoofMeasurementEngine(payload).run()

    // Each wall ≈ 3m → 9.84 ft; 6 step + 6 headwall
    const expectedStepFt = 6 * 3 * M_TO_FT
    const expectedHeadFt = 6 * 3 * M_TO_FT
    expect(r.linear_measurements.step_flashing_total_ft).toBeCloseTo(expectedStepFt, 0)
    expect(r.linear_measurements.headwall_flashing_total_ft).toBeCloseTo(expectedHeadFt, 0)

    expect(r.materials_estimate.chimney_flashing_count).toBe(4)
    expect(r.materials_estimate.pipe_boot_count).toBe(8)

    // Engine still produces sane core measurements (sanity guard — flashings
    // changes shouldn't have polluted the eave/area pipeline).
    expect(r.key_measurements.total_projected_footprint_ft2).toBeGreaterThan(1500)
    expect(r.key_measurements.total_projected_footprint_ft2).toBeLessThan(2500)
  })
})
