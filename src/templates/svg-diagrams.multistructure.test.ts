import { describe, it, expect } from 'vitest'
import { generateTraceBasedDiagramSVG } from './svg-diagrams'

// Build a lat/lng polygon offset N feet east + M feet north of REF.
const REF = { lat: 53.5161, lng: -113.3145 }
const FT_PER_DEG_LAT = 364_000
const ftToLat = (ft: number) => ft / FT_PER_DEG_LAT
const ftToLng = (ft: number, lat: number) =>
  ft / (FT_PER_DEG_LAT * Math.cos(lat * Math.PI / 180))
const at = (eFt: number, nFt: number) => ({
  lat: REF.lat + ftToLat(nFt),
  lng: REF.lng + ftToLng(eFt, REF.lat),
})

const EDGE_SUMMARY = {
  total_ridge_ft: 30,
  total_hip_ft: 0,
  total_valley_ft: 0,
  total_eave_ft: 200,
  total_rake_ft: 60,
}

describe('generateTraceBasedDiagramSVG — multi-structure (house + detached garage)', () => {
  // Main house: 40 ft × 30 ft rectangle at the origin.
  const house = [at(0, 0), at(40, 0), at(40, 30), at(0, 30)]
  // Detached garage: 20 ft × 20 ft, offset 70 ft east of the house.
  const garage = [at(70, 0), at(90, 0), at(90, 20), at(70, 20)]

  const svg = generateTraceBasedDiagramSVG(
    {
      eaves: house,
      eaves_sections: [house, garage],
      ridges: [[at(0, 15), at(40, 15)]],
      hips: [],
      valleys: [],
    },
    EDGE_SUMMARY,
    1200 + 400, // total footprint
    18,
    '4:12',
    16,
    1700,
  )

  it('returns a non-empty SVG document', () => {
    expect(svg).toMatch(/^<svg /)
    expect(svg).toContain('</svg>')
    expect(svg.length).toBeGreaterThan(2000)
  })

  it('renders both the primary house outline AND a dashed extra-structure outline', () => {
    // Primary eave outline: solid black, no dasharray on the polygon
    expect(svg).toMatch(/<polygon[^>]*stroke="#1a1a1a"[^>]*stroke-width="2\.2"/)
    // Extra section: green dashed outline (stroke-dasharray="6,3" + green stroke)
    expect(svg).toMatch(/<polygon[^>]*stroke="#0d9668"[^>]*stroke-dasharray="6,3"/)
  })

  it('labels the second structure with "Structure N" + a sloped-area SF figure', () => {
    expect(svg).toMatch(/Structure \d/)
    // Sloped-area label uses "SF" suffix
    expect(svg).toMatch(/\d+\s*SF/)
  })

  it('does NOT clip the garage out of the drawn area', () => {
    // Pull the two eave-outline polygons (primary solid black, extra dashed
    // green). Confirm both centroids are on-canvas and that one sits left of
    // canvas-mid (house) while the other sits right (garage). If the bbox
    // bug regressed, the garage would render outside the viewBox.
    const W = 700, H = 700
    const outlineRe = /<polygon points="([^"]+)"[^>]*fill="(?:none|rgba\(22,163,74[^"]+)"[^>]*stroke="(?:#1a1a1a|#0d9668)"/g
    const outlines = [...svg.matchAll(outlineRe)]
    expect(outlines.length).toBe(2)

    const centroids = outlines.map(m => {
      const pts = m[1]
        .trim()
        .split(/\s+/)
        .map(p => p.split(',').map(Number) as [number, number])
      const cx = pts.reduce((s, [x]) => s + x, 0) / pts.length
      const cy = pts.reduce((s, [, y]) => s + y, 0) / pts.length
      return { cx, cy }
    })

    for (const c of centroids) {
      expect(c.cx).toBeGreaterThan(0)
      expect(c.cx).toBeLessThan(W)
      expect(c.cy).toBeGreaterThan(0)
      expect(c.cy).toBeLessThan(H)
    }

    const leftSide = centroids.some(c => c.cx < W / 2 - 50)
    const rightSide = centroids.some(c => c.cx > W / 2 + 50)
    expect(leftSide && rightSide).toBe(true)
  })

  it('falls back gracefully when only a single eaves array is supplied', () => {
    // Sanity: the same generator with NO eaves_sections renders just one
    // polygon — proves the multi-structure path is opt-in via eaves_sections,
    // not unconditional duplication.
    const single = generateTraceBasedDiagramSVG(
      { eaves: house, ridges: [], hips: [], valleys: [] },
      EDGE_SUMMARY,
      1200,
      18,
      '4:12',
      12,
      1300,
    )
    const dashedExtras = (single.match(/stroke-dasharray="6,3"/g) || []).length
    expect(dashedExtras).toBe(0)
  })
})
