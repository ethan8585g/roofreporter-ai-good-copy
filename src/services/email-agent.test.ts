import { describe, it, expect } from 'vitest'
import {
  buildCampaignPrompt,
  parseCampaignContent,
  filterEligibleContacts,
  type CampaignStats,
  type ContactRow,
} from './email-agent'

// ── Fixtures ──────────────────────────────────────────────────

const baseStats: CampaignStats = {
  total_contacts: 150,
  avg_open_rate: 0.22,
  last_campaign_date: '2026-04-01',
  top_sources: ['homepage_cta', 'condo_cheat_sheet'],
}

// ── buildCampaignPrompt ───────────────────────────────────────

describe('buildCampaignPrompt', () => {
  it('includes the contact count', () => {
    const prompt = buildCampaignPrompt(baseStats)
    expect(prompt).toContain('150')
  })

  it('includes the open rate as a percentage', () => {
    const prompt = buildCampaignPrompt(baseStats)
    expect(prompt).toContain('22%')
  })

  it('includes the last campaign date', () => {
    const prompt = buildCampaignPrompt(baseStats)
    expect(prompt).toContain('2026-04-01')
  })

  it('includes top sources', () => {
    const prompt = buildCampaignPrompt(baseStats)
    expect(prompt).toContain('homepage_cta')
  })

  it('handles null last_campaign_date gracefully', () => {
    const stats = { ...baseStats, last_campaign_date: null }
    const prompt = buildCampaignPrompt(stats)
    expect(prompt).toContain('No campaigns have been sent yet')
    expect(prompt).not.toContain('null')
  })

  it('handles empty top_sources', () => {
    const stats = { ...baseStats, top_sources: [] }
    const prompt = buildCampaignPrompt(stats)
    expect(prompt).not.toContain('undefined')
  })

  it('instructs JSON-only output', () => {
    const prompt = buildCampaignPrompt(baseStats)
    expect(prompt).toContain('STRICT JSON')
  })
})

// ── parseCampaignContent ──────────────────────────────────────

describe('parseCampaignContent', () => {
  it('parses valid campaign content', () => {
    const json = JSON.stringify({
      campaign_name: 'April Nurture Sequence',
      subject: 'How to spot early roof damage',
      preheader: 'Save thousands by catching it early',
      body_html: '<p>Hi there,</p><p>Did you know...</p>',
      body_text: 'Hi there, Did you know...',
    })
    const content = parseCampaignContent(json)
    expect(content.campaign_name).toBe('April Nurture Sequence')
    expect(content.subject).toBe('How to spot early roof damage')
  })

  it('strips markdown fences', () => {
    const json = '```json\n{"campaign_name":"Test","subject":"Subj","preheader":"Pre","body_html":"<p>hi</p>","body_text":"hi"}\n```'
    const content = parseCampaignContent(json)
    expect(content.campaign_name).toBe('Test')
  })

  it('throws when campaign_name is missing', () => {
    expect(() =>
      parseCampaignContent(JSON.stringify({ subject: 'S', body_html: '<p>b</p>' }))
    ).toThrow()
  })

  it('throws when subject is missing', () => {
    expect(() =>
      parseCampaignContent(JSON.stringify({ campaign_name: 'N', body_html: '<p>b</p>' }))
    ).toThrow()
  })

  it('throws on invalid JSON', () => {
    expect(() => parseCampaignContent('invalid json')).toThrow()
  })
})

// ── filterEligibleContacts ────────────────────────────────────

describe('filterEligibleContacts', () => {
  const makeContact = (overrides: Partial<ContactRow>): ContactRow => ({
    id: 1,
    email: 'test@example.com',
    sends_count: 0,
    status: 'active',
    ...overrides,
  })

  it('includes active contacts with sends_count < 3', () => {
    const contacts = [
      makeContact({ id: 1, sends_count: 0 }),
      makeContact({ id: 2, sends_count: 2 }),
    ]
    const result = filterEligibleContacts(contacts)
    expect(result).toHaveLength(2)
  })

  it('excludes contacts with sends_count >= 3 (default cap)', () => {
    const contacts = [
      makeContact({ id: 1, sends_count: 3 }),
      makeContact({ id: 2, sends_count: 5 }),
    ]
    const result = filterEligibleContacts(contacts)
    expect(result).toHaveLength(0)
  })

  it('excludes inactive contacts', () => {
    const contacts = [
      makeContact({ id: 1, status: 'inactive' }),
      makeContact({ id: 2, status: 'unsubscribed' }),
    ]
    const result = filterEligibleContacts(contacts)
    expect(result).toHaveLength(0)
  })

  it('respects custom maxSends parameter', () => {
    const contacts = [
      makeContact({ id: 1, sends_count: 3 }),
      makeContact({ id: 2, sends_count: 4 }),
    ]
    expect(filterEligibleContacts(contacts, 5)).toHaveLength(2)
    expect(filterEligibleContacts(contacts, 3)).toHaveLength(0)
  })

  it('returns empty array for empty input', () => {
    expect(filterEligibleContacts([])).toHaveLength(0)
  })

  it('handles mixed eligible and ineligible contacts', () => {
    const contacts = [
      makeContact({ id: 1, status: 'active',   sends_count: 0 }),
      makeContact({ id: 2, status: 'inactive', sends_count: 0 }),
      makeContact({ id: 3, status: 'active',   sends_count: 3 }),
      makeContact({ id: 4, status: 'active',   sends_count: 1 }),
    ]
    const result = filterEligibleContacts(contacts)
    expect(result).toHaveLength(2)
    expect(result.map(c => c.id)).toEqual([1, 4])
  })
})
