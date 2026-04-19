import { describe, it, expect } from 'vitest'
import { calculateMedianCpl, shouldPauseBoost } from './boost-engine'

describe('boost-engine', () => {
  describe('calculateMedianCpl', () => {
    it('returns 0 for empty array', () => {
      expect(calculateMedianCpl([])).toBe(0)
    })

    it('returns the single value for 1-element array', () => {
      expect(calculateMedianCpl([5000])).toBe(5000)
    })

    it('returns middle value for odd-length array', () => {
      expect(calculateMedianCpl([1000, 3000, 5000])).toBe(3000)
    })

    it('returns lower-middle for even-length array', () => {
      // [1000, 2000, 3000, 4000] → floor(4/2) = index 2 → 3000
      expect(calculateMedianCpl([1000, 2000, 3000, 4000])).toBe(3000)
    })

    it('sorts input before finding median', () => {
      // Unsorted: [5000, 1000, 3000]
      expect(calculateMedianCpl([5000, 1000, 3000])).toBe(3000)
    })

    it('does not mutate input array', () => {
      const input = [5000, 1000, 3000]
      calculateMedianCpl(input)
      expect(input).toEqual([5000, 1000, 3000])
    })
  })

  describe('shouldPauseBoost', () => {
    it('pauses when CPL is more than 2x median', () => {
      expect(shouldPauseBoost(6001, 3000)).toBe(true)
    })

    it('does not pause at exactly 2x median', () => {
      expect(shouldPauseBoost(6000, 3000)).toBe(false)
    })

    it('does not pause below 2x median', () => {
      expect(shouldPauseBoost(5000, 3000)).toBe(false)
    })

    it('pauses when CPL is massively above median', () => {
      expect(shouldPauseBoost(100000, 3000)).toBe(true)
    })

    it('handles 0 median (never pauses since 0*2=0 and any CPL > 0)', () => {
      expect(shouldPauseBoost(1, 0)).toBe(true)
    })
  })

  describe('reallocation rule with fixture of 5 boosts', () => {
    it('identifies correct boosts to pause and boost', () => {
      const boosts = [
        { id: 1, cpl: 2000, leads: 10, budget: 1000 },
        { id: 2, cpl: 3000, leads: 5, budget: 1500 },
        { id: 3, cpl: 8000, leads: 2, budget: 2000 },  // Should be paused (8000 > 3000*2)
        { id: 4, cpl: 1500, leads: 15, budget: 500 },   // Best performer
        { id: 5, cpl: 12000, leads: 1, budget: 1000 },  // Should be paused (12000 > 3000*2)
      ]

      const cpls = boosts.map(b => b.cpl).sort((a, b) => a - b)
      const median = calculateMedianCpl(cpls)
      expect(median).toBe(3000)

      const toPause = boosts.filter(b => shouldPauseBoost(b.cpl, median))
      expect(toPause.map(b => b.id)).toEqual([3, 5])

      const savedBudget = toPause.reduce((sum, b) => sum + b.budget, 0)
      expect(savedBudget).toBe(3000) // 2000 + 1000

      const bestPerformer = boosts
        .filter(b => !shouldPauseBoost(b.cpl, median))
        .sort((a, b) => a.cpl - b.cpl)[0]
      expect(bestPerformer.id).toBe(4) // CPL 1500, lowest
      expect(bestPerformer.budget + savedBudget).toBe(3500) // 500 + 3000
    })
  })
})
