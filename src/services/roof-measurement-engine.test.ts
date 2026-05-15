import { describe, it, expect } from 'vitest'
import { RoofMeasurementEngine, traceUiToEnginePayload, type TracePayload } from './roof-measurement-engine'

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

describe('multi-structure eaves — secondary perimeters add to total', () => {
  it('sums eave LF across primary house + detached garage', () => {
    const house  = squareEavesAt(40, -75, 12)  // 12 m square ⇒ ~157 ft perimeter
    const garage = squareEavesAt(40.001, -75.001, 6) // 6 m square ⇒ ~79 ft perimeter

    const houseOnly = new RoofMeasurementEngine({
      address: 'Test', default_pitch: 6, eaves_outline: house,
    }).run()
    const houseAndGarage = new RoofMeasurementEngine({
      address: 'Test', default_pitch: 6, eaves_outline: house,
      eaves_sections: [house, garage],
    }).run()

    // Garage perimeter (~79 ft) must be added to the house perimeter
    // (~157 ft). Total should be ~236 ft, not the house-only 157.
    expect(houseAndGarage.linear_measurements.eaves_total_ft).toBeGreaterThan(
      houseOnly.linear_measurements.eaves_total_ft + 70
    )
    expect(houseAndGarage.linear_measurements.eaves_total_ft).toBeCloseTo(
      houseOnly.linear_measurements.eaves_total_ft + 79, 0
    )
  })

  it('ignores the primary outline if also passed in eaves_sections (no double-count)', () => {
    const house = squareEavesAt(40, -75, 12)
    const houseOnly = new RoofMeasurementEngine({
      address: 'Test', default_pitch: 6, eaves_outline: house,
    }).run()
    // Pass primary outline ALSO inside eaves_sections — engine filters it out.
    const dup = new RoofMeasurementEngine({
      address: 'Test', default_pitch: 6, eaves_outline: house,
      eaves_sections: [house],
    }).run()
    expect(dup.linear_measurements.eaves_total_ft).toBeCloseTo(
      houseOnly.linear_measurements.eaves_total_ft, 0
    )
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

// ────────────────────────────────────────────────────────────────────
// Wall-height unification: opposing walls on the same building must
// share one height. traceUiToEnginePayload MAX-collapses per-wall
// heightFt and rewrites every wall to the unified value so the area
// math + downstream renderers see one consistent number.
// ────────────────────────────────────────────────────────────────────
describe('wall height unification', () => {
  it('MAX-unifies mismatched per-wall heightFt', () => {
    const eaves = squareEavesAt(45.45997, -73.86285, 12)
    const trace: any = {
      eaves_sections: [eaves],
      walls: [
        // Two walls at MISMATCHED heights — should both end up at 4 (MAX).
        { pts: [{ lat: 45.459915, lng: -73.862733 }, { lat: 45.459855, lng: -73.862861 }], kind: 'step', heightFt: 3 },
        { pts: [{ lat: 45.459991, lng: -73.862794 }, { lat: 45.459926, lng: -73.862936 }], kind: 'step', heightFt: 4 },
      ],
    }
    const payload = traceUiToEnginePayload(trace, { property_address: 'Test' }, 6, undefined)
    // Every wall on the payload now reports the same unified heightFt
    const heights = (payload.walls || []).map((w: any) => w.heightFt)
    expect(heights.length).toBe(2)
    expect(heights[0]).toBe(4)
    expect(heights[1]).toBe(4)
    // wall_area_ft2.net should reflect length × 4, not length × 3 or × 4 individually
    const w0Len = (payload.walls![0] as any).pts && computeLenFt(payload.walls![0].pts)
    const w1Len = (payload.walls![1] as any).pts && computeLenFt(payload.walls![1].pts)
    const expectedGross = (w0Len + w1Len) * 4
    expect(payload.wall_area_ft2?.gross_ft2).toBeCloseTo(expectedGross, 0)
  })

  it('defaults unified height to 8 when no wall has heightFt set', () => {
    const eaves = squareEavesAt(45.45997, -73.86285, 12)
    const trace: any = {
      eaves_sections: [eaves],
      walls: [
        // Bare array — legacy shape, no heightFt
        [{ lat: 45.459915, lng: -73.862733 }, { lat: 45.459855, lng: -73.862861 }],
      ],
    }
    const payload = traceUiToEnginePayload(trace, { property_address: 'Test' }, 6, undefined)
    const h = (payload.walls?.[0] as any).heightFt
    expect(h).toBe(8)
  })

  it('engine totalSloped includes unified wall area in shingle count', () => {
    const eaves = squareEavesAt(45.45997, -73.86285, 12)
    const trace: any = {
      eaves_sections: [eaves],
      walls: [
        { pts: [{ lat: 45.459915, lng: -73.862733 }, { lat: 45.459855, lng: -73.862861 }], kind: 'step', heightFt: 8 },
      ],
    }
    const payloadWithWalls   = traceUiToEnginePayload(trace, { property_address: 'Test' }, 6, undefined)
    const payloadWithoutWalls = traceUiToEnginePayload({ ...trace, walls: [] }, { property_address: 'Test' }, 6, undefined)
    const r1 = new RoofMeasurementEngine(payloadWithWalls).run()
    const r2 = new RoofMeasurementEngine(payloadWithoutWalls).run()
    // Wall net area is added to total sloped area, so squares with walls > squares without.
    expect(r1.key_measurements.total_roof_area_sloped_ft2).toBeGreaterThan(r2.key_measurements.total_roof_area_sloped_ft2)
    // Wall key_measurements fields are emitted
    expect(r1.key_measurements.wall_area_net_ft2).toBeGreaterThan(0)
    expect(r1.key_measurements.wall_area_gross_ft2).toBeGreaterThan(0)
    // No walls → no wall area fields populated (or 0)
    expect(r2.key_measurements.wall_area_net_ft2 || 0).toBe(0)
  })

  it('windows on walls deduct from net wall area', () => {
    const eaves = squareEavesAt(45.45997, -73.86285, 12)
    const trace: any = {
      eaves_sections: [eaves],
      walls: [
        { pts: [{ lat: 45.459915, lng: -73.862733 }, { lat: 45.459855, lng: -73.862861 }], kind: 'step', heightFt: 8 },
      ],
      windows: [
        { lat: 45.459885, lng: -73.862797, width_ft: 3, height_ft: 4, wall_idx: 0 },
        { lat: 45.459890, lng: -73.862810, width_ft: 3, height_ft: 4, wall_idx: 0 },
      ],
    }
    const payload = traceUiToEnginePayload(trace, { property_address: 'Test' }, 6, undefined)
    // 2 windows × 12 sf = 24 sf deduction
    expect(payload.wall_area_ft2?.window_count).toBe(2)
    expect(payload.wall_area_ft2?.window_deduction_ft2).toBeCloseTo(24, 1)
    expect((payload.wall_area_ft2?.gross_ft2 || 0) - (payload.wall_area_ft2?.net_ft2 || 0)).toBeCloseTo(24, 1)
  })
})

// Haversine helper for length-in-feet between two lat/lng points.
function computeLenFt(pts: Array<{ lat: number; lng: number }>): number {
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]
    const dLat = (b.lat - a.lat) * Math.PI / 180
    const dLng = (b.lng - a.lng) * Math.PI / 180
    const lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
    total += 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h))) * 3.28084
  }
  return total
}
