import { describe, it, expect } from 'vitest'
import { deriveGutterMeasurements, appendGutterBom } from './gutter-enrichment'

describe('deriveGutterMeasurements', () => {
  it('returns zero for empty edge summary', () => {
    expect(deriveGutterMeasurements(null)).toEqual({ gutter_lf: 0, downspout_count: 0 })
    expect(deriveGutterMeasurements({})).toEqual({ gutter_lf: 0, downspout_count: 0 })
  })

  it('uses total_eave_ft as gutter LF', () => {
    expect(deriveGutterMeasurements({ total_eave_ft: 100 })).toEqual({
      gutter_lf: 100, downspout_count: 3, // ceil(100/35) = 3
    })
  })

  it('rounds gutter LF to nearest foot', () => {
    expect(deriveGutterMeasurements({ total_eave_ft: 87.4 }).gutter_lf).toBe(87)
    expect(deriveGutterMeasurements({ total_eave_ft: 87.6 }).gutter_lf).toBe(88)
  })

  it('downspouts: ceil(gutter_lf / 35)', () => {
    expect(deriveGutterMeasurements({ total_eave_ft: 35 }).downspout_count).toBe(1)
    expect(deriveGutterMeasurements({ total_eave_ft: 36 }).downspout_count).toBe(2)
    expect(deriveGutterMeasurements({ total_eave_ft: 70 }).downspout_count).toBe(2)
    expect(deriveGutterMeasurements({ total_eave_ft: 71 }).downspout_count).toBe(3)
  })

  it('floors negative input to zero', () => {
    expect(deriveGutterMeasurements({ total_eave_ft: -10 })).toEqual({
      gutter_lf: 0, downspout_count: 0,
    })
  })
})

describe('appendGutterBom', () => {
  const baseMaterials = () => ({
    line_items: [
      { category: 'shingles', description: 'X', unit: 'squares', net_quantity: 10, waste_pct: 5,
        gross_quantity: 11, order_quantity: 33, order_unit: 'bundles',
        unit_price_cad: 42, line_total_cad: 1386 },
    ],
    total_material_cost_cad: 1386,
  })

  it('skips when LF is zero', () => {
    const m = baseMaterials()
    appendGutterBom(m, { gutter_lf: 0 }, {})
    expect(m.line_items).toHaveLength(1)
    expect(m.total_material_cost_cad).toBe(1386)
  })

  it('adds one gutter line at user-supplied price with 5% waste', () => {
    const m = baseMaterials()
    appendGutterBom(m, { gutter_lf: 100 }, { gutter_lf: 5.25 })
    expect(m.line_items).toHaveLength(2)
    const g = m.line_items.find((i: any) => i.category === 'gutters')
    expect(g?.net_quantity).toBe(100)
    expect(g?.gross_quantity).toBe(105) // ceil(100 * 1.05)
    expect(g?.unit_price_cad).toBe(5.25)
    expect(g?.line_total_cad).toBe(551.25) // 105 * 5.25
    expect(m.total_material_cost_cad).toBe(1386 + 551.25)
  })

  it('falls back to default price when user price missing', () => {
    const m = baseMaterials()
    appendGutterBom(m, { gutter_lf: 100 }, {})
    const g = m.line_items.find((i: any) => i.category === 'gutters')
    expect(g?.unit_price_cad).toBe(4.50)
  })

  it('is idempotent — re-running does not double-add', () => {
    const m = baseMaterials()
    appendGutterBom(m, { gutter_lf: 100 }, {})
    appendGutterBom(m, { gutter_lf: 100 }, {})
    expect(m.line_items.filter((i: any) => i.category === 'gutters')).toHaveLength(1)
  })
})
