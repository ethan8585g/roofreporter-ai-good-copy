import { describe, it, expect } from 'vitest'
import {
  buildContentPrompt,
  buildQualityPrompt,
  parseDraft,
  parseQualityScore,
} from './content-agent'
import type { QueueRow } from './blog-agent'

// ── Fixtures ──────────────────────────────────────────────────

const baseRow: QueueRow = {
  id: 1,
  keyword: 'roof replacement cost Canada',
  geo_modifier: 'Ontario',
  intent: 'commercial',
  target_category: 'roofing',
  attempts: 0,
}

const rowNoGeo: QueueRow = { ...baseRow, geo_modifier: null }

// ── buildContentPrompt ────────────────────────────────────────

describe('buildContentPrompt', () => {
  it('includes the keyword in the prompt', () => {
    const prompt = buildContentPrompt(baseRow)
    expect(prompt).toContain('roof replacement cost Canada')
  })

  it('includes the geo modifier when present', () => {
    const prompt = buildContentPrompt(baseRow)
    expect(prompt).toContain('Ontario')
  })

  it('does not include geo section when geo_modifier is null', () => {
    const prompt = buildContentPrompt(rowNoGeo)
    expect(prompt).not.toContain('undefined')
    expect(prompt).not.toContain('null')
  })

  it('includes the intent', () => {
    const prompt = buildContentPrompt(baseRow)
    expect(prompt).toContain('commercial')
  })

  it('instructs JSON-only output', () => {
    const prompt = buildContentPrompt(baseRow)
    expect(prompt).toContain('STRICT JSON')
  })
})

// ── buildQualityPrompt ────────────────────────────────────────

describe('buildQualityPrompt', () => {
  const draft = {
    title: 'Test Title',
    slug: 'test-title',
    excerpt: 'Test excerpt',
    meta_title: 'Test',
    meta_description: 'Test desc',
    content_html: '<article>hello world</article>',
    tags: ['roofing'],
    read_time_minutes: 5,
  }

  it('includes the keyword', () => {
    const prompt = buildQualityPrompt(baseRow, draft)
    expect(prompt).toContain('roof replacement cost Canada')
  })

  it('includes the draft title', () => {
    const prompt = buildQualityPrompt(baseRow, draft)
    expect(prompt).toContain('Test Title')
  })
})

// ── parseDraft ────────────────────────────────────────────────

describe('parseDraft', () => {
  it('parses valid JSON draft', () => {
    const json = JSON.stringify({
      title: 'How to Replace a Roof in Ontario',
      slug: 'replace-roof-ontario',
      excerpt: 'A guide.',
      meta_title: 'Roof Replacement Ontario',
      meta_description: 'Learn about roof replacement in Ontario, Canada.',
      content_html: '<article><h1>Intro</h1><p>Body text here.</p></article>',
      tags: ['roofing', 'ontario'],
      read_time_minutes: 7,
    })
    const draft = parseDraft(json)
    expect(draft.title).toBe('How to Replace a Roof in Ontario')
    expect(draft.slug).toBe('replace-roof-ontario')
    expect(draft.content_html).toContain('<article>')
  })

  it('strips markdown code fences before parsing', () => {
    const json = '```json\n{"title":"T","slug":"s","content_html":"<p>x</p>","excerpt":"e","meta_title":"m","meta_description":"md","tags":[],"read_time_minutes":5}\n```'
    const draft = parseDraft(json)
    expect(draft.title).toBe('T')
  })

  it('throws on missing required fields', () => {
    expect(() => parseDraft(JSON.stringify({ title: 'Only title' }))).toThrow()
  })

  it('throws on invalid JSON', () => {
    expect(() => parseDraft('not json at all')).toThrow()
  })
})

// ── parseQualityScore ─────────────────────────────────────────

describe('parseQualityScore', () => {
  it('parses a valid score object', () => {
    const json = JSON.stringify({
      overall: 85,
      eeat: 80,
      keyword_fit: 90,
      readability: 88,
      schema_present: true,
      internal_links: 3,
      issues: [],
    })
    const score = parseQualityScore(json)
    expect(score.overall).toBe(85)
    expect(score.schema_present).toBe(true)
    expect(score.internal_links).toBe(3)
  })

  it('clamps overall above 100 to 100', () => {
    const json = JSON.stringify({ overall: 150, eeat: 50, keyword_fit: 50, readability: 50, schema_present: false, internal_links: 0, issues: [] })
    const score = parseQualityScore(json)
    expect(score.overall).toBe(100)
  })

  it('clamps negative scores to 0', () => {
    const json = JSON.stringify({ overall: -10, eeat: -5, keyword_fit: 0, readability: 0, schema_present: false, internal_links: -1, issues: [] })
    const score = parseQualityScore(json)
    expect(score.overall).toBe(0)
    expect(score.internal_links).toBe(0)
  })

  it('defaults issues to empty array if not an array', () => {
    const json = JSON.stringify({ overall: 70, eeat: 70, keyword_fit: 70, readability: 70, schema_present: false, internal_links: 1 })
    const score = parseQualityScore(json)
    expect(Array.isArray(score.issues)).toBe(true)
    expect(score.issues).toHaveLength(0)
  })
})
