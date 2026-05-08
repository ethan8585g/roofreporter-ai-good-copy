import { describe, it, expect } from 'vitest'
import {
  RoofMeasurementEngine,
  traceUiToEnginePayload,
} from './roof-measurement-engine'

// Build a square polygon of side `sideMeters` centered at the given lat/lng.
// Lng scaled by cos(lat) so the polygon is actually square after projection.
function squareAt(centerLat: number, centerLng: number, sideMeters: number) {
  const halfDeg = (sideMeters / 2) / 111_320
  const halfLng = halfDeg / Math.cos(centerLat * Math.PI / 180)
  return [
    { lat: centerLat - halfDeg, lng: centerLng - halfLng },
    { lat: centerLat - halfDeg, lng: centerLng + halfLng },
    { lat: centerLat + halfDeg, lng: centerLng + halfLng },
    { lat: centerLat + halfDeg, lng: centerLng - halfLng },
  ]
}

function rectAt(centerLat: number, centerLng: number, widthM: number, heightM: number) {
  const halfH = (heightM / 2) / 111_320
  const halfW = (widthM / 2) / 111_320 / Math.cos(centerLat * Math.PI / 180)
  return [
    { lat: centerLat - halfH, lng: centerLng - halfW },
    { lat: centerLat - halfH, lng: centerLng + halfW },
    { lat: centerLat + halfH, lng: centerLng + halfW },
    { lat: centerLat + halfH, lng: centerLng - halfW },
  ]
}

const slopeFactor = (rise: number) => Math.sqrt(rise * rise + 144) / 12

describe('verified_faces (Verify Planes path)', () => {
  // Single 10×10 m square eaves (~1076 ft² footprint), split by the user
  // into two 5×10 m halves (W and E facets), each at its own pitch.
  // Engine should compute exactly: shoelace(face) × slopeFactor(face_pitch)
  // per face — no inference, no remainder distribution.
  const mainEaves = squareAt(40, -75, 10)
  // Western half: lng spans [centerLng - halfLng, centerLng]
  const halfDegLat = 5 / 111_320
  const halfDegLng = 5 / 111_320 / Math.cos(40 * Math.PI / 180)
  const westFace = [
    { lat: 40 - halfDegLat, lng: -75 - halfDegLng },
    { lat: 40 - halfDegLat, lng: -75 },
    { lat: 40 + halfDegLat, lng: -75 },
    { lat: 40 + halfDegLat, lng: -75 - halfDegLng },
  ]
  const eastFace = [
    { lat: 40 - halfDegLat, lng: -75 },
    { lat: 40 - halfDegLat, lng: -75 + halfDegLng },
    { lat: 40 + halfDegLat, lng: -75 + halfDegLng },
    { lat: 40 + halfDegLat, lng: -75 },
  ]

  it('uses user-supplied face polygons + pitches; total sloped area = sum of shoelace × slopeFactor per face', () => {
    const payload = traceUiToEnginePayload(
      {
        eaves: mainEaves,
        eaves_sections: [mainEaves],
        verified_faces: [
          { polygon: westFace, pitch_rise: 4,  label: 'West' },
          { polygon: eastFace, pitch_rise: 12, label: 'East' },
        ],
      } as any,
      { property_address: 'verified-faces-test' },
      6,
    )
    expect(payload.faces).toBeDefined()
    expect(payload.faces!.length).toBe(2)
    const report = new RoofMeasurementEngine(payload).run()

    // Each face is 5×10 m = 50 m² ≈ 538.2 ft² projected.
    // West sloped: 538.2 × slopeFactor(4)  ≈ 538.2 × 1.054  ≈ 567.3
    // East sloped: 538.2 × slopeFactor(12) ≈ 538.2 × 1.414  ≈ 760.8
    const expectedWestSloped = 50 * 10.7639 * slopeFactor(4)
    const expectedEastSloped = 50 * 10.7639 * slopeFactor(12)
    const expectedTotal = expectedWestSloped + expectedEastSloped

    expect(report.face_details.length).toBe(2)
    // Per-face area exact (within engine's 0.1 ft² rounding)
    const sortedFaces = [...report.face_details].sort((a, b) => a.pitch_rise - b.pitch_rise)
    expect(sortedFaces[0].pitch_rise).toBe(4)
    expect(sortedFaces[1].pitch_rise).toBe(12)
    expect(Math.abs(sortedFaces[0].sloped_area_ft2 - expectedWestSloped)).toBeLessThan(2)
    expect(Math.abs(sortedFaces[1].sloped_area_ft2 - expectedEastSloped)).toBeLessThan(2)
    // Total sloped area = exact sum of per-face contributions, no inference fudge.
    // 5 ft² tolerance covers the engine's per-face rounding (round to 0.1 ft²
    // per face × 2 faces accumulates) — that's < 0.4% on ~1330 ft².
    expect(Math.abs(report.key_measurements.total_roof_area_sloped_ft2 - expectedTotal)).toBeLessThan(5)
  })

  it('drops verified faces with invalid pitch or <3 points', () => {
    const payload = traceUiToEnginePayload(
      {
        eaves: mainEaves,
        eaves_sections: [mainEaves],
        verified_faces: [
          { polygon: westFace, pitch_rise: 6 },
          { polygon: westFace, pitch_rise: 0 },           // bad pitch — drop
          { polygon: westFace, pitch_rise: 50 },          // bad pitch — drop
          { polygon: westFace.slice(0, 2), pitch_rise: 6 }, // <3 points — drop
        ],
      } as any,
      { property_address: 'validation-test' },
      6,
    )
    expect(payload.faces!.length).toBe(1)
  })

  it('falls through to auto-split when verified_faces is omitted (back-compat)', () => {
    const payload = traceUiToEnginePayload(
      { eaves: mainEaves, eaves_sections: [mainEaves] } as any,
      { property_address: 'fallback-test' },
      6,
    )
    expect(payload.faces).toEqual([])
    // Engine still runs successfully via the inference path.
    const report = new RoofMeasurementEngine(payload).run()
    expect(report.key_measurements.total_roof_area_sloped_ft2).toBeGreaterThan(0)
  })

  it('verified_faces coexist with dormers — dormer differential still applies on top', () => {
    const dormer = rectAt(40, -75, 1, 1)
    const payload = traceUiToEnginePayload(
      {
        eaves: mainEaves,
        eaves_sections: [mainEaves],
        verified_faces: [
          { polygon: westFace, pitch_rise: 6 },
          { polygon: eastFace, pitch_rise: 6 },
        ],
        dormers: [{ polygon: dormer, pitch_rise: 12, label: 'Dormer A' }],
      } as any,
      { property_address: 'dormer-coexist' },
      6,
    )
    const report = new RoofMeasurementEngine(payload).run()
    // Main two faces at 6:12: footprint 1076.4 ft² × slopeFactor(6) ≈ 1203.4
    const mainExpected = 100 * 10.7639 * slopeFactor(6)
    // Dormer footprint 1 m² ≈ 10.76 ft²; differential = 10.76 × (sf(12) − sf(6))
    const dormerExtra = 1 * 10.7639 * (slopeFactor(12) - slopeFactor(6))
    const expectedTotal = mainExpected + dormerExtra
    expect(Math.abs(report.key_measurements.total_roof_area_sloped_ft2 - expectedTotal)).toBeLessThan(3)
    expect(report.dormer_breakdown).toBeDefined()
    expect(report.dormer_breakdown!.length).toBe(1)
  })
})
