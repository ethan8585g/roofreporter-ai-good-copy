import { describe, it, expect } from 'vitest'
import { computeBlendedCpl, shouldTriggerKillSwitch } from './lead-attribution'

describe('lead-attribution', () => {
  describe('computeBlendedCpl', () => {
    it('returns 0 when no qualified leads', () => {
      expect(computeBlendedCpl(10000, 5000, 0)).toBe(0)
    })

    it('returns 0 when no cost', () => {
      expect(computeBlendedCpl(0, 0, 10)).toBe(0)
    })

    it('computes correct CPL with boost spend only', () => {
      // $100 boost spend, 0 production cost, 5 leads
      expect(computeBlendedCpl(10000, 0, 5)).toBe(2000) // $20 per lead
    })

    it('computes correct CPL with production cost only', () => {
      // 0 boost, $5 production cost, 5 leads
      expect(computeBlendedCpl(0, 500, 5)).toBe(100) // $1 per lead
    })

    it('sums boost and production costs', () => {
      // $100 boost + $50 production, 10 leads
      expect(computeBlendedCpl(10000, 5000, 10)).toBe(1500) // $15 per lead
    })

    it('rounds to nearest cent', () => {
      // $10 total, 3 leads = 333.33 cents
      expect(computeBlendedCpl(700, 300, 3)).toBe(333)
    })

    it('handles negative qualified leads as 0', () => {
      expect(computeBlendedCpl(1000, 500, -1)).toBe(0)
    })
  })

  describe('shouldTriggerKillSwitch', () => {
    it('triggers when CPL exceeds ceiling with leads', () => {
      expect(shouldTriggerKillSwitch(6100, 6000, 5)).toBe(true)
    })

    it('does not trigger when CPL is below ceiling', () => {
      expect(shouldTriggerKillSwitch(5000, 6000, 5)).toBe(false)
    })

    it('does not trigger at exactly the ceiling', () => {
      expect(shouldTriggerKillSwitch(6000, 6000, 5)).toBe(false)
    })

    it('does not trigger with 0 leads even if CPL is high', () => {
      expect(shouldTriggerKillSwitch(99999, 6000, 0)).toBe(false)
    })

    it('does not trigger with negative leads', () => {
      expect(shouldTriggerKillSwitch(99999, 6000, -1)).toBe(false)
    })

    it('triggers with exactly 1 lead above ceiling', () => {
      expect(shouldTriggerKillSwitch(6001, 6000, 1)).toBe(true)
    })
  })
})
