import { describe, it, expect } from 'vitest'
import { calculateTotals } from './invoices'

/**
 * Phase 1 — Unified Proposals Test Suite
 *
 * Validates that the proposal unification (invoices table with
 * document_type='proposal') maintains backward compatibility with
 * the legacy crm_proposals response shape.
 */

// Reproduce the mapInvoiceToLegacyProposal function from crm.ts
// so we can test it in isolation without importing the whole route module.
function mapInvoiceToLegacyProposal(row: any): any {
  if (!row) return row
  return {
    ...row,
    proposal_number: row.invoice_number ?? row.proposal_number,
    total_amount: row.total ?? row.total_amount ?? 0,
    view_count: row.viewed_count ?? row.view_count ?? 0,
    last_viewed_at: row.viewed_at ?? row.last_viewed_at,
    owner_id: row.customer_id ?? row.owner_id,
    payment_terms: row.payment_terms_text ?? row.payment_terms,
    tier_label: row.proposal_tier ?? row.tier_label ?? '',
  }
}

describe('mapInvoiceToLegacyProposal — field mapping', () => {
  it('maps invoices row fields to legacy crm_proposals shape', () => {
    const invoiceRow = {
      id: 42,
      invoice_number: 'PROP-20260417-0001',
      customer_id: 7,
      crm_customer_id: 100,
      document_type: 'proposal',
      total: 5250.00,
      subtotal: 5000.00,
      tax_rate: 5,
      tax_amount: 250.00,
      viewed_count: 3,
      viewed_at: '2026-04-16T10:00:00Z',
      payment_terms_text: 'Net 30',
      proposal_tier: 'Better',
      proposal_group_id: 'abc-123',
      status: 'sent',
      scope_of_work: 'Full re-roof with architectural shingles',
    }

    const legacy = mapInvoiceToLegacyProposal(invoiceRow)

    // Legacy field names map correctly
    expect(legacy.proposal_number).toBe('PROP-20260417-0001')
    expect(legacy.total_amount).toBe(5250.00)
    expect(legacy.view_count).toBe(3)
    expect(legacy.last_viewed_at).toBe('2026-04-16T10:00:00Z')
    expect(legacy.owner_id).toBe(7)
    expect(legacy.payment_terms).toBe('Net 30')
    expect(legacy.tier_label).toBe('Better')

    // Original fields are preserved
    expect(legacy.invoice_number).toBe('PROP-20260417-0001')
    expect(legacy.total).toBe(5250.00)
    expect(legacy.customer_id).toBe(7)
    expect(legacy.document_type).toBe('proposal')
    expect(legacy.scope_of_work).toBe('Full re-roof with architectural shingles')
  })

  it('handles null/undefined gracefully', () => {
    expect(mapInvoiceToLegacyProposal(null)).toBeNull()
    expect(mapInvoiceToLegacyProposal(undefined)).toBeUndefined()
  })

  it('defaults total_amount to 0 when both total and total_amount are missing', () => {
    const row = { id: 1 }
    const legacy = mapInvoiceToLegacyProposal(row)
    expect(legacy.total_amount).toBe(0)
  })

  it('prefers invoices fields over legacy names when both exist', () => {
    const row = {
      invoice_number: 'PROP-NEW',
      proposal_number: 'PROP-OLD',
      total: 100,
      total_amount: 200,
      viewed_count: 5,
      view_count: 2,
      customer_id: 10,
      owner_id: 20,
    }
    const legacy = mapInvoiceToLegacyProposal(row)
    expect(legacy.proposal_number).toBe('PROP-NEW')
    expect(legacy.total_amount).toBe(100)
    expect(legacy.view_count).toBe(5)
    expect(legacy.owner_id).toBe(10)
  })
})

describe('calculateTotals — proposal regression', () => {
  it('proposal with tiered line items computes correctly', () => {
    // Simulate a Better-tier proposal: 28 sq of architectural shingles
    const items = [
      { description: 'Architectural Shingles (28 sq)', quantity: 28, unit_price: 145, is_taxable: true },
      { description: 'Tear-off & disposal', quantity: 1, unit_price: 800, is_taxable: true },
      { description: 'Underlayment (synthetic)', quantity: 28, unit_price: 15, is_taxable: true },
      { description: 'Ridge cap', quantity: 1, unit_price: 350, is_taxable: true },
      { description: 'Labor', quantity: 1, unit_price: 2800, is_taxable: false },
    ]
    const r = calculateTotals(items, 5, 0, 'fixed')

    // Subtotal: (28*145) + 800 + (28*15) + 350 + 2800 = 4060 + 800 + 420 + 350 + 2800 = 8430
    expect(r.subtotal).toBe(8430)
    // Taxable: 4060 + 800 + 420 + 350 = 5630; tax = 5630 * 0.05 = 281.50
    expect(r.taxAmount).toBe(281.50)
    // Total: 8430 - 0 + 281.50 = 8711.50
    expect(r.total).toBe(8711.50)
  })

  it('steep-pitch scenario with percentage discount', () => {
    const items = [
      { description: 'Designer shingles (32 sq) — steep pitch', quantity: 32, unit_price: 225, is_taxable: true },
      { description: 'Steep pitch premium (25%)', quantity: 1, unit_price: 1800, is_taxable: true },
      { description: 'Ice & water shield', quantity: 1, unit_price: 950, is_taxable: true },
    ]
    const r = calculateTotals(items, 5, 10, 'percentage')

    // Subtotal: 7200 + 1800 + 950 = 9950
    expect(r.subtotal).toBe(9950)
    // Discount: 10% of 9950 = 995
    expect(r.discount).toBe(995)
    // P1-27: DISCOUNT_APPLIED_BEFORE_TAX = true. Tax is on the discounted
    // taxable subtotal: (9950 - 995) * 5% = 8955 * 0.05 = 447.75.
    expect(r.taxAmount).toBe(447.75)
    // Total: 9950 - 995 + 447.75 = 9402.75
    expect(r.total).toBe(9402.75)
  })
})
