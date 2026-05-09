import { describe, it, expect } from 'vitest'
import { generateTraceBasedDiagramSVG } from './svg-diagrams'

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
