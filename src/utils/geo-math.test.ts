// ============================================================
// Roof Manager — Geo-Math Unit Tests
// Run: npx vitest run src/utils/geo-math.test.ts
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  feetToFeetInches,
  pixelDistance,
  polygonPixelArea,
  parseFacetPitch,
  parseFacetAzimuth,
  lineAngleDeg,
  smartEdgeFootage,
  latLngToPixels,
  computePixelToSqftScale,
} from './geo-math'

describe('feetToFeetInches', () => {
  it('converts whole feet', () => {
    expect(feetToFeetInches(12)).toBe("12'")
  })
  it('converts feet with inches', () => {
    expect(feetToFeetInches(12.5)).toBe("12' 6\"")
  })
  it('rounds to 12 inches → next foot', () => {
    expect(feetToFeetInches(5.99)).toBe("6'")
  })
  it('handles zero', () => {
    expect(feetToFeetInches(0)).toBe("0'")
  })
})

describe('pixelDistance', () => {
  it('computes horizontal distance', () => {
    expect(pixelDistance(0, 0, 3, 0)).toBe(3)
  })
  it('computes vertical distance', () => {
    expect(pixelDistance(0, 0, 0, 4)).toBe(4)
  })
  it('computes diagonal (3-4-5 triangle)', () => {
    expect(pixelDistance(0, 0, 3, 4)).toBe(5)
  })
})

describe('polygonPixelArea', () => {
  it('returns 0 for fewer than 3 points', () => {
    expect(polygonPixelArea([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0)
  })
  it('computes area of a unit square', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
    expect(polygonPixelArea(pts)).toBeCloseTo(1, 5)
  })
  it('computes area of a 10x10 square', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
    expect(polygonPixelArea(pts)).toBeCloseTo(100, 5)
  })
  it('computes area of a triangle', () => {
    const pts = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }]
    expect(polygonPixelArea(pts)).toBeCloseTo(6, 5)
  })
  it('returns 0 for null/empty', () => {
    expect(polygonPixelArea([])).toBe(0)
    expect(polygonPixelArea(null as any)).toBe(0)
  })
})

describe('parseFacetPitch', () => {
  it('parses "25 deg"', () => {
    expect(parseFacetPitch('25 deg', 20)).toBe(25)
  })
  it('parses "6/12" ratio', () => {
    const result = parseFacetPitch('6/12', 20)
    expect(result).toBeCloseTo(26.57, 1)
  })
  it('parses "22.5°"', () => {
    expect(parseFacetPitch('22.5°', 20)).toBe(22.5)
  })
  it('returns default for undefined', () => {
    expect(parseFacetPitch(undefined, 20)).toBe(20)
  })
  it('returns default for garbage', () => {
    expect(parseFacetPitch('garbage', 20)).toBe(20)
  })
})

describe('parseFacetAzimuth', () => {
  it('parses "180 deg"', () => {
    expect(parseFacetAzimuth('180 deg')).toBe(180)
  })
  it('parses cardinal "South"', () => {
    expect(parseFacetAzimuth('South')).toBe(180)
  })
  it('parses "NW"', () => {
    expect(parseFacetAzimuth('NW')).toBe(315)
  })
  it('defaults to 180 for undefined', () => {
    expect(parseFacetAzimuth(undefined)).toBe(180)
  })
})

describe('lineAngleDeg', () => {
  it('horizontal line = 0 degrees', () => {
    expect(lineAngleDeg(0, 0, 10, 0)).toBe(0)
  })
  it('keeps angle within ±90', () => {
    const angle = lineAngleDeg(0, 0, -10, 10)
    expect(Math.abs(angle)).toBeLessThanOrEqual(90)
  })
})

describe('smartEdgeFootage', () => {
  it('passes through normal values', () => {
    const result = smartEdgeFootage({ total_ridge_ft: 30, total_hip_ft: 40, total_valley_ft: 10, total_eave_ft: 80, total_rake_ft: 20 })
    expect(result['EAVE']).toBe(80)
    expect(result['RIDGE']).toBe(30)
  })
  it('copies HIP to RAKE when RAKE=0', () => {
    const result = smartEdgeFootage({ total_ridge_ft: 30, total_hip_ft: 40, total_valley_ft: 10, total_eave_ft: 80, total_rake_ft: 0 })
    expect(result['RAKE']).toBe(40)
  })
  it('copies RAKE to HIP when HIP=0', () => {
    const result = smartEdgeFootage({ total_ridge_ft: 30, total_hip_ft: 0, total_valley_ft: 10, total_eave_ft: 80, total_rake_ft: 20 })
    expect(result['HIP']).toBe(20)
  })
  it('falls back to proportional when all perimeter edges are 0', () => {
    const result = smartEdgeFootage({ total_ridge_ft: 10, total_hip_ft: 0, total_valley_ft: 5, total_eave_ft: 0, total_rake_ft: 0 })
    expect(result['EAVE']).toBeGreaterThan(0)
    expect(result['RAKE']).toBeGreaterThan(0)
  })
})

describe('latLngToPixels', () => {
  it('center maps to center of image', () => {
    const { x, y } = latLngToPixels(53.5, -113.5, 53.5, -113.5, 20)
    expect(x).toBeCloseTo(320, 0)
    expect(y).toBeCloseTo(320, 0)
  })
})

describe('computePixelToSqftScale', () => {
  it('returns 0 for 0 footprint', () => {
    expect(computePixelToSqftScale(null, 0)).toBe(0)
  })
  it('computes from facets', () => {
    const geo = {
      facets: [
        { id: 'A', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }], pitch: '20 deg', azimuth: '180 deg' },
        { id: 'B', points: [{ x: 0, y: 50 }, { x: 100, y: 50 }, { x: 100, y: 100 }, { x: 0, y: 100 }], pitch: '20 deg', azimuth: '0 deg' }
      ],
      perimeter: [],
      lines: [],
      obstructions: []
    }
    const scale = computePixelToSqftScale(geo as any, 2000)
    expect(scale).toBeGreaterThan(0)
    // 10000 px² → 2000 sqft → 0.2 sqft/px²
    expect(scale).toBeCloseTo(0.2, 2)
  })
})
