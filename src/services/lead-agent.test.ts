import { describe, it, expect } from 'vitest'
import { buildLeadPrompt, parseLeadEmail, shouldSkipLead, type LeadRow } from './lead-agent'

// ── Fixtures ──────────────────────────────────────────────────

const fullLead: LeadRow = {
  id: 1,
  email: 'john@acmeroofing.com',
  name: 'John Smith',
  company: 'Acme Roofing',
  address: '123 Maple Street, Toronto, ON',
  building_count: 3,
  source: 'homepage_cta',
}

const minimalLead: LeadRow = {
  id: 2,
  email: 'anon@example.com',
  source: 'other',
}

// ── buildLeadPrompt ───────────────────────────────────────────

describe('buildLeadPrompt', () => {
  it('includes the lead name', () => {
    const prompt = buildLeadPrompt(fullLead)
    expect(prompt).toContain('John Smith')
  })

  it('includes the company name', () => {
    const prompt = buildLeadPrompt(fullLead)
    expect(prompt).toContain('Acme Roofing')
  })

  it('includes the source label for homepage_cta', () => {
    const prompt = buildLeadPrompt(fullLead)
    expect(prompt).toContain('your website')
  })

  it('includes building count when > 1', () => {
    const prompt = buildLeadPrompt(fullLead)
    expect(prompt).toContain('3 buildings')
  })

  it('handles minimal lead without company or address', () => {
    const prompt = buildLeadPrompt(minimalLead)
    expect(prompt).not.toContain('undefined')
    expect(prompt).not.toContain('null')
    expect(prompt).toContain('there') // default name fallback
  })

  it('instructs JSON-only output', () => {
    const prompt = buildLeadPrompt(fullLead)
    expect(prompt).toContain('STRICT JSON')
  })

  it('maps demo_portal source correctly', () => {
    const lead = { ...fullLead, source: 'demo_portal' }
    const prompt = buildLeadPrompt(lead)
    expect(prompt).toContain('demo portal')
  })

  it('maps condo_cheat_sheet source correctly', () => {
    const lead = { ...fullLead, source: 'condo_cheat_sheet' }
    const prompt = buildLeadPrompt(lead)
    expect(prompt).toContain('condo reserve fund guide')
  })
})

// ── parseLeadEmail ────────────────────────────────────────────

describe('parseLeadEmail', () => {
  it('parses valid Claude response', () => {
    const text = JSON.stringify({
      subject: 'Your roof measurement request',
      html: '<p>Hi John,</p><p>Thanks for reaching out.</p>',
    })
    const email = parseLeadEmail(text)
    expect(email.subject).toBe('Your roof measurement request')
    expect(email.html).toContain('<p>')
  })

  it('strips markdown fences before parsing', () => {
    const text = '```json\n{"subject":"Hello","html":"<p>test</p>"}\n```'
    const email = parseLeadEmail(text)
    expect(email.subject).toBe('Hello')
  })

  it('returns default template on invalid JSON', () => {
    const email = parseLeadEmail('not valid json at all')
    expect(email.subject).toBe('Your Roof Manager request')
    expect(email.html).toContain('roofmanager.ca')
  })

  it('returns default template when required fields missing', () => {
    const email = parseLeadEmail(JSON.stringify({ subject: 'Only subject' }))
    expect(email.subject).toBe('Your Roof Manager request')
  })

  it('returns default template on empty string', () => {
    const email = parseLeadEmail('')
    expect(email.subject).toBe('Your Roof Manager request')
  })
})

// ── shouldSkipLead ────────────────────────────────────────────

describe('shouldSkipLead', () => {
  it('returns true when email is in the responded set', () => {
    const responded = new Set(['john@example.com'])
    expect(shouldSkipLead('john@example.com', responded)).toBe(true)
  })

  it('returns false when email is NOT in the responded set', () => {
    const responded = new Set(['other@example.com'])
    expect(shouldSkipLead('john@example.com', responded)).toBe(false)
  })

  it('is case-insensitive', () => {
    const responded = new Set(['john@example.com'])
    expect(shouldSkipLead('JOHN@EXAMPLE.COM', responded)).toBe(true)
  })

  it('returns false for empty set', () => {
    expect(shouldSkipLead('any@example.com', new Set())).toBe(false)
  })

  it('trims whitespace before checking', () => {
    const responded = new Set(['john@example.com'])
    expect(shouldSkipLead('  john@example.com  ', responded)).toBe(true)
  })
})
