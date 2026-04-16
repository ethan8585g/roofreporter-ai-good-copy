import { describe, it, expect } from 'vitest'

// ── Agent type validation (pure logic tests) ──────────────────

const VALID_AGENTS = new Set(['tracing', 'content', 'email', 'lead'])

function validateAgentType(agent: string): { ok: boolean; error?: string } {
  if (!VALID_AGENTS.has(agent)) {
    return { ok: false, error: `Unknown agent type: "${agent}". Valid: ${[...VALID_AGENTS].join(', ')}` }
  }
  return { ok: true }
}

describe('validateAgentType', () => {
  it('accepts all valid agent types', () => {
    for (const a of VALID_AGENTS) {
      expect(validateAgentType(a).ok).toBe(true)
    }
  })

  it('rejects unknown agent type', () => {
    const result = validateAgentType('unknown-agent')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Unknown agent type')
  })

  it('rejects empty string', () => {
    expect(validateAgentType('').ok).toBe(false)
  })

  it('rejects SQL injection attempt', () => {
    expect(validateAgentType("'; DROP TABLE agents; --").ok).toBe(false)
  })

  it('is case-sensitive (uppercase should fail)', () => {
    expect(validateAgentType('Tracing').ok).toBe(false)
    expect(validateAgentType('TRACING').ok).toBe(false)
  })
})

// ── Config body validation (pure logic tests) ─────────────────

function validateConfigBody(body: unknown): { ok: boolean; error?: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object' }
  }
  return { ok: true }
}

describe('validateConfigBody', () => {
  it('accepts a plain object', () => {
    expect(validateConfigBody({ confidence_threshold: 70 }).ok).toBe(true)
  })

  it('accepts an empty object', () => {
    expect(validateConfigBody({}).ok).toBe(true)
  })

  it('rejects null', () => {
    expect(validateConfigBody(null).ok).toBe(false)
  })

  it('rejects an array', () => {
    expect(validateConfigBody([1, 2, 3]).ok).toBe(false)
  })

  it('rejects a string', () => {
    expect(validateConfigBody('string value').ok).toBe(false)
  })

  it('rejects a number', () => {
    expect(validateConfigBody(42).ok).toBe(false)
  })

  it('rejects undefined', () => {
    expect(validateConfigBody(undefined).ok).toBe(false)
  })
})

// ── Pagination param sanitization ────────────────────────────

function sanitizePagination(limitStr: string | null, offsetStr: string | null) {
  const limit = Math.min(parseInt(limitStr || '50'), 100)
  const offset = Math.max(0, parseInt(offsetStr || '0'))
  return { limit: isNaN(limit) ? 50 : limit, offset: isNaN(offset) ? 0 : offset }
}

describe('sanitizePagination', () => {
  it('defaults to limit=50, offset=0', () => {
    const { limit, offset } = sanitizePagination(null, null)
    expect(limit).toBe(50)
    expect(offset).toBe(0)
  })

  it('caps limit at 100', () => {
    const { limit } = sanitizePagination('500', null)
    expect(limit).toBe(100)
  })

  it('clamps negative offset to 0', () => {
    const { offset } = sanitizePagination(null, '-10')
    expect(offset).toBe(0)
  })

  it('parses valid numbers', () => {
    const { limit, offset } = sanitizePagination('25', '75')
    expect(limit).toBe(25)
    expect(offset).toBe(75)
  })

  it('falls back to default on non-numeric input', () => {
    const { limit, offset } = sanitizePagination('abc', 'xyz')
    expect(limit).toBe(50)
    expect(offset).toBe(0)
  })
})

// ── buildSummary helper (re-implementation for test isolation) ─

function buildSummary(agent: string, result: any): string {
  if (!result) return `${agent} run completed`
  switch (agent) {
    case 'tracing':
      return `Processed ${result.processed ?? 0} order(s)`
    case 'content':
      if (result.skipped) return 'No keywords in queue'
      if (result.ok) return `Published "${result.keyword}" (quality ${result.quality?.overall ?? '?'}%)`
      return `Content failed: ${result.error || 'unknown error'}`
    case 'lead':
      if (result.responded === 0) return 'No new leads to respond to'
      return `Responded to ${result.responded} lead(s)`
    case 'email':
      if (result.skipped) return 'No unengaged contacts to email'
      if (result.ok) return `Sent "${result.campaign_name}" to ${result.sent}/${result.recipients} contacts`
      return `Email campaign failed: ${result.errors?.[0] || 'unknown error'}`
    default:
      return `${agent} completed`
  }
}

describe('buildSummary', () => {
  it('summarizes tracing with processed count', () => {
    expect(buildSummary('tracing', { processed: 3 })).toBe('Processed 3 order(s)')
  })

  it('summarizes tracing with 0 when processed missing', () => {
    expect(buildSummary('tracing', {})).toBe('Processed 0 order(s)')
  })

  it('summarizes content skipped', () => {
    expect(buildSummary('content', { skipped: true })).toBe('No keywords in queue')
  })

  it('summarizes content success with quality', () => {
    const r = { ok: true, keyword: 'roof repair', quality: { overall: 85 } }
    expect(buildSummary('content', r)).toContain('roof repair')
    expect(buildSummary('content', r)).toContain('85%')
  })

  it('summarizes content failure', () => {
    const r = { ok: false, error: 'API timeout' }
    expect(buildSummary('content', r)).toContain('API timeout')
  })

  it('summarizes lead with no new leads', () => {
    expect(buildSummary('lead', { responded: 0 })).toBe('No new leads to respond to')
  })

  it('summarizes lead with responded count', () => {
    expect(buildSummary('lead', { responded: 4 })).toBe('Responded to 4 lead(s)')
  })

  it('summarizes email skipped', () => {
    expect(buildSummary('email', { skipped: true })).toBe('No unengaged contacts to email')
  })

  it('summarizes email success', () => {
    const r = { ok: true, campaign_name: 'April Campaign', sent: 95, recipients: 100 }
    expect(buildSummary('email', r)).toContain('April Campaign')
    expect(buildSummary('email', r)).toContain('95/100')
  })

  it('handles null result gracefully', () => {
    expect(buildSummary('tracing', null)).toBe('tracing run completed')
  })
})
