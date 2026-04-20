import { describe, it, expect } from 'vitest'
import { calculateTotals } from './invoices'

// These tests pin down the money math that goes into every invoice, proposal,
// and Square payment link. A rounding bug here would silently overcharge or
// undercharge customers, so each case locks exact expected values rather than
// asserting ranges.

describe('calculateTotals — basic math', () => {
  it('computes subtotal, tax, and total for a single taxable item', () => {
    const r = calculateTotals(
      [{ quantity: 2, unit_price: 100 }],
      5,   // 5% tax
      0,
      'fixed'
    )
    expect(r.subtotal).toBe(200)
    expect(r.taxAmount).toBe(10)
    expect(r.discount).toBe(0)
    expect(r.total).toBe(210)
  })

  it('handles multiple line items', () => {
    const r = calculateTotals(
      [
        { quantity: 3, unit_price: 50 },    // 150
        { quantity: 1, unit_price: 199.99 } // 199.99
      ],
      0, 0
    )
    expect(r.subtotal).toBe(349.99)
    expect(r.total).toBe(349.99)
  })

  it('defaults quantity to 1 and unit_price to 0 when missing', () => {
    const r = calculateTotals([{ unit_price: 100 }, { quantity: 2 }], 0, 0)
    expect(r.subtotal).toBe(100)
    expect(r.total).toBe(100)
  })

  it('never produces a negative total', () => {
    const r = calculateTotals(
      [{ quantity: 1, unit_price: 50 }],
      0,
      999,  // discount larger than subtotal
      'fixed'
    )
    expect(r.total).toBe(0)
  })
})

describe('calculateTotals — taxable flag', () => {
  it('excludes non-taxable items from tax base', () => {
    const r = calculateTotals(
      [
        { quantity: 1, unit_price: 100, is_taxable: true },
        { quantity: 1, unit_price: 100, is_taxable: false }
      ],
      10, 0
    )
    // subtotal = 200, taxable = 100, tax = 10
    expect(r.subtotal).toBe(200)
    expect(r.taxAmount).toBe(10)
    expect(r.total).toBe(210)
  })

  it('treats is_taxable === 0 as non-taxable (SQLite boolean semantics)', () => {
    const r = calculateTotals(
      [{ quantity: 1, unit_price: 100, is_taxable: 0 }],
      10, 0
    )
    expect(r.taxAmount).toBe(0)
    expect(r.total).toBe(100)
  })

  it('treats missing is_taxable as taxable (default true)', () => {
    const r = calculateTotals(
      [{ quantity: 1, unit_price: 100 }],
      10, 0
    )
    expect(r.taxAmount).toBe(10)
  })
})

describe('calculateTotals — discount types', () => {
  it('applies discount before computing tax (Canadian tax compliance)', () => {
    const r = calculateTotals(
      [{ quantity: 1, unit_price: 1000 }],
      5,
      100,
      'fixed'
    )
    // Discount is applied proportionally to taxable amount before tax:
    //   discount = 100, discountRatio = 100/1000 = 0.10
    //   taxableAfterDiscount = 1000 * (1 - 0.10) = 900
    //   tax = 900 * 5% = 45
    //   total = 1000 - 100 + 45 = 945
    expect(r.discount).toBe(100)
    expect(r.taxAmount).toBe(45)
    expect(r.total).toBe(945)
  })

  it('applies a percentage discount to the subtotal', () => {
    const r = calculateTotals(
      [{ quantity: 1, unit_price: 1000 }],
      0,
      10,          // 10% off
      'percentage'
    )
    expect(r.discount).toBe(100) // 10% of 1000
    expect(r.total).toBe(900)
  })

  it('rounds percentage discount to cents', () => {
    const r = calculateTotals(
      [{ quantity: 1, unit_price: 33.33 }],
      0,
      10,
      'percentage'
    )
    // 10% of 33.33 = 3.333 → rounds to 3.33
    expect(r.discount).toBe(3.33)
    expect(r.total).toBe(30)
  })
})

describe('calculateTotals — rounding edge cases', () => {
  it('rounds subtotal to 2 decimals', () => {
    const r = calculateTotals(
      [{ quantity: 3, unit_price: 0.3333 }],
      0, 0
    )
    // 3 * 0.3333 = 0.9999 → rounds to 1.00
    expect(r.subtotal).toBe(1)
  })

  it('rounds tax to 2 decimals', () => {
    const r = calculateTotals(
      [{ quantity: 1, unit_price: 123.45 }],
      7, 0
    )
    // 123.45 * 0.07 = 8.6415 → rounds to 8.64
    expect(r.taxAmount).toBe(8.64)
  })

  it('handles zero-item invoice', () => {
    const r = calculateTotals([], 5, 0, 'fixed')
    expect(r.subtotal).toBe(0)
    expect(r.taxAmount).toBe(0)
    expect(r.total).toBe(0)
  })
})
