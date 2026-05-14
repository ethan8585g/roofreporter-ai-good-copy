import { describe, it, expect } from 'vitest'
import {
  renderLayerCrossSection,
  renderEaveOverhangDetail,
  renderCommonPitchesCard,
  renderRoofAnatomyAppendix,
} from './roof-anatomy-appendix'

describe('renderLayerCrossSection', () => {
  it('produces an SVG with all six numbered layers', () => {
    const svg = renderLayerCrossSection()
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    // Each layer's name should appear as text content.
    for (const name of ['Shingles', 'Underlayment', 'Decking', 'Framing', 'Insulation', 'Drywall']) {
      expect(svg).toContain(name)
    }
    // Numbered badges (1)–(6).
    for (const n of ['>1<', '>2<', '>3<', '>4<', '>5<', '>6<']) {
      expect(svg).toContain(n)
    }
  })
})

describe('renderEaveOverhangDetail', () => {
  it('renders the eave parts and overhang dimension label', () => {
    const svg = renderEaveOverhangDetail()
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('Rafter tail')
    expect(svg).toContain('Soffit')
    expect(svg).toContain('Fascia')
    expect(svg).toContain('Drip edge')
    expect(svg).toContain('Gutter')
    // Static "typical overhang" dimension annotation (16″–24″ range).
    // Test against the un-escaped chars (″ encoded to &#8243;? actually the
    // escapeHtml only encodes &<>"' so unicode is preserved).
    expect(svg).toContain('Typical overhang')
  })
})

describe('renderCommonPitchesCard', () => {
  it('renders all four common-pitch buckets', () => {
    const svg = renderCommonPitchesCard()
    for (const label of ['3/12', '6/12', '8/12', '12/12']) {
      expect(svg).toContain(label)
    }
  })

  it('highlights "YOUR ROOF" on the matching pitch bucket when label="8/12"', () => {
    const svg = renderCommonPitchesCard('8/12')
    expect(svg).toContain('YOUR ROOF')
    // Coarse check: the highlighted bucket gets a thicker stroke (2.5).
    // There should be exactly one polygon with that stroke-width.
    const matches = svg.match(/stroke-width="2\.5"/g) || []
    expect(matches.length).toBe(1)
  })

  it('accepts "6:12" colon syntax (matches normalized "6/12")', () => {
    const svg = renderCommonPitchesCard('6:12')
    expect(svg).toContain('YOUR ROOF')
  })

  it('emits no highlight when dominant pitch does not match any common bucket', () => {
    const svg = renderCommonPitchesCard('11/12')
    expect(svg).not.toContain('YOUR ROOF')
  })

  it('emits no highlight when dominant pitch is null / undefined', () => {
    expect(renderCommonPitchesCard(null)).not.toContain('YOUR ROOF')
    expect(renderCommonPitchesCard(undefined)).not.toContain('YOUR ROOF')
    expect(renderCommonPitchesCard('')).not.toContain('YOUR ROOF')
  })
})

describe('renderRoofAnatomyAppendix — full page', () => {
  it('renders the appendix page with title + all three panels + disclaimer', () => {
    const html = renderRoofAnatomyAppendix({ dominantPitchLabel: '6/12' })
    expect(html).toContain('ROOF ANATOMY APPENDIX')           // section banner comment
    expect(html).toContain('Roof Anatomy Reference')          // title
    expect(html).toContain('Layer Cross-Section')             // panel 1 header
    expect(html).toContain('Eave Overhang Detail')            // panel 2 header
    expect(html).toContain('Common Roof Pitches')             // panel 3 header
    expect(html).toContain('YOUR ROOF')                       // highlighted bucket
    expect(html).toContain('Typical overhang')                // eave dimension
    expect(html).toContain('Layer thicknesses and overhang')  // disclaimer
    // Page break before the appendix so it doesn't collide with the
    // previous page in PDF rendering.
    expect(html).toContain('page-break-before:always')
  })

  it('works without a dominant pitch (no "YOUR ROOF" badge, no crash)', () => {
    const html = renderRoofAnatomyAppendix({})
    expect(html).toContain('Roof Anatomy Reference')
    expect(html).not.toContain('YOUR ROOF')
  })
})
