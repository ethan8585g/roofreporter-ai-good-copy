import { describe, it, expect } from 'vitest'
import { generateProfessionalReportHTML } from './report-html'
import { generateTraceBasedDiagramSVG } from './svg-diagrams'

// Minimal RoofReport fixture — just enough to drive the HTML generator
// and verify flashing rows render only when > 0.
function makeReport(overrides: any = {}) {
  return {
    order_id: 1,
    generated_at: new Date().toISOString(),
    report_version: '5.0',
    property: {
      address: '123 Test St', city: 'Calgary', province: 'AB',
      postal_code: 'T2A 1A1', homeowner_name: 'Test Owner',
      latitude: 51, longitude: -114,
    },
    total_footprint_sqft: 1500,
    total_footprint_sqm: 139,
    total_true_area_sqft: 1700,
    total_true_area_sqm: 158,
    area_multiplier: 1.13,
    roof_pitch_degrees: 26.6,
    roof_pitch_ratio: '6:12',
    roof_azimuth_degrees: 180,
    segments: [
      { id: 's1', plane_id: 's1', azimuth_degrees: 180, pitch_degrees: 26.6,
        area_sqft: 850, projected_area_sqft: 750, true_area_sqft: 850, energy_kwh: 0 },
      { id: 's2', plane_id: 's2', azimuth_degrees: 0,   pitch_degrees: 26.6,
        area_sqft: 850, projected_area_sqft: 750, true_area_sqft: 850, energy_kwh: 0 },
    ],
    edges: [],
    edge_summary: {
      total_ridge_ft: 30, total_hip_ft: 0, total_valley_ft: 0,
      total_eave_ft: 100, total_rake_ft: 60, total_linear_ft: 190,
      ...overrides.edge_summary,
    },
    materials: { total_squares: 17, gross_squares: 19.5, waste_factor: 0.15 } as any,
    max_sunshine_hours: 0, num_panels_possible: 0, yearly_energy_kwh: 0,
    imagery: { static_url: '', overhead_url: '', dsm_url: null, mask_url: null } as any,
    excluded_segments: [],
    quality: { imagery_quality: 'HIGH' as any, field_verification_recommended: false, confidence_score: 95, notes: [] },
    ...overrides,
  } as any
}

describe('flashings — report HTML rendering', () => {
  it('omits all flashing rows on a report with no flashings', () => {
    const html = generateProfessionalReportHTML(makeReport({
      edge_summary: { total_eave_ft: 0, total_rake_ft: 0, total_linear_ft: 30 },
    }))
    expect(html).not.toContain('Step Flashing')
    expect(html).not.toContain('Headwall Flashing')
    expect(html).not.toContain('Chimney Flashing')
    expect(html).not.toContain('Pipe Boots')
    expect(html).not.toContain('Eaves Flashing')
  })

  it('renders Eaves Flashing row auto-derived from total_eave_ft', () => {
    const html = generateProfessionalReportHTML(makeReport({
      edge_summary: { total_eave_ft: 100, total_rake_ft: 60 },
    }))
    expect(html).toContain('Eaves Flashing')
    expect(html).toContain('100 LF')
  })

  it('Eaves Flashing prefers explicit total_eaves_flashing_ft when set', () => {
    const html = generateProfessionalReportHTML(makeReport({
      edge_summary: { total_eave_ft: 100, total_eaves_flashing_ft: 88, total_rake_ft: 60 },
    }))
    expect(html).toContain('Eaves Flashing')
    expect(html).toContain('88 LF')
  })

  it('renders Step Flashing row when total_step_flashing_ft > 0', () => {
    const html = generateProfessionalReportHTML(makeReport({
      edge_summary: { total_step_flashing_ft: 24 },
    }))
    expect(html).toContain('Step Flashing')
    expect(html).toContain('24 LF')
  })

  it('renders Headwall Flashing row when total_headwall_flashing_ft > 0', () => {
    const html = generateProfessionalReportHTML(makeReport({
      edge_summary: { total_headwall_flashing_ft: 16, total_wall_flashing_ft: 16 },
    }))
    expect(html).toContain('Headwall Flashing')
    expect(html).toContain('16 LF')
  })

  it('renders Chimney + Pipe Boot count rows when counts > 0', () => {
    const html = generateProfessionalReportHTML(makeReport({
      edge_summary: { chimney_flashing_count: 2, pipe_boot_count: 5 },
    }))
    expect(html).toContain('Chimney Flashing')
    expect(html).toContain('2 ea')
    expect(html).toContain('Pipe Boots')
    expect(html).toContain('5 ea')
  })

  it('renders all four flashing categories when all present', () => {
    const html = generateProfessionalReportHTML(makeReport({
      edge_summary: {
        total_step_flashing_ft: 30,
        total_headwall_flashing_ft: 12,
        total_wall_flashing_ft: 12,
        chimney_flashing_count: 1,
        pipe_boot_count: 3,
      },
    }))
    expect(html).toContain('Step Flashing')
    expect(html).toContain('Headwall Flashing')
    expect(html).toContain('Chimney Flashing')
    expect(html).toContain('Pipe Boots')
  })
})

describe('flashings — SVG diagram rendering', () => {
  // 4-corner trace at 51N
  const eaves = [
    { lat: 51.0000, lng: -114.0000 },
    { lat: 51.0000, lng: -113.9999 },
    { lat: 51.0001, lng: -113.9999 },
    { lat: 51.0001, lng: -114.0000 },
  ]
  const baseSummary = {
    total_ridge_ft: 30, total_hip_ft: 0, total_valley_ft: 0,
    total_eave_ft: 100, total_rake_ft: 60,
  }

  it('renders without flashings legend rows when none present', () => {
    const svg = generateTraceBasedDiagramSVG(
      { eaves },
      baseSummary,
      1500, 26.6, '6:12', 19.5, 1700,
    )
    expect(svg).toContain('<svg')
    expect(svg).not.toContain('Step Flashing')
    expect(svg).not.toContain('Headwall')
  })

  it('draws step-flashing wall lines and adds a legend row', () => {
    const svg = generateTraceBasedDiagramSVG(
      {
        eaves,
        walls: [{ pts: [{ lat: 51.00005, lng: -114.0000 }, { lat: 51.00005, lng: -113.99995 }], kind: 'step' }],
      },
      { ...baseSummary, total_step_flashing_ft: 18 },
      1500, 26.6, '6:12', 19.5, 1700,
    )
    expect(svg).toContain('#F59E0B')          // step flashing color
    expect(svg).toContain('Step Flashing')    // legend label
  })

  it('draws chimney + pipe-boot annotation glyphs on the diagram', () => {
    const svg = generateTraceBasedDiagramSVG(
      {
        eaves,
        annotations: {
          chimneys:   [{ lat: 51.00003, lng: -113.99998 }],
          pipe_boots: [{ lat: 51.00007, lng: -113.99996 }],
        },
      },
      { ...baseSummary, chimney_flashing_count: 1, pipe_boot_count: 1 },
      1500, 26.6, '6:12', 19.5, 1700,
    )
    expect(svg).toContain('#B45309')  // chimney fill
    expect(svg).toContain('#0891b2')  // pipe boot fill
    expect(svg).toContain('>C<')       // chimney label
    expect(svg).toContain('>P<')       // pipe-boot label
  })
})
