// ═══════════════════════════════════════════════════════════════
// PITCH / SLOPE MATH — industry-standard pitch multiplier tables
//
// The pitch multiplier converts flat (2D projected) roof area to
// true sloped surface area. Derived from the Pythagorean theorem:
//   multiplier = √(rise² + 12²) / 12
//
// Tables cover 0:12 (flat) through 24:12 (extreme steep) for the
// main rafter slope; hip/valley rafters run diagonally across the
// plan at 45° so the effective run is √2 × 12.
//
// Extracted from roof-measurement-engine.ts so the tables + lookups
// have their own test file and callers can unit-test them directly.
// ═══════════════════════════════════════════════════════════════

export const ROOF_PITCH_MULTIPLIERS: Record<number, number> = {
  0:  1.0000,  // Flat roof
  1:  1.0035,
  2:  1.0138,
  3:  1.0308,
  4:  1.0541,
  5:  1.0833,
  6:  1.1180,
  7:  1.1577,
  8:  1.2019,
  9:  1.2500,
  10: 1.3017,
  11: 1.3566,
  12: 1.4142,  // 45° — standard max residential
  13: 1.4743,
  14: 1.5366,
  15: 1.6008,
  16: 1.6667,
  17: 1.7340,
  18: 1.8028,
  19: 1.8728,
  20: 1.9437,
  21: 2.0156,
  22: 2.0881,
  23: 2.1612,
  24: 2.2361,  // Extreme steep (commercial/heritage)
}

export const HIP_VALLEY_MULTIPLIERS: Record<number, number> = {
  0:  1.0000,
  1:  1.0017,
  2:  1.0069,
  3:  1.0155,
  4:  1.0275,
  5:  1.0426,
  6:  1.0607,
  7:  1.0816,
  8:  1.1050,
  9:  1.1308,
  10: 1.1588,
  11: 1.1887,
  12: 1.2203,
}

/**
 * Industry-standard pitch multiplier: rise/12 → area multiplier.
 *
 * - Exact integer lookup for 0–24.
 * - Linear interpolation between table entries for fractional pitches.
 * - Beyond table (rise > 24): Pythagorean fallback √(rise²+144)/12.
 * - Negative/zero clamps to 1.0 (flat).
 */
export function slopeFactor(rise: number): number {
  if (!Number.isFinite(rise) || rise <= 0) return 1.0

  const intRise = Math.floor(rise)
  if (rise === intRise && ROOF_PITCH_MULTIPLIERS[intRise] !== undefined) {
    return ROOF_PITCH_MULTIPLIERS[intRise]
  }

  const lower = ROOF_PITCH_MULTIPLIERS[intRise]
  const upper = ROOF_PITCH_MULTIPLIERS[intRise + 1]
  if (lower !== undefined && upper !== undefined) {
    const fraction = rise - intRise
    return lower + (upper - lower) * fraction
  }

  return Math.sqrt(rise * rise + 144) / 12
}

/**
 * Hip/valley rafter pitch multiplier (diagonal at 45° plan angle).
 * Formula: √(rise² + 288) / √288.
 */
export function hipSlopeFactor(rise: number): number {
  if (!Number.isFinite(rise) || rise <= 0) return 1.0

  const intRise = Math.floor(rise)
  if (rise === intRise && HIP_VALLEY_MULTIPLIERS[intRise] !== undefined) {
    return HIP_VALLEY_MULTIPLIERS[intRise]
  }

  const lower = HIP_VALLEY_MULTIPLIERS[intRise]
  const upper = HIP_VALLEY_MULTIPLIERS[intRise + 1]
  if (lower !== undefined && upper !== undefined) {
    const fraction = rise - intRise
    return lower + (upper - lower) * fraction
  }

  return Math.sqrt(rise * rise + 288) / Math.sqrt(288)
}

/** Rise:12 → angle in degrees. */
export function pitchAngleDeg(rise: number): number {
  return Math.atan(rise / 12) * 180 / Math.PI
}

/** Rise:12 → angle in radians. */
export function pitchAngleRad(rise: number): number {
  return Math.atan(rise / 12)
}
