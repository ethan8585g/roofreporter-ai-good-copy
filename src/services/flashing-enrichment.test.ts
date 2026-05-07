import { describe, it, expect } from 'vitest'
import { deriveFlashingCounts, appendFlashingBom } from './flashing-enrichment'
import type { VisionFinding } from '../types'

const finding = (type: string): VisionFinding => ({
  id: `VF-${type}`,
  category: 'obstruction',
  type,
  label: type,
  description: '',
  severity: 'low',
  confidence: 80,
  impact: '',
  recommendation: '',
})

describe('deriveFlashingCounts', () => {
  it('returns zero counts when no findings', () => {
    expect(deriveFlashingCounts([])).toEqual({ chimney_flashing_count: 0, pipe_boot_count: 0 })
  })

  it('counts chimney findings', () => {
    const r = deriveFlashingCounts([finding('chimney'), finding('chimney')])
    expect(r.chimney_flashing_count).toBe(2)
    expect(r.pipe_boot_count).toBe(0)
  })

  it('counts pipe-boot variants under one bucket', () => {
    const r = deriveFlashingCounts([
      finding('pipe_boot'), finding('vent_stack'), finding('plumbing_vent'),
    ])
    expect(r.pipe_boot_count).toBe(3)
    expect(r.chimney_flashing_count).toBe(0)
  })

  it('ignores unrelated finding types', () => {
    const r = deriveFlashingCounts([finding('skylight'), finding('hvac_unit'), finding('moss')])
    expect(r).toEqual({ chimney_flashing_count: 0, pipe_boot_count: 0 })
  })
})

describe('appendFlashingBom', () => {
  const baseMaterials = () => ({
    line_items: [
      { category: 'shingles', description: 'X', unit: 'squares', net_quantity: 10, waste_pct: 5,
        gross_quantity: 11, order_quantity: 33, order_unit: 'bundles',
        unit_price_cad: 42, line_total_cad: 1386 },
    ],
    total_material_cost_cad: 1386,
  })

  it('adds nothing when counts are zero', () => {
    const m = baseMaterials()
    appendFlashingBom(m, { chimney_flashing_count: 0, pipe_boot_count: 0 }, {})
    expect(m.line_items).toHaveLength(1)
    expect(m.total_material_cost_cad).toBe(1386)
  })

  it('adds chimney + pipe-boot lines at user-supplied prices', () => {
    const m = baseMaterials()
    appendFlashingBom(
      m,
      { chimney_flashing_count: 2, pipe_boot_count: 4 },
      { chimney_flashing_kit: 95, pipe_boot_each: 18 },
    )
    expect(m.line_items).toHaveLength(3)
    const chimney = m.line_items.find((i: any) => i.category === 'chimney_flashing')
    const pipe    = m.line_items.find((i: any) => i.category === 'pipe_boot')
    expect(chimney?.unit_price_cad).toBe(95)
    expect(chimney?.line_total_cad).toBe(190)
    expect(pipe?.unit_price_cad).toBe(18)
    expect(pipe?.line_total_cad).toBe(72)
    expect(m.total_material_cost_cad).toBe(1386 + 190 + 72)
  })

  it('falls back to default prices when user prices missing', () => {
    const m = baseMaterials()
    appendFlashingBom(m, { chimney_flashing_count: 1, pipe_boot_count: 1 }, {})
    const chimney = m.line_items.find((i: any) => i.category === 'chimney_flashing')
    const pipe    = m.line_items.find((i: any) => i.category === 'pipe_boot')
    expect(chimney?.unit_price_cad).toBe(65)
    expect(pipe?.unit_price_cad).toBe(12)
  })

  it('is idempotent — re-running does not double-add lines', () => {
    const m = baseMaterials()
    const counts = { chimney_flashing_count: 1, pipe_boot_count: 1 }
    appendFlashingBom(m, counts, {})
    appendFlashingBom(m, counts, {})
    expect(m.line_items.filter((i: any) => i.category === 'chimney_flashing')).toHaveLength(1)
    expect(m.line_items.filter((i: any) => i.category === 'pipe_boot')).toHaveLength(1)
  })

  it('only adds the categories with non-zero counts', () => {
    const m = baseMaterials()
    appendFlashingBom(m, { chimney_flashing_count: 1, pipe_boot_count: 0 }, {})
    expect(m.line_items.find((i: any) => i.category === 'chimney_flashing')).toBeDefined()
    expect(m.line_items.find((i: any) => i.category === 'pipe_boot')).toBeUndefined()
  })
})
