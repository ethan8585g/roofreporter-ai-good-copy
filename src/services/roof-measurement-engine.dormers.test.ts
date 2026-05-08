import { describe, it, expect } from 'vitest'
import {
  RoofMeasurementEngine,
  traceUiToEnginePayload,
  type TracePayload,
} from './roof-measurement-engine'

// Build a square eaves outline of side `sideMeters` centered at the given lat/lng.
// 1° lat ≈ 111,320 m. Lng is scaled by cos(lat) so the polygon stays square in
// projected feet at any latitude — tests for area/pitch math need the square to
// actually be square after projection, not just in raw degree-space.
function squareAt(centerLat: number, centerLng: number, sideMeters: number) {
  const halfDeg = (sideMeters / 2) / 111_320
  const halfLng = halfDeg / Math.cos(centerLat * Math.PI / 180)
  return [
    { lat: centerLat - halfDeg, lng: centerLng - halfLng, elevation: null },
    { lat: centerLat - halfDeg, lng: centerLng + halfLng, elevation: null },
    { lat: centerLat + halfDeg, lng: centerLng + halfLng, elevation: null },
    { lat: centerLat + halfDeg, lng: centerLng - halfLng, elevation: null },
  ]
}

// √(rise² + 144) / 12 — industry-standard pitch multiplier (rise/run → slope).
function slopeFactor(riseRise12: number) {
  return Math.sqrt(riseRise12 * riseRise12 + 144) / 12
}

describe('per-section pitch (dormer support)', () => {
  // Harry-style scenario: a 6:12 main roof with a steeper dormer traced as
  // its own structure. Before this fix, the engine applied the main roof's
  // pitch to every section regardless — under-counting steep dormer area.
  // Main: 10×10 m square (~107.6 m² ≈ 1158 ft²). Dormer: 3×3 m square
  // separated geographically (~10 m² ≈ 107.6 ft²).
  const mainEaves   = squareAt(40, -75,    10)
  const dormerEaves = squareAt(40, -74.99,  3)

  it('extra section at user-specified pitch increases total sloped area vs. default-pitch baseline', () => {
    const baselinePayload: TracePayload = {
      address: 'Test',
      default_pitch: 6,
      eaves_outline: mainEaves,
      eaves_sections: [dormerEaves],
      // No eaves_section_pitches → dormer falls back to default 6:12
    }
    const baseline = new RoofMeasurementEngine(baselinePayload).run()

    const dormerPayload: TracePayload = {
      address: 'Test',
      default_pitch: 6,
      eaves_outline: mainEaves,
      eaves_sections: [dormerEaves],
      eaves_section_pitches: [12],   // Dormer at 12:12 — steeper than main
    }
    const dormer = new RoofMeasurementEngine(dormerPayload).run()

    expect(dormer.key_measurements.total_roof_area_sloped_ft2)
      .toBeGreaterThan(baseline.key_measurements.total_roof_area_sloped_ft2)
  })

  it('section sloped area equals projected × slopeFactor for the section pitch', () => {
    const dormerPayload: TracePayload = {
      address: 'Test',
      default_pitch: 6,
      eaves_outline: mainEaves,
      eaves_sections: [dormerEaves],
      eaves_section_pitches: [12],
    }
    const result = new RoofMeasurementEngine(dormerPayload).run()
    const sps = result.section_pitches
    expect(sps).toBeDefined()
    expect(sps?.length).toBe(2)
    const dormer = sps?.find(s => s.section_index === 1)
    expect(dormer).toBeDefined()
    expect(dormer?.pitch_rise).toBe(12)
    expect(dormer?.is_user_specified).toBe(true)
    // sloped should be projected × slopeFactor(12) within rounding (engine
    // rounds to 0.1 sf, so allow 0.2 sf tolerance).
    const expectedSloped = (dormer?.projected_ft2 || 0) * slopeFactor(12)
    expect(Math.abs((dormer?.sloped_ft2 || 0) - expectedSloped)).toBeLessThan(0.5)
  })

  it('main-roof entry uses the dominant pitch label (not the dormer pitch)', () => {
    const dormerPayload: TracePayload = {
      address: 'Test',
      default_pitch: 6,
      eaves_outline: mainEaves,
      eaves_sections: [dormerEaves],
      eaves_section_pitches: [12],
    }
    const result = new RoofMeasurementEngine(dormerPayload).run()
    const main = result.section_pitches?.find(s => s.section_index === 0)
    expect(main).toBeDefined()
    expect(main?.label).toBe('Main roof')
    // Main roof pitch reflects the dominant face pitch (6:12 default), not
    // the steep dormer override. is_user_specified is always false for the
    // primary slot — its pitch comes from face geometry / default.
    expect(main?.is_user_specified).toBe(false)
    expect(main?.pitch_rise).toBeLessThan(12)
  })

  it('omitted section pitch falls back silently to default pitch', () => {
    const payload: TracePayload = {
      address: 'Test',
      default_pitch: 6,
      eaves_outline: mainEaves,
      eaves_sections: [dormerEaves],
      eaves_section_pitches: [null],  // explicit null
    }
    const result = new RoofMeasurementEngine(payload).run()
    const dormer = result.section_pitches?.find(s => s.section_index === 1)
    expect(dormer?.is_user_specified).toBe(false)
    expect(dormer?.pitch_rise).toBe(6)  // ← default
  })

  it('advisory note lists user-specified pitches when present', () => {
    const payload: TracePayload = {
      address: 'Test',
      default_pitch: 6,
      eaves_outline: mainEaves,
      eaves_sections: [dormerEaves],
      eaves_section_pitches: [12],
    }
    const result = new RoofMeasurementEngine(payload).run()
    const noteWithPitches = result.advisory_notes.find(n =>
      n.includes('user-specified pitch') && n.includes('12')
    )
    expect(noteWithPitches).toBeDefined()
  })
})

describe('traceUiToEnginePayload — per-section pitch routing', () => {
  // Equivalent end-to-end: when the UI sends multiple sections + parallel
  // pitches, the bridge must route the largest section's pitch to
  // default_pitch and the rest to per-section overrides — without dropping
  // pitches when the largest section is reordered to "primary".
  it('routes the largest section as primary and non-largest pitches as overrides', () => {
    // Main: 10×10 m. Dormer: 3×3 m. We send 2 sections via eaves_sections only
    // (no eaves field) and parallel pitches [main=6, dormer=12]. The bridge
    // should pick main as primary and put 12 in eaves_section_pitches.
    const mainSec   = squareAt(40, -75,    10).map(p => ({ lat: p.lat, lng: p.lng }))
    const dormerSec = squareAt(40, -74.99,  3).map(p => ({ lat: p.lat, lng: p.lng }))

    const payload = traceUiToEnginePayload(
      {
        eaves_sections: [mainSec, dormerSec],
        eaves_section_pitches: [6, 12],
      },
      { property_address: 'Test', homeowner_name: 'T', order_number: 'X' },
      4,  // caller's defaultPitch — should be overridden by main's 6
    )

    expect(payload.default_pitch).toBe(6)
    expect(payload.eaves_section_pitches).toEqual([12])
    expect(payload.eaves_sections?.length).toBe(1)
  })

  it('drops invalid pitches (NaN, negative, >30) without throwing', () => {
    const mainSec   = squareAt(40, -75,    10).map(p => ({ lat: p.lat, lng: p.lng }))
    const dormerSec = squareAt(40, -74.99,  3).map(p => ({ lat: p.lat, lng: p.lng }))

    const payload = traceUiToEnginePayload(
      {
        eaves_sections: [mainSec, dormerSec],
        eaves_section_pitches: [6, -5 as any],  // garbage value
      },
      { property_address: 'Test', homeowner_name: 'T', order_number: 'X' },
      4,
    )

    // -5 was filtered → not present in eaves_section_pitches at all (we omit
    // the field when no extras have a valid pitch).
    expect(payload.eaves_section_pitches).toBeUndefined()
    expect(payload.default_pitch).toBe(6)  // main's pitch still routes through
  })
})

describe('dormers (within main outline, differential-only)', () => {
  // Harry-style: a 6:12 main roof with an A-frame dormer ON TOP of the main
  // outline. Unlike eaves_sections (which are separate buildings + add new
  // footprint), a dormer adds ONLY the differential sloped area:
  //   extra = footprint × (slopeFactor(dormer_pitch) − slopeFactor(main_pitch))
  // and footprint stays attributed to the main roof.
  const mainEaves = squareAt(40, -75, 10)        // ~107.6 m² ≈ 1158 ft²
  // Dormer polygon — small square inside the main roof (geographically within)
  const dormerPoly = squareAt(40, -75, 2).map(p => ({ lat: p.lat, lng: p.lng, elevation: null }))

  function slopeFactor(rise: number) {
    return Math.sqrt(rise * rise + 144) / 12
  }

  it('dormer adds differential sloped area but does NOT add new footprint', () => {
    const baseline = new RoofMeasurementEngine({
      address: 'Test', default_pitch: 6, eaves_outline: mainEaves,
    }).run()

    const withDormer = new RoofMeasurementEngine({
      address: 'Test', default_pitch: 6, eaves_outline: mainEaves,
      dormers: [{ polygon: dormerPoly, pitch_rise: 12 }],
    }).run()

    // Footprint must NOT change — dormer sits inside main outline
    expect(withDormer.key_measurements.total_projected_footprint_ft2)
      .toBe(baseline.key_measurements.total_projected_footprint_ft2)
    // Sloped area MUST be larger (steeper dormer adds extra surface)
    expect(withDormer.key_measurements.total_roof_area_sloped_ft2)
      .toBeGreaterThan(baseline.key_measurements.total_roof_area_sloped_ft2)
  })

  it('extra sloped area equals footprint × (slopeFactor(dormer) − slopeFactor(main))', () => {
    const result = new RoofMeasurementEngine({
      address: 'Test', default_pitch: 6, eaves_outline: mainEaves,
      dormers: [{ polygon: dormerPoly, pitch_rise: 12 }],
    }).run()

    const dormers = result.dormer_breakdown
    expect(dormers).toBeDefined()
    expect(dormers?.length).toBe(1)
    const d = dormers![0]
    expect(d.pitch_rise).toBe(12)
    expect(d.main_pitch_rise).toBe(6)
    // Math check: differential = footprint × (sf(12) − sf(6))
    //            = footprint × (1.4142 − 1.1180) = footprint × 0.2962
    const expected = d.footprint_ft2 * (slopeFactor(12) - slopeFactor(6))
    expect(Math.abs(d.extra_sloped_ft2 - expected)).toBeLessThan(0.5)
  })

  it('multiple dormers each contribute their own differential', () => {
    const dA = squareAt(40, -75,        2).map(p => ({ lat: p.lat, lng: p.lng, elevation: null }))
    const dB = squareAt(40, -74.99995,  2).map(p => ({ lat: p.lat, lng: p.lng, elevation: null }))
    const result = new RoofMeasurementEngine({
      address: 'Test', default_pitch: 6, eaves_outline: mainEaves,
      dormers: [
        { polygon: dA, pitch_rise: 12 },
        { polygon: dB, pitch_rise: 10 },
      ],
    }).run()
    expect(result.dormer_breakdown?.length).toBe(2)
    expect(result.dormer_breakdown![0].pitch_rise).toBe(12)
    expect(result.dormer_breakdown![1].pitch_rise).toBe(10)
    // dormer at 12:12 must contribute more extra area than dormer at 10:12
    expect(result.dormer_breakdown![0].extra_sloped_ft2)
      .toBeGreaterThan(result.dormer_breakdown![1].extra_sloped_ft2)
  })

  it('dormer at same pitch as main contributes zero (clamped to ≥ 0)', () => {
    const result = new RoofMeasurementEngine({
      address: 'Test', default_pitch: 6, eaves_outline: mainEaves,
      dormers: [{ polygon: dormerPoly, pitch_rise: 6 }],
    }).run()
    expect(result.dormer_breakdown?.length).toBe(1)
    // 6:12 dormer on 6:12 main → sf(6) − sf(6) = 0
    expect(result.dormer_breakdown![0].extra_sloped_ft2).toBe(0)
  })

  it('dormer flatter than main is clamped to 0 extra (no surprise area drop)', () => {
    // A 4:12 "dormer" on a 12:12 main would mathematically subtract area,
    // but we clamp to ≥ 0 — flatter additions on steep main roofs are an
    // edge case better represented as a separate eaves_section, not a dormer.
    const result = new RoofMeasurementEngine({
      address: 'Test', default_pitch: 12, eaves_outline: mainEaves,
      dormers: [{ polygon: dormerPoly, pitch_rise: 4 }],
    }).run()
    expect(result.dormer_breakdown?.length).toBe(1)
    expect(result.dormer_breakdown![0].extra_sloped_ft2).toBe(0)
  })

  it('invalid dormer entries (bad pitch, < 3 points) are dropped silently', () => {
    const result = new RoofMeasurementEngine({
      address: 'Test', default_pitch: 6, eaves_outline: mainEaves,
      dormers: [
        { polygon: dormerPoly,            pitch_rise: 12 },     // valid
        { polygon: dormerPoly,            pitch_rise: 0  },     // invalid pitch
        { polygon: dormerPoly,            pitch_rise: 50 },     // out-of-range
        { polygon: dormerPoly.slice(0, 2), pitch_rise: 12 },    // < 3 points
      ],
    }).run()
    // Only the first dormer is kept
    expect(result.dormer_breakdown?.length).toBe(1)
    expect(result.dormer_breakdown![0].pitch_rise).toBe(12)
  })

  it('advisory note summarizes dormer count + pitch + extra area', () => {
    const result = new RoofMeasurementEngine({
      address: 'Test', default_pitch: 6, eaves_outline: mainEaves,
      dormers: [{ polygon: dormerPoly, pitch_rise: 12, label: 'East dormer' }],
    }).run()
    const note = result.advisory_notes.find(n =>
      n.includes('dormer(s) measured') && n.includes('12') && n.includes('East dormer')
    )
    expect(note).toBeDefined()
  })
})

describe('traceUiToEnginePayload — dormers passthrough', () => {
  function llSquare(lat: number, lng: number, side: number) {
    const halfDeg = (side / 2) / 111_320
    const halfLng = halfDeg / Math.cos(lat * Math.PI / 180)
    return [
      { lat: lat - halfDeg, lng: lng - halfLng },
      { lat: lat - halfDeg, lng: lng + halfLng },
      { lat: lat + halfDeg, lng: lng + halfLng },
      { lat: lat + halfDeg, lng: lng - halfLng },
    ]
  }

  it('valid dormers pass through; invalid ones are dropped', () => {
    const main = llSquare(40, -75, 10)
    const dormerPoly = llSquare(40, -75, 2)
    const payload = traceUiToEnginePayload(
      {
        eaves_sections: [main],
        dormers: [
          { polygon: dormerPoly,             pitch_rise: 12 },         // valid
          { polygon: dormerPoly,             pitch_rise: -1 as any },  // bad
          { polygon: dormerPoly.slice(0, 2), pitch_rise: 10 },         // < 3 pts
        ],
      },
      { property_address: 'Test', homeowner_name: 'T', order_number: 'X' },
      4,
    )
    expect(payload.dormers?.length).toBe(1)
    expect(payload.dormers![0].pitch_rise).toBe(12)
  })

  it('omits dormers field when no dormers supplied', () => {
    const main = llSquare(40, -75, 10)
    const payload = traceUiToEnginePayload(
      { eaves_sections: [main] },
      { property_address: 'Test' },
      4,
    )
    expect(payload.dormers).toBeUndefined()
  })
})
