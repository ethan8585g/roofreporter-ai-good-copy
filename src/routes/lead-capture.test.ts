import { describe, it, expect } from 'vitest'
import { validateLeadInput, isValidLeadSource, VALID_LEAD_SOURCES } from './lead-capture'

describe('Lead capture validation', () => {
  it('accepts a valid email', () => {
    expect(validateLeadInput({ email: 'facilities@condoboard.ca' }).ok).toBe(true)
  })

  it('rejects missing email', () => {
    expect(validateLeadInput({}).ok).toBe(false)
    expect(validateLeadInput({ email: '' }).ok).toBe(false)
  })

  it('rejects malformed email', () => {
    expect(validateLeadInput({ email: 'not-an-email' }).ok).toBe(false)
    expect(validateLeadInput({ email: 'foo@' }).ok).toBe(false)
    expect(validateLeadInput({ email: '@bar.com' }).ok).toBe(false)
  })

  it('rejects non-object body', () => {
    expect(validateLeadInput(null as any).ok).toBe(false)
    expect(validateLeadInput('email' as any).ok).toBe(false)
  })
})

describe('Lead source enum', () => {
  it('validates all known sources', () => {
    VALID_LEAD_SOURCES.forEach(s => expect(isValidLeadSource(s)).toBe(true))
  })
  it('rejects unknown sources', () => {
    expect(isValidLeadSource('marketing_email')).toBe(false)
    expect(isValidLeadSource('')).toBe(false)
    expect(isValidLeadSource(undefined)).toBe(false)
  })
})
