import { describe, it, expect } from 'vitest'
import { scoreHashtag } from './research-engine'

describe('research-engine', () => {
  describe('scoreHashtag', () => {
    it('returns 0 when all values are 0', () => {
      expect(scoreHashtag(0, 0, 10, 100)).toBe(0)
    })

    it('returns 1 when frequency and engagement are at max', () => {
      expect(scoreHashtag(10, 100, 10, 100)).toBe(1)
    })

    it('weighs engagement more than frequency (60/40)', () => {
      // High frequency, low engagement
      const highFreqLowEng = scoreHashtag(10, 10, 10, 100)
      // Low frequency, high engagement
      const lowFreqHighEng = scoreHashtag(2, 100, 10, 100)

      expect(lowFreqHighEng).toBeGreaterThan(highFreqLowEng)
    })

    it('normalizes correctly with different maxes', () => {
      const score = scoreHashtag(5, 50, 10, 100)
      // freqNorm = 5/10 = 0.5, engNorm = 50/100 = 0.5
      // score = 0.5 * 0.4 + 0.5 * 0.6 = 0.2 + 0.3 = 0.5
      expect(score).toBe(0.5)
    })

    it('handles maxFreq of 0 gracefully', () => {
      const score = scoreHashtag(0, 50, 0, 100)
      // freqNorm = 0, engNorm = 0.5
      // score = 0 + 0.5 * 0.6 = 0.3
      expect(score).toBe(0.3)
    })

    it('handles maxEng of 0 gracefully', () => {
      const score = scoreHashtag(5, 0, 10, 0)
      // freqNorm = 0.5, engNorm = 0
      // score = 0.5 * 0.4 = 0.2
      expect(score).toBe(0.2)
    })

    it('produces scores between 0 and 1', () => {
      for (let i = 0; i < 100; i++) {
        const freq = Math.random() * 100
        const eng = Math.random() * 1000
        const maxFreq = Math.max(freq, Math.random() * 100)
        const maxEng = Math.max(eng, Math.random() * 1000)
        const score = scoreHashtag(freq, eng, maxFreq, maxEng)
        expect(score).toBeGreaterThanOrEqual(0)
        expect(score).toBeLessThanOrEqual(1)
      }
    })
  })
})
