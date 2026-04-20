import { describe, it, expect } from 'vitest'
import {
  slopeFactor,
  hipSlopeFactor,
  pitchAngleDeg,
  pitchAngleRad,
  ROOF_PITCH_MULTIPLIERS,
} from './pitch'

describe('slopeFactor — integer pitches match lookup table', () => {
  it('0:12 → 1.0000 (flat)', () => {
    expect(slopeFactor(0)).toBe(1.0)
  })
  it('4:12 → 1.0541', () => {
    expect(slopeFactor(4)).toBeCloseTo(1.0541, 4)
  })
  it('6:12 → 1.1180', () => {
    expect(slopeFactor(6)).toBeCloseTo(1.1180, 4)
  })
  it('8:12 → 1.2019', () => {
    expect(slopeFactor(8)).toBeCloseTo(1.2019, 4)
  })
  it('10:12 → 1.3017', () => {
    expect(slopeFactor(10)).toBeCloseTo(1.3017, 4)
  })
  it('12:12 → 1.4142 (45°)', () => {
    expect(slopeFactor(12)).toBeCloseTo(1.4142, 4)
  })
  it('16:12 → 1.6667', () => {
    expect(slopeFactor(16)).toBeCloseTo(1.6667, 4)
  })
  it('24:12 → 2.2361 (extreme)', () => {
    expect(slopeFactor(24)).toBeCloseTo(2.2361, 4)
  })
})

describe('slopeFactor — fractional interpolation', () => {
  it('4.5:12 lies between 4 and 5', () => {
    const lo = slopeFactor(4), hi = slopeFactor(5), mid = slopeFactor(4.5)
    expect(mid).toBeGreaterThan(lo)
    expect(mid).toBeLessThan(hi)
    expect(mid).toBeCloseTo((lo + hi) / 2, 4)
  })
  it('4.25:12 interpolates 25% of the gap', () => {
    const lo = slopeFactor(4), hi = slopeFactor(5)
    expect(slopeFactor(4.25)).toBeCloseTo(lo + (hi - lo) * 0.25, 6)
  })
  it('11.7:12 sits within [11, 12]', () => {
    const lo = slopeFactor(11), hi = slopeFactor(12)
    const v = slopeFactor(11.7)
    expect(v).toBeGreaterThan(lo)
    expect(v).toBeLessThan(hi)
    expect(v).toBeCloseTo(lo + (hi - lo) * 0.7, 6)
  })
})

describe('slopeFactor — out of range', () => {
  it('negative rise clamps to 1.0', () => {
    expect(slopeFactor(-3)).toBe(1.0)
  })
  it('rise > 24 uses Pythagorean fallback', () => {
    // rise=30 → √(900+144)/12 = √1044/12 ≈ 2.6926
    expect(slopeFactor(30)).toBeCloseTo(Math.sqrt(1044) / 12, 4)
  })
  it('NaN clamps to 1.0', () => {
    expect(slopeFactor(NaN)).toBe(1.0)
  })
})

describe('hipSlopeFactor', () => {
  it('0:12 → 1.0000', () => {
    expect(hipSlopeFactor(0)).toBe(1.0)
  })
  it('12:12 → 1.2203', () => {
    expect(hipSlopeFactor(12)).toBeCloseTo(1.2203, 4)
  })
  it('beyond table falls back to Pythagorean', () => {
    // rise=18 → √(324+288)/√288 = √612/√288
    expect(hipSlopeFactor(18)).toBeCloseTo(Math.sqrt(612) / Math.sqrt(288), 4)
  })
  it('negative rise clamps to 1.0', () => {
    expect(hipSlopeFactor(-5)).toBe(1.0)
  })
})

describe('pitchAngleDeg / pitchAngleRad', () => {
  it('0:12 → 0°', () => {
    expect(pitchAngleDeg(0)).toBe(0)
  })
  it('12:12 → 45°', () => {
    expect(pitchAngleDeg(12)).toBeCloseTo(45, 6)
  })
  it('6:12 → 26.565°', () => {
    expect(pitchAngleDeg(6)).toBeCloseTo(26.5651, 3)
  })
  it('pitchAngleRad(12) = π/4', () => {
    expect(pitchAngleRad(12)).toBeCloseTo(Math.PI / 4, 6)
  })
})

describe('bundle-count material take-off sanity', () => {
  // Integration-flavour check: area × slopeFactor should land in expected bands.
  // 2000 sqft flat × slope(6) ≈ 2236 sqft sloped → ~23 bundles at 33 sqft/bundle.
  it('2000 sqft flat at 6:12 pitch → ~2236 sqft sloped', () => {
    const flat = 2000
    const sloped = flat * slopeFactor(6)
    expect(sloped).toBeGreaterThan(2230)
    expect(sloped).toBeLessThan(2240)
  })

  it('500 sqft flat at 4:12 pitch → ~527 sqft sloped', () => {
    const sloped = 500 * slopeFactor(4)
    expect(sloped).toBeCloseTo(527.05, 0)
  })
})

describe('ROOF_PITCH_MULTIPLIERS table invariants', () => {
  it('is monotonically non-decreasing across 0..24', () => {
    for (let i = 1; i <= 24; i++) {
      expect(ROOF_PITCH_MULTIPLIERS[i]).toBeGreaterThanOrEqual(ROOF_PITCH_MULTIPLIERS[i - 1])
    }
  })
  it('every entry is ≥ 1.0', () => {
    for (let i = 0; i <= 24; i++) {
      expect(ROOF_PITCH_MULTIPLIERS[i]).toBeGreaterThanOrEqual(1.0)
    }
  })
})
