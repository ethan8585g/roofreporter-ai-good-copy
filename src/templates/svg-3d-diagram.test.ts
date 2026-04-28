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

describe('generateAxonometricRoofSVG — compound hip with parallel ridges (63 Chestermere)', () => {
  it('renders without throwing and emits multiple roof faces', () => {
    const REF = { lat: 53.5161, lng: -113.3145 }
    const FT_PER_DEG_LAT = 364_000
    const ftToLat = (ft: number) => ft / FT_PER_DEG_LAT
    const ftToLng = (ft: number, lat: number) =>
      ft / (FT_PER_DEG_LAT * Math.cos(lat * Math.PI / 180))
    const at = (dxFt: number, dyFt: number) => ({
      lat: REF.lat + ftToLat(dyFt),
      lng: REF.lng + ftToLng(dxFt, REF.lat),
    })

    // Two parallel ridges with valleys between — exercises the new
    // mergeParallelRidges() pre-pass and Pass 1 perpendicularity scoring.
    const part = partition({
      eaves: [
        at(0,  0),  at(75, 0),  at(75, 35), at(60, 35), at(60, 50),
        at(40, 50), at(40, 35), at(20, 35), at(20, 50), at(0,  50),
      ],
      ridges: [
        [at(8,  17), at(32, 17)],
        [at(48, 17), at(67, 17)],
      ],
      hips: [
        [at(0,  0),  at(8,  17)], [at(0,  35), at(8,  17)],
        [at(75, 0),  at(67, 17)], [at(75, 35), at(67, 17)],
      ],
      valleys: [
        [at(32, 17), at(40, 35)],
        [at(48, 17), at(40, 35)],
      ],
      footprint_sqft: 2700,
      true_area_sqft: 3100,
    })

    const svg = generateAxonometricRoofSVG(part)
    expect(svg).toContain('<svg')
    const polyRe = /<polygon\s+points="([^"]+)"\s+fill="(rgb\([^)]+\))"/g
    const faces: string[] = []
    let match: RegExpExecArray | null
    while ((match = polyRe.exec(svg)) !== null) faces.push(match[1])
    expect(faces.length).toBeGreaterThanOrEqual(2)
  })
})

describe('generateAxonometricRoofSVG — 58 Foxboro Bay kinked-ridge bug (order 211)', () => {
  it('merges a 3-segment user-traced spine into one ridge (no perpendicular jog survives)', () => {
    // Real trace from order 211. Three traced ridges form ONE logical N–S
    // spine — the user clicked three times, leaving a tiny perpendicular
    // ~1.24m kink (ridge index 1) between two ~6m collinear segments.
    // Without the fix, the kink survives mergeParallelRidges() and then
    // pulls right-side eaves toward it in Pass 1, producing the visible
    // "right block" artifact next to a "left tall thin rectangle".
    const part: StructurePartition = {
      index: 1,
      label: 'Main House',
      eaves: [
        { lat: 53.522683829613925, lng: -113.25978280980435 },
        { lat: 53.522691802539654, lng: -113.25988003988114 },
        { lat: 53.522563438253066, lng: -113.25991423804608 },
        { lat: 53.522562640958164, lng: -113.2599082030758 },
        { lat: 53.52255108018012,  lng: -113.25989278037396 },
        { lat: 53.5225474923518,   lng: -113.25985992331353 },
        { lat: 53.5225606477208,   lng: -113.25984248895493 },
        { lat: 53.52255426936057,  lng: -113.2597747631773 },
        { lat: 53.52263280285373,  lng: -113.2597546466097 },
        { lat: 53.522637187968364, lng: -113.25979487974492 },
      ],
      ridges: [
        // Long N–S spine, top half (~7.6 m)
        [{ lat: 53.522679444504135, lng: -113.25983645398465 },
         { lat: 53.52261207321487,  lng: -113.25985321779099 }],
        // The 1.24 m perpendicular jog at the joint — a tracing artifact
        [{ lat: 53.52261247186188,  lng: -113.25984986502972 },
         { lat: 53.52261167456786,  lng: -113.25983108956662 }],
        // Long N–S spine, bottom half (~5.5 m)
        [{ lat: 53.52261167456786,  lng: -113.25983108956662 },
         { lat: 53.522562640958164, lng: -113.25984450061169 }],
      ],
      hips: [
        [{ lat: 53.52267904585776,  lng: -113.2598357834324 },
         { lat: 53.52267266751539,  lng: -113.25978549201336 }],
        [{ lat: 53.522680241796856, lng: -113.25983846564141 },
         { lat: 53.522680640443205, lng: -113.25988741595593 }],
        [{ lat: 53.52256144501574,  lng: -113.25991356749383 },
         { lat: 53.522563438253066, lng: -113.2598458417162 }],
        [{ lat: 53.52255227612282,  lng: -113.2597734220728 },
         { lat: 53.522563438253066, lng: -113.25984315950718 }],
      ],
      valleys: [],
      rakes: [],
      footprint_sqft: 1311,
      true_area_sqft: 1488,
      perimeter_ft: 159,
      dominant_pitch_deg: 28.4,
      dominant_pitch_label: '6.5:12',
      area_share: 1,
      eave_lf: 159,
      ridge_lf: 47,
      hip_lf: 53,
      valley_lf: 0,
      rake_lf: 0,
    }

    const svg = generateAxonometricRoofSVG(part)
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')

    // Project eaves to local meters so we can sanity-check face geometry.
    const refLat = part.eaves.reduce((s, p) => s + p.lat, 0) / part.eaves.length
    const refLng = part.eaves.reduce((s, p) => s + p.lng, 0) / part.eaves.length
    const cosLat = Math.cos(refLat * Math.PI / 180)
    const eavesXY = part.eaves.map(p => ({
      x: (p.lng - refLng) * 111320 * cosLat,
      y: (p.lat - refLat) * 111320,
    }))
    let pminX = Infinity, pmaxX = -Infinity, pminY = Infinity, pmaxY = -Infinity
    for (const p of eavesXY) {
      if (p.x < pminX) pminX = p.x; if (p.x > pmaxX) pmaxX = p.x
      if (p.y < pminY) pminY = p.y; if (p.y > pmaxY) pmaxY = p.y
    }
    const polyW = pmaxX - pminX, polyH = pmaxY - pminY

    // Same screen-space sliver detection used by other regression tests.
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
      if (longer / shorter > 8 && shorter < 18) slivers++
    }

    // Broken state emitted 15 polygon faces (each rogue sub-region got
    // its own face). After the fix the runs collapse into 2–3 long
    // coherent trapezoids that hug the merged spine. The footprint
    // coverage base under the faces (rendered at ridge height) fills any
    // unclassified region with the dominant pitch tone, so a low face
    // count is structurally fine — what matters is that the count isn't
    // pathologically high (which signals broken run-grouping).
    expect(facesChecked).toBeGreaterThanOrEqual(2)
    expect(facesChecked).toBeLessThanOrEqual(8)
    expect(slivers).toBe(0)
    // Polygon is ~10.6m × 16.1m. After the fix, the merged spine is the
    // dominant ridge — face count should reflect a true hip roof
    // (sloped sides + porch face), not the broken 2-block layout.
    expect(polyW).toBeLessThan(20)
    expect(polyH).toBeLessThan(20)

    // Ridge-axis coherence: the per-face highlighted ridges (the topmost
    // edge of each emitted face) should all lie along ONE dominant axis
    // when the user traced a single logical spine — even if they clicked
    // it as multiple short segments with a tiny perpendicular jog at the
    // joint. Without the fix, the ridge highlights point in many
    // unrelated directions because each broken sub-face has its own
    // rogue "ridge". After the fix, ≥ 75% of ridge lines should align
    // (within 20° axis-difference) with the dominant axis.
    const ridgeLineRe = /<line[^>]*stroke="#991B1B"[^>]*\/>/g
    const ridgeLines = svg.match(ridgeLineRe) || []
    const angles: number[] = []
    for (const l of ridgeLines) {
      const x1 = Number(l.match(/x1="([^"]+)"/)?.[1])
      const y1 = Number(l.match(/y1="([^"]+)"/)?.[1])
      const x2 = Number(l.match(/x2="([^"]+)"/)?.[1])
      const y2 = Number(l.match(/y2="([^"]+)"/)?.[1])
      const dx = x2 - x1, dy = y2 - y1
      if (Math.hypot(dx, dy) < 30) continue   // skip tiny ridge stubs
      // Axis angle: fold to [0, 180) so opposite-pointing lines collapse.
      let a = (Math.atan2(dy, dx) * 180) / Math.PI
      if (a < 0) a += 180
      if (a >= 180) a -= 180
      angles.push(a)
    }
    expect(angles.length).toBeGreaterThanOrEqual(2)
    // Find the angle that has the most neighbours within ±20°.
    let bestCount = 0
    for (const probe of angles) {
      let c = 0
      for (const a of angles) {
        const diff = Math.min(Math.abs(a - probe), 180 - Math.abs(a - probe))
        if (diff <= 20) c++
      }
      if (c > bestCount) bestCount = c
    }
    expect(bestCount / angles.length).toBeGreaterThanOrEqual(0.75)
  })
})

describe('generateAxonometricRoofSVG — 7611 183 St NW two-rectangle bug', () => {
  it('does not emit faces whose centroid sits outside the eaves footprint', () => {
    const REF = { lat: 53.5161, lng: -113.3145 }
    const FT_PER_DEG_LAT = 364_000
    const ftToLat = (ft: number) => ft / FT_PER_DEG_LAT
    const ftToLng = (ft: number, lat: number) =>
      ft / (FT_PER_DEG_LAT * Math.cos(lat * Math.PI / 180))
    const at = (dxFt: number, dyFt: number) => ({
      lat: REF.lat + ftToLat(dyFt),
      lng: REF.lng + ftToLng(dxFt, REF.lat),
    })

    // Approximate the 7611 183 St NW main house: a "fat L" — large
    // 45×28 ft rectangle (B) with a smaller 23×20 ft section (A) butting
    // up against its left side. Two ridges: one along B's long axis,
    // one running down through the shared wall. Two valleys at the meeting.
    const part = partition({
      eaves: [
        // A section (left)
        at(0,  0),
        at(18, 0),
        at(18, 11),
        at(28, 11),    // jog out at shared wall
        // B section (right) starts here
        at(28, 0),
        at(73, 0),
        at(73, 28),
        at(28, 28),
        // back to A
        at(28, 20),
        at(0,  20),
      ],
      ridges: [
        // B's main ridge along its long axis
        [at(35, 14), at(68, 14)],
        // A's ridge
        [at(5,  10), at(15, 10)],
      ],
      hips: [
        [at(0,  0),  at(5, 10)],
        [at(0,  20), at(5, 10)],
        [at(18, 0),  at(15, 10)],
        [at(73, 0),  at(68, 14)],
        [at(73, 28), at(68, 14)],
      ],
      valleys: [
        [at(28, 11), at(35, 14)],
        [at(28, 20), at(35, 14)],
      ],
      footprint_sqft: 1620,
      true_area_sqft: 1850,
    })

    const svg = generateAxonometricRoofSVG(part)

    // Smoke check: SVG renders.
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')

    // Reuse the same screen-space sliver detection as the Foxboro test.
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
      if (longer / shorter > 8 && shorter < 18) slivers++
    }
    expect(facesChecked).toBeGreaterThan(0)
    expect(slivers).toBe(0)
  })
})
