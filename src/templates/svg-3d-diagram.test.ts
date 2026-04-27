import { describe, it, expect } from 'vitest'
import {
  isSliverFace,
  generateAxonometricRoofSVG,
  type StructurePartition,
} from './svg-3d-diagram'

// Helper: build a minimal StructurePartition with the geometry the
// generator needs. Defaults give a clean 30 × 20 ft hip roof.
function partition(overrides: Partial<StructurePartition> = {}): StructurePartition {
  const REF = { lat: 53.5161, lng: -113.3145 }
  const FT_PER_DEG_LAT = 364_000
  const ftToLat = (ft: number) => ft / FT_PER_DEG_LAT
  const ftToLng = (ft: number, lat: number) =>
    ft / (FT_PER_DEG_LAT * Math.cos(lat * Math.PI / 180))
  const offset = (dxFt: number, dyFt: number) => ({
    lat: REF.lat + ftToLat(dyFt),
    lng: REF.lng + ftToLng(dxFt, REF.lat),
  })
  return {
    index: 1,
    label: 'Test',
    eaves: [offset(0, 0), offset(30, 0), offset(30, 20), offset(0, 20)],
    ridges: [],
    hips: [],
    valleys: [],
    rakes: [],
    footprint_sqft: 600,
    true_area_sqft: 670,
    perimeter_ft: 100,
    dominant_pitch_deg: 31,
    dominant_pitch_label: '7:12',
    area_share: 1,
    eave_lf: 100,
    ridge_lf: 0,
    hip_lf: 0,
    valley_lf: 0,
    rake_lf: 0,
    ...overrides,
  }
}

describe('isSliverFace', () => {
  it('flags a 24 ft × 3 ft tall thin face (the Foxboro artifact)', () => {
    // The actual artifact: vertices stretched along Y, narrow on X.
    const face = {
      vertices: [
        { x: 0,   y: 0,    z: 0 },
        { x: 0.9, y: 0,    z: 0 },
        { x: 0.9, y: 7.32, z: 2.0 },
        { x: 0,   y: 7.32, z: 2.0 },
      ],
      area_sqft: 30,
    }
    expect(isSliverFace(face)).toBe(true)
  })

  it('does NOT flag a near-equilateral 6 ft hip-end triangle', () => {
    const face = {
      vertices: [
        { x: 0,   y: 0,   z: 0 },
        { x: 1.8, y: 0,   z: 0 },
        { x: 0.9, y: 1.5, z: 1.2 },
      ],
      area_sqft: 18,
    }
    expect(isSliverFace(face)).toBe(false)
  })

  it('does NOT flag a long thin-but-real 30 × 6 ft ridge face', () => {
    // Long ridge face: 9.14 m long × 1.83 m wide. Aspect 5 BUT area 180
    // sqft — area threshold (50) keeps this in.
    const face = {
      vertices: [
        { x: 0,    y: 0,   z: 0 },
        { x: 9.14, y: 0,   z: 0 },
        { x: 9.14, y: 1.83, z: 1.5 },
        { x: 0,    y: 1.83, z: 1.5 },
      ],
      area_sqft: 180,
    }
    expect(isSliverFace(face)).toBe(false)
  })

  it('flags a degenerate (collinear) triangle', () => {
    const face = {
      vertices: [
        { x: 0,  y: 0, z: 0 },
        { x: 5,  y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
      ],
      area_sqft: 0,
    }
    expect(isSliverFace(face)).toBe(true)
  })

  it('does NOT flag a face that is wide AND tall (a real plane)', () => {
    const face = {
      vertices: [
        { x: 0, y: 0, z: 0 },
        { x: 6, y: 0, z: 0 },
        { x: 6, y: 4, z: 1.5 },
        { x: 0, y: 4, z: 1.5 },
      ],
      area_sqft: 65,
    }
    expect(isSliverFace(face)).toBe(false)
  })
})

describe('generateAxonometricRoofSVG — regression on clean rectangle', () => {
  it('produces a non-empty SVG for a basic rectangular hip roof', () => {
    const svg = generateAxonometricRoofSVG(partition())
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('Test')               // label
    expect(svg.length).toBeGreaterThan(2000)    // non-trivial content
  })

  it('emits at least 4 polygon faces for a hip rectangle', () => {
    const svg = generateAxonometricRoofSVG(partition())
    const polygons = svg.match(/<polygon /g) || []
    // Background, walls, AO underlays, faces, eave outline — should comfortably exceed 4.
    expect(polygons.length).toBeGreaterThan(4)
  })
})

describe('generateAxonometricRoofSVG — Foxboro-style complex polygon does NOT emit slivers', () => {
  it('produces no high-aspect narrow polygons for a T-shape with diagonal ridges', () => {
    const REF = { lat: 53.5161, lng: -113.3145 }
    const FT_PER_DEG_LAT = 364_000
    const ftToLat = (ft: number) => ft / FT_PER_DEG_LAT
    const ftToLng = (ft: number, lat: number) =>
      ft / (FT_PER_DEG_LAT * Math.cos(lat * Math.PI / 180))
    const at = (dxFt: number, dyFt: number) => ({
      lat: REF.lat + ftToLat(dyFt),
      lng: REF.lng + ftToLng(dxFt, REF.lat),
    })

    // T-shape: 23 ft wide top, 58 ft tall right side, 35 ft tall left side,
    // bottom ~16 ft wide. Loosely mimics 269 Foxboro Crescent footprint.
    const part = partition({
      eaves: [
        at(0,  0),
        at(23, 0),
        at(23, 58),
        at(15, 58),
        at(15, 35),
        at(8,  35),
        at(0,  35),
      ],
      // Two diagonal ridges + one short cross ridge
      ridges: [
        [at(11, 5),  at(11, 30)],
        [at(7,  40), at(15, 50)],
        [at(11, 53), at(15, 56)],
      ],
      // Several traced hips at corners — far more hips than ridges (the
      // condition that triggers the original sliver bug).
      hips: [
        [at(0, 0),    at(11, 5)],
        [at(23, 0),   at(11, 5)],
        [at(0, 35),   at(7, 40)],
        [at(8, 35),   at(7, 40)],
        [at(15, 35),  at(15, 50)],
        [at(23, 58),  at(15, 56)],
        [at(15, 58),  at(15, 56)],
      ],
      footprint_sqft: 1900,
      true_area_sqft: 2200,
    })

    const svg = generateAxonometricRoofSVG(part)
    // Only inspect ROOF FACE polygons. Walls use fill="#E2E8F0", the shadow
    // uses fill="rgba(...)", the AO underlay has fill="none". Roof faces are
    // the pitch-shaded ones with fill="rgb(r,g,b)".
    const polyRe = /<polygon\s+points="([^"]+)"\s+fill="(rgb\([^)]+\))"/g
    let match: RegExpExecArray | null
    let slivers = 0
    let facesChecked = 0
    while ((match = polyRe.exec(svg)) !== null) {
      const pts = match[1].trim().split(/\s+/).map(p => {
        const [x, y] = p.split(',').map(Number)
        return { x, y }
      })
      if (pts.length < 3) continue
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const p of pts) {
        if (p.x < minX) minX = p.x
        if (p.x > maxX) maxX = p.x
        if (p.y < minY) minY = p.y
        if (p.y > maxY) maxY = p.y
      }
      const w = maxX - minX, h = maxY - minY
      const longer = Math.max(w, h), shorter = Math.min(w, h)
      if (shorter < 1) continue
      facesChecked++
      // Screen-space sliver: aspect > 8 AND shorter side < 18 px is the
      // visual artifact threshold (a clear "spike" that reads as wrong to
      // the human eye).
      if (longer / shorter > 8 && shorter < 18) {
        slivers++
      }
    }
    expect(facesChecked).toBeGreaterThan(0)
    expect(slivers).toBe(0)
  })
})
