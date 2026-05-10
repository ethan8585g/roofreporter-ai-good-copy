import { describe, it, expect } from 'vitest'
import {
  generateTraceBasedDiagramSVG,
  generateLengthDiagramSVG,
  generatePitchDiagramSVG2,
  generateAreaDiagramSVG,
  generateNotesDiagramSVG,
} from './svg-diagrams'

const eaves = [
  { lat: 49.2500, lng: -123.1000 },
  { lat: 49.2500, lng: -123.0985 },
  { lat: 49.2492, lng: -123.0985 },
  { lat: 49.2492, lng: -123.1000 },
]
const cutout = [
  { lat: 49.2497, lng: -123.0995 },
  { lat: 49.2497, lng: -123.0990 },
  { lat: 49.2495, lng: -123.0990 },
  { lat: 49.2495, lng: -123.0995 },
]
const baseEdge = { total_ridge_ft: 0, total_hip_ft: 0, total_valley_ft: 0, total_eave_ft: 0, total_rake_ft: 0 }

describe('cutout diagram rendering', () => {
  it('emits a grey-filled, dashed cutout polygon with a label', () => {
    const svg = generateTraceBasedDiagramSVG(
      {
        eaves,
        eaves_sections: [eaves],
        cutouts: [{ polygon: cutout, label: 'Deck between levels' }],
      },
      baseEdge, 1500, 26.6, '6:12', 18, 1500
    )
    expect(svg).toContain('stroke-dasharray="5,3"')
    expect(svg).toContain('fill="#d1d5db"')
    expect(svg).toContain('stroke="#6b7280"')
    expect(svg).toContain('Deck between levels')
  })

  it('falls back to "Non-roof N" when no label is provided', () => {
    const svg = generateTraceBasedDiagramSVG(
      {
        eaves,
        eaves_sections: [eaves],
        cutouts: [{ polygon: cutout }],
      },
      baseEdge, 1500, 26.6, '6:12', 18, 1500
    )
    expect(svg).toContain('Non-roof 1')
  })

  it('omits cutout markup when no cutouts are passed', () => {
    const svg = generateTraceBasedDiagramSVG(
      { eaves, eaves_sections: [eaves] },
      baseEdge, 1500, 26.6, '6:12', 18, 1500
    )
    expect(svg).not.toContain('Non-roof')
    expect(svg).not.toContain('stroke-dasharray="5,3"')
  })

  it('skips invalid cutouts (< 3 points) without breaking the SVG', () => {
    const svg = generateTraceBasedDiagramSVG(
      {
        eaves,
        eaves_sections: [eaves],
        cutouts: [{ polygon: [{ lat: 49.25, lng: -123.1 }] as any, label: 'bad' }],
      },
      baseEdge, 1500, 26.6, '6:12', 18, 1500
    )
    expect(svg).toContain('<svg')
    expect(svg).not.toContain('bad')
  })

  it('hides label when hideMeasurements is true (customer 2D view)', () => {
    const svg = generateTraceBasedDiagramSVG(
      {
        eaves,
        eaves_sections: [eaves],
        cutouts: [{ polygon: cutout, label: 'Hidden Deck' }],
      },
      baseEdge, 1500, 26.6, '6:12', 18, 1500,
      { hideMeasurements: true }
    )
    expect(svg).not.toContain('Hidden Deck')
    expect(svg).toContain('stroke-dasharray="5,3"')
  })

  it('renders multiple cutouts simultaneously', () => {
    const cutout2 = [
      { lat: 49.2499, lng: -123.0999 },
      { lat: 49.2499, lng: -123.0997 },
      { lat: 49.2498, lng: -123.0997 },
      { lat: 49.2498, lng: -123.0999 },
    ]
    const svg = generateTraceBasedDiagramSVG(
      {
        eaves,
        eaves_sections: [eaves],
        cutouts: [
          { polygon: cutout, label: 'Deck' },
          { polygon: cutout2, label: 'Atrium' },
        ],
      },
      baseEdge, 1500, 26.6, '6:12', 18, 1500
    )
    expect(svg).toContain('Deck')
    expect(svg).toContain('Atrium')
    const dashedCount = (svg.match(/stroke-dasharray="5,3"/g) || []).length
    expect(dashedCount).toBeGreaterThanOrEqual(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// 4-page diagram split — EagleView-style layer presets
// ─────────────────────────────────────────────────────────────────────────

const traceWithEverything = {
  eaves,
  eaves_sections: [eaves],
  ridges: [[{ lat: 49.2496, lng: -123.1000 }, { lat: 49.2496, lng: -123.0985 }]],
  hips: [],
  valleys: [],
  cutouts: [{ polygon: cutout, label: 'Deck' }],
  annotations: {
    chimneys: [{ lat: 49.2497, lng: -123.0997 }],
    vents: [{ lat: 49.2498, lng: -123.0992 }],
    skylights: [],
    pipe_boots: [],
    downspouts: [],
  },
}

describe('Length diagram', () => {
  it('renders edge dimensions and the legend, but no facet labels or annotations', () => {
    const svg = generateLengthDiagramSVG(
      traceWithEverything, baseEdge, 1500, 26.6, '6:12', 18, 1500
    )
    expect(svg).toContain('ROOF MEASUREMENTS')   // legend
    // Annotation glyphs (C/V) suppressed
    expect(svg).not.toMatch(/font-weight="800"[^>]*fill="#fff"[^>]*>C</)
    expect(svg).not.toMatch(/font-weight="800"[^>]*fill="#fff"[^>]*>V</)
    // Pitch-arrow grey vector should be absent
    expect(svg).not.toContain('fill="#475569"')
  })

  it('drops dimension labels on edges shorter than 4ft', () => {
    const tinyEaves = [
      { lat: 49.2500,    lng: -123.1000 },
      { lat: 49.2500,    lng: -123.09995 },  // ~3ft
      { lat: 49.2492,    lng: -123.09995 },
      { lat: 49.2492,    lng: -123.1000 },
    ]
    const svg = generateLengthDiagramSVG(
      { eaves: tinyEaves, eaves_sections: [tinyEaves] },
      baseEdge, 200, 26.6, '6:12', 2, 200
    )
    // Should not contain a "3 ft" label since the ~3ft edge is below the cutoff
    expect(svg).not.toMatch(/>\s*3 ft\s*</)
  })
})

describe('Pitch diagram', () => {
  it('shades facets and shows pitch arrows but no edge dimensions', () => {
    const svg = generatePitchDiagramSVG2(
      traceWithEverything, baseEdge, 1500, 26.6, '6:12', 18, 1500
    )
    // Pitch-class fill (slate/blue/green/red) should be present somewhere
    expect(svg).toMatch(/fill="rgba\((148|56|34|220)/)
    // Architectural dimension label rect (white bg + black border) should be absent
    expect(svg).not.toMatch(/<rect[^>]+fill="#fff"[^>]+stroke="#ddd"[^>]+rx="2"/)
    // Legend block should be absent
    expect(svg).not.toContain('ROOF MEASUREMENTS')
  })

  it('includes pitch in facet label when faceMeta is provided', () => {
    const svg = generatePitchDiagramSVG2(
      traceWithEverything, baseEdge, 1500, 26.6, '6:12', 18, 1500,
      { faceMeta: [{ pitch_rise: 6, pitch_label: '6:12', azimuth_deg: 175 }] }
    )
    expect(svg).toContain('6:12')
    expect(svg).toMatch(/S\s*175°/)
  })
})

describe('Area diagram', () => {
  it('shows facet letter+sqft and the 10ft squares grid, no internal lines', () => {
    const svg = generateAreaDiagramSVG(
      traceWithEverything, baseEdge, 1500, 26.6, '6:12', 18, 1500
    )
    expect(svg).toContain('clip-path')           // squares grid clipPath
    expect(svg).toContain('SF')                  // facet area label
    // Internal ridge line (red, width 3.0) should be absent
    expect(svg).not.toMatch(/stroke="#C62828"\s+stroke-width="3\.0"/)
  })
})

describe('Notes diagram', () => {
  it('renders annotation glyphs and the legend table, no facet labels', () => {
    const svg = generateNotesDiagramSVG(
      traceWithEverything, baseEdge, 1500, 26.6, '6:12', 18, 1500
    )
    expect(svg).toContain('PENETRATIONS')        // annotation legend table title
    expect(svg).toContain('Chimneys')
    expect(svg).toContain('Vents')
    // Facet letter (large red) should be absent
    expect(svg).not.toMatch(/font-size="16"[^>]+fill="#C62828"/)
  })

  it('omits the legend table when there are no annotations', () => {
    const svg = generateNotesDiagramSVG(
      { eaves, eaves_sections: [eaves], annotations: {} },
      baseEdge, 1500, 26.6, '6:12', 18, 1500
    )
    expect(svg).not.toContain('PENETRATIONS')
  })
})

describe('Quick wins — facet sort + dimension cutoff', () => {
  // Build a roof with a ridge so the splitter creates 2 facets of different sizes
  const splitTrace = {
    eaves,
    eaves_sections: [eaves],
    ridges: [[{ lat: 49.2497, lng: -123.1000 }, { lat: 49.2497, lng: -123.0985 }]],
  }

  it('assigns letter A to the smallest facet (smallest-to-largest sort)', () => {
    const svg = generateAreaDiagramSVG(
      splitTrace, baseEdge, 1500, 26.6, '6:12', 18, 1500
    )
    // Look for the per-facet text labels — should contain at least A and B
    expect(svg).toMatch(/font-size="16"[^>]+>A</)
    expect(svg).toMatch(/font-size="16"[^>]+>B</)
  })
})
