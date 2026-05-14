import { describe, it, expect } from 'vitest'
import {
  generateAxonometricRoofSVG,
  type StructurePartition,
  type LatLng,
} from './svg-3d-diagram'

// ───────────────────────── FIXTURE HELPERS ─────────────────────────

const REF = { lat: 53.5161, lng: -113.3145 }
const FT_PER_DEG_LAT = 364_000
const ftToLat = (ft: number) => ft / FT_PER_DEG_LAT
const ftToLng = (ft: number, lat: number) =>
  ft / (FT_PER_DEG_LAT * Math.cos(lat * Math.PI / 180))
const at = (dxFt: number, dyFt: number): LatLng => ({
  lat: REF.lat + ftToLat(dyFt),
  lng: REF.lng + ftToLng(dxFt, REF.lat),
})

// 40 × 30 ft hip roof with a single ridge across the long axis. Big enough
// to clear the tiny-footprint cutoff (default canvas 1200×750).
function hipPartition(overrides: Partial<StructurePartition> = {}): StructurePartition {
  return {
    index: 1,
    label: 'Test House',
    eaves: [at(0, 0), at(40, 0), at(40, 30), at(0, 30)],
    ridges: [[at(8, 15), at(32, 15)]],
    hips: [[at(0, 0), at(8, 15)], [at(40, 0), at(32, 15)], [at(0, 30), at(8, 15)], [at(40, 30), at(32, 15)]],
    valleys: [],
    rakes: [],
    footprint_sqft: 1200,
    true_area_sqft: 1320,
    perimeter_ft: 140,
    dominant_pitch_deg: 26.6,
    dominant_pitch_label: '6:12',
    area_share: 1,
    eave_lf: 140,
    ridge_lf: 24,
    hip_lf: 70,
    valley_lf: 0,
    rake_lf: 0,
    ...overrides,
  }
}

// 8 × 6 ft shed — well under the 10000 px² footprint cutoff once it gets
// projected at default canvas size, so leader callouts should drop out.
function shedPartition(): StructurePartition {
  return {
    index: 1,
    label: 'Shed',
    eaves: [at(0, 0), at(8, 0), at(8, 6), at(0, 6)],
    ridges: [],
    hips: [],
    valleys: [],
    rakes: [],
    footprint_sqft: 48,
    true_area_sqft: 53,
    perimeter_ft: 28,
    dominant_pitch_deg: 18,
    dominant_pitch_label: '4:12',
    area_share: 1,
    eave_lf: 28,
    ridge_lf: 0,
    hip_lf: 0,
    valley_lf: 0,
    rake_lf: 0,
  }
}

// ───────────────────────── TESTS ─────────────────────────

describe('generateAxonometricRoofSVG — classic style is unchanged', () => {
  it('produces identical output with no style flag vs. style:"classic"', () => {
    const a = generateAxonometricRoofSVG(hipPartition(), { showCompass: false })
    const b = generateAxonometricRoofSVG(hipPartition(), { showCompass: false, style: 'classic' })
    expect(a).toBe(b)
  })

  it('does NOT emit infographic-style dashed overlays in classic mode', () => {
    const svg = generateAxonometricRoofSVG(hipPartition())
    expect(svg).not.toContain('stroke-dasharray="8,4"')   // ridge dash
    expect(svg).not.toContain('stroke-dasharray="7,3"')   // hip dash
  })
})

describe('generateAxonometricRoofSVG — infographic smoke render', () => {
  it('emits all expected dash patterns when ridges + hips are traced', () => {
    const svg = generateAxonometricRoofSVG(hipPartition(), { style: 'infographic' })
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    // Each edge kind that has traced segments should emit its dash pattern.
    expect(svg).toContain('stroke-dasharray="8,4"')   // ridge
    expect(svg).toContain('stroke-dasharray="7,3"')   // hip
    expect(svg).toContain('stroke-dasharray="5,3"')   // eave perimeter
  })

  it('emits the ridge color from the legend (matches report-html.ts)', () => {
    const svg = generateAxonometricRoofSVG(hipPartition(), { style: 'infographic' })
    expect(svg).toMatch(/stroke="#DC2626"[^>]*stroke-dasharray="8,4"/)
  })

  it('emits an EAVE leader callout pill on a normal-sized roof', () => {
    const svg = generateAxonometricRoofSVG(hipPartition(), { style: 'infographic' })
    // Every edge kind that has traced segments and is the longest of its
    // kind gets a leader callout. Eave perimeter is always present on a
    // valid structure, so the EAVE label should always appear.
    expect(svg).toContain('>EAVE<')
    expect(svg).toContain('Low edge (gutter)')
  })

  it('emits a RIDGE leader callout when ridges are present', () => {
    const svg = generateAxonometricRoofSVG(hipPartition(), { style: 'infographic' })
    expect(svg).toContain('>RIDGE<')
    expect(svg).toContain('High point')
  })

  it('emits a HIP leader callout when hips are present', () => {
    const svg = generateAxonometricRoofSVG(hipPartition(), { style: 'infographic' })
    expect(svg).toContain('>HIP<')
    expect(svg).toContain('External sloping angle')
  })

  it('does NOT emit a VALLEY callout when no valleys are traced', () => {
    const svg = generateAxonometricRoofSVG(hipPartition({ valleys: [] }), { style: 'infographic' })
    expect(svg).not.toContain('>VALLEY<')
  })
})

describe('generateAxonometricRoofSVG — infographic with valleys + rakes', () => {
  it('emits valley + rake dash patterns when those edges are traced', () => {
    const svg = generateAxonometricRoofSVG(
      hipPartition({
        valleys: [[at(20, 0), at(20, 15)]],
        rakes: [[at(0, 0), at(20, 15)]],
        valley_lf: 15,
        rake_lf: 25,
      }),
      { style: 'infographic' },
    )
    expect(svg).toContain('stroke-dasharray="4,3"')     // valley
    expect(svg).toContain('stroke-dasharray="6,2,2,2"') // rake (dash-dot)
    expect(svg).toContain('>VALLEY<')
    expect(svg).toContain('>RAKE<')
  })
})

describe('generateAxonometricRoofSVG — dormer callout', () => {
  it('renders a DORMER leader callout when dormers are present', () => {
    const svg = generateAxonometricRoofSVG(
      hipPartition({
        dormers: [{
          polygon: [at(15, 12), at(25, 12), at(25, 18), at(15, 18)],
          pitch_rise: 6,
          label: 'Dormer 1',
        }],
      }),
      { style: 'infographic' },
    )
    expect(svg).toContain('>DORMER<')
    expect(svg).toContain('Projects from roof plane')
  })
})

describe('generateAxonometricRoofSVG — annotation callouts', () => {
  it('renders CHIMNEY + SKYLIGHT pills when annotations are supplied', () => {
    const svg = generateAxonometricRoofSVG(hipPartition(), {
      style: 'infographic',
      annotations: {
        chimneys: [at(12, 18)],
        skylights: [at(28, 12)],
      },
    })
    expect(svg).toContain('>CHIMNEY<')
    expect(svg).toContain('>SKYLIGHT<')
  })

  it('skips annotation callout if list is empty', () => {
    const svg = generateAxonometricRoofSVG(hipPartition(), {
      style: 'infographic',
      annotations: { chimneys: [] },
    })
    expect(svg).not.toContain('>CHIMNEY<')
  })
})

describe('generateAxonometricRoofSVG — tiny structure graceful degrade', () => {
  it('drops leader callouts when the structure is smaller than the cutoff', () => {
    // Pick a canvas big enough that the shed projects to under 10000 px²
    // when scaled to fit. Default canvas is 1200×750. A 8×6 ft shed scaled
    // to fill the canvas would actually still be large — so shrink the
    // canvas instead to force the small-footprint path.
    const svg = generateAxonometricRoofSVG(shedPartition(), {
      style: 'infographic',
      width: 200,
      height: 140,
    })
    // Dashes for the eave should still render (overlay pass runs).
    expect(svg).toContain('stroke-dasharray="5,3"')
    // But no leader callout pills should appear.
    expect(svg).not.toContain('>EAVE<')
    expect(svg).not.toContain('>RIDGE<')
  })
})

describe('generateAxonometricRoofSVG — collision avoidance', () => {
  it('places no overlapping leader-callout pills on a standard hip roof', () => {
    const svg = generateAxonometricRoofSVG(
      hipPartition({
        valleys: [[at(20, 0), at(20, 15)]],
        rakes: [[at(0, 0), at(20, 15)]],
        valley_lf: 15,
        rake_lf: 25,
      }),
      { style: 'infographic' },
    )
    // Extract translate(x,y) from each callout-pill <g>. The renderer wraps
    // every pill in <g transform="translate(...)"><rect ... width="110" ...
    const calloutRectRe = /<g transform="translate\(([\d.-]+),([\d.-]+)\)"><rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="110" height="30"/g
    const rects: { x: number; y: number; w: number; h: number }[] = []
    let m: RegExpExecArray | null
    while ((m = calloutRectRe.exec(svg)) !== null) {
      const cx = parseFloat(m[1])
      const cy = parseFloat(m[2])
      rects.push({ x: cx - 55, y: cy - 15, w: 110, h: 30 })
    }
    expect(rects.length).toBeGreaterThan(0)
    // Pairwise AABB overlap check — every placed rect must be disjoint
    // from every other.
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j]
        const overlap = !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)
        expect(overlap, `pill ${i} overlaps pill ${j}`).toBe(false)
      }
    }
  })
})
