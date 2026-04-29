import { describe, it, expect } from 'vitest'
import { RoofMeasurementEngine, type TracePayload } from './roof-measurement-engine'

// Build a 10m × 10m square eaves outline centered at (0, 0). At lat 0,
// 1m ≈ 9.0e-6° lat and 9.0e-6° lng — close enough for 4-vertex tests.
function squareEavesAt(centerLat: number, centerLng: number, sideMeters: number) {
  const halfDeg = (sideMeters / 2) / 111_320
  const halfLng = halfDeg / Math.cos(centerLat * Math.PI / 180)
  return [
    { lat: centerLat - halfDeg, lng: centerLng - halfLng },
    { lat: centerLat - halfDeg, lng: centerLng + halfLng },
    { lat: centerLat + halfDeg, lng: centerLng + halfLng },
    { lat: centerLat + halfDeg, lng: centerLng - halfLng },
  ]
}

describe('reconciliation gate — needs_review', () => {
  it('flags >10% footprint mismatch as needs_review', () => {
    const eaves = squareEavesAt(40, -75, 10)        // ~100 m² ≈ 1076 ft²
    const payload: TracePayload = {
      address: 'Test',
      default_pitch: 6,
      eaves_outline: eaves,
      // Pretend external source claims 700 ft² — ~35% delta
      cross_check: { source: 'google_solar', footprint_ft2: 700 },
    }
    const engine = new RoofMeasurementEngine(payload)
    const r = engine.run()
    expect(r.needs_review).toBe(true)
    expect(r.review_flag?.reason).toBe('footprint_mismatch')
    expect(r.review_flag?.delta_pct).toBeGreaterThan(10)
    expect(r.review_flag?.external_source).toBe('google_solar')
  })

  it('does NOT flag <10% footprint mismatch', () => {
    const eaves = squareEavesAt(40, -75, 10)
    const payload: TracePayload = {
      address: 'Test',
      default_pitch: 6,
      eaves_outline: eaves,
      cross_check: { source: 'google_solar', footprint_ft2: 1100 }, // ~2% delta
    }
    const r = new RoofMeasurementEngine(payload).run()
    expect(r.needs_review).toBeUndefined()
    expect(r.review_flag).toBeUndefined()
    expect(r.cross_check?.verdict).toBe('aligned')
  })

  it('does NOT flag when no cross_check source given', () => {
    const r = new RoofMeasurementEngine({
      address: 'Test',
      default_pitch: 6,
      eaves_outline: squareEavesAt(40, -75, 10),
    }).run()
    expect(r.needs_review).toBeUndefined()
  })
})

describe('eaves_tags reclassify edge totals', () => {
  it('explicit rake tags subtract from eaves and add to rakes', () => {
    const eaves = squareEavesAt(40, -75, 10)
    const baseline = new RoofMeasurementEngine({
      address: 'Test',
      default_pitch: 6,
      eaves_outline: eaves,
    }).run()

    // 4 edges; tag #1 and #3 as rake, #0 and #2 as eave.
    const tagged = new RoofMeasurementEngine({
      address: 'Test',
      default_pitch: 6,
      eaves_outline: eaves,
      eaves_tags: ['eave', 'rake', 'eave', 'rake'],
    }).run()

    expect(tagged.linear_measurements.eaves_total_ft).toBeLessThan(baseline.linear_measurements.eaves_total_ft)
    expect(tagged.linear_measurements.rakes_total_ft).toBeGreaterThan(baseline.linear_measurements.rakes_total_ft)
    // Sum (eave + rake) is preserved within rounding tolerance.
    const baselineSum = baseline.linear_measurements.eaves_total_ft + baseline.linear_measurements.rakes_total_ft
    const taggedSum = tagged.linear_measurements.eaves_total_ft + tagged.linear_measurements.rakes_total_ft
    expect(Math.abs(baselineSum - taggedSum)).toBeLessThan(1)
  })

  it('mismatched tag length is silently ignored (no off-by-one mis-attribution)', () => {
    const eaves = squareEavesAt(40, -75, 10)
    const baseline = new RoofMeasurementEngine({
      address: 'Test',
      default_pitch: 6,
      eaves_outline: eaves,
    }).run()
    const r = new RoofMeasurementEngine({
      address: 'Test',
      default_pitch: 6,
      eaves_outline: eaves,
      eaves_tags: ['eave', 'rake'], // too short
    }).run()
    expect(r.linear_measurements.eaves_total_ft).toBeCloseTo(baseline.linear_measurements.eaves_total_ft, 1)
  })
})

describe('plane_segments_lat_lng — per-facet pitch override', () => {
  it('accepts plane_segments_lat_lng without throwing and falls back when no overlap', () => {
    const eaves = squareEavesAt(40, -75, 10)
    const r = new RoofMeasurementEngine({
      address: 'Test',
      default_pitch: 6,
      eaves_outline: eaves,
      // Plane centroid far from the trace — should be ignored.
      plane_segments_lat_lng: [
        { pitch_rise: 12, centroid: { lat: 41, lng: -76 }, area_m2: 50 },
      ],
    }).run()
    // Default pitch is 6; one of the face details should reflect that
    // (no DSM override applied because plane is outside the polygon).
    expect(r.face_details.length).toBeGreaterThanOrEqual(1)
    expect(r.face_details[0].pitch_rise).toBeCloseTo(6, 1)
  })
})
