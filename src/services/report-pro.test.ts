import { describe, it, expect } from 'vitest'
import {
  computeConfidenceBreakdown,
  diffMeasurements,
  estimateShingleAgeYears,
  regionalReplacementBandCad,
} from './report-pro'

describe('computeConfidenceBreakdown', () => {
  it('marks all-high when Solar API + HIGH imagery + DSM classifier agree', () => {
    const cb = computeConfidenceBreakdown({
      imagery_quality: 'HIGH',
      pitch_confidence: 'high',
      pitch_source: 'solar_api',
      area_variance_pct: 1.2,
      edge_classifier_ran: true,
      avg_edge_classifier_confidence: 92,
      low_confidence_edge_count: 0,
    })
    expect(cb.pitch).toBe('high')
    expect(cb.area).toBe('high')
    expect(cb.edges).toBe('high')
  })

  it('marks area low when variance > 10%', () => {
    const cb = computeConfidenceBreakdown({ area_variance_pct: 15.4 })
    expect(cb.area).toBe('low')
    expect(cb.area_basis).toContain('15.4')
  })

  it('marks pitch low when engine fallback', () => {
    const cb = computeConfidenceBreakdown({ pitch_confidence: 'low', pitch_source: 'engine_default' })
    expect(cb.pitch).toBe('low')
  })

  it('falls back to medium edges when classifier did not run', () => {
    const cb = computeConfidenceBreakdown({})
    expect(cb.edges).toBe('medium')
  })

  it('prefers SAM3 IoU over variance when present', () => {
    const cb = computeConfidenceBreakdown({ area_iou: 0.95, area_variance_pct: 18 })
    expect(cb.area).toBe('high')
    expect(cb.area_basis).toContain('IoU')
  })
})

describe('diffMeasurements', () => {
  const prior = {
    total_true_area_sqft: 3200,
    edges: new Array(12),
    roof_pitch_ratio: '5:12',
    materials: { gross_squares: 38 },
  }
  const next = {
    total_true_area_sqft: 3245,
    edges: new Array(14),
    roof_pitch_ratio: '6:12',
    materials: { gross_squares: 39 },
  }

  it('reports area delta in ft² and percent', () => {
    const d = diffMeasurements(prior, next, 1)
    expect(d.prior_version_num).toBe(1)
    expect(d.area_delta_ft2).toBeCloseTo(45, 1)
    expect(d.area_delta_pct).toBeCloseTo(1.4, 1)
  })

  it('reports new edges and pitch change in the message', () => {
    const d = diffMeasurements(prior, next, 1)
    expect(d.edges_added).toBe(2)
    expect(d.edges_removed).toBe(0)
    expect(d.pitch_changed).toBe(true)
    expect(d.message).toContain('+45')
    expect(d.message).toContain('+2 edges')
    expect(d.message).toContain('5:12 → 6:12')
  })

  it('reports computed_ms (number, sub-second for tiny inputs)', () => {
    const d = diffMeasurements(prior, next, 1)
    expect(typeof d.computed_ms).toBe('number')
    expect(d.computed_ms).toBeLessThan(1000)
  })

  it('handles no-change diff with stable summary', () => {
    const d = diffMeasurements(prior, prior, 2)
    expect(d.area_delta_ft2).toBe(0)
    expect(d.edges_added).toBe(0)
    expect(d.edges_removed).toBe(0)
    expect(d.message).toMatch(/no measurable changes/i)
  })

  it('returns negative deltas when area shrinks', () => {
    const shrunk = { ...next, total_true_area_sqft: 3100 }
    const d = diffMeasurements(prior, shrunk, 1)
    expect(d.area_delta_ft2).toBeLessThan(0)
    expect(d.message).toContain('-')
  })
})

describe('estimateShingleAgeYears', () => {
  it('returns null for missing or invalid dates', () => {
    expect(estimateShingleAgeYears(undefined)).toBeNull()
    expect(estimateShingleAgeYears('not-a-date')).toBeNull()
  })

  it('returns a positive year count for a past date', () => {
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString()
    const age = estimateShingleAgeYears(oneYearAgo)
    expect(age).toBeGreaterThanOrEqual(0.9)
    expect(age).toBeLessThanOrEqual(1.1)
  })
})

describe('regionalReplacementBandCad', () => {
  it('returns AB band when province is AB', () => {
    const band = regionalReplacementBandCad({ property: { province: 'AB' } } as any)
    expect(band.low).toBeGreaterThan(0)
    expect(band.high).toBeGreaterThan(band.mid)
    expect(band.mid).toBeGreaterThan(band.low)
  })

  it('falls back to a generic band for unknown provinces', () => {
    const band = regionalReplacementBandCad({ property: {} } as any)
    expect(band.low).toBeGreaterThan(0)
  })
})
