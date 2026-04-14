import { describe, it, expect } from 'vitest'
import { getScope } from './invoices'

// Auth-boundary tests for the invoice route scope helper. This is the single
// point that decides whether a caller sees their own invoices or everyone's,
// so we pin every branch: unauthenticated, admin, superadmin, customer,
// and team-member (customer with a resolved ownerCustomerId).
//
// Hono's context is mocked to just { get(key) } since getScope only reads the
// 'admin' slot.

function ctx(user: any) {
  return { get: (k: string) => (k === 'admin' ? user : undefined) }
}

describe('getScope — unauthenticated', () => {
  it('returns non-admin with null ownerId when no session', () => {
    const s = getScope(ctx(null))
    expect(s.isAdmin).toBe(false)
    expect(s.ownerId).toBeNull()
  })
})

describe('getScope — admin roles', () => {
  it('superadmin is treated as admin (full access)', () => {
    const s = getScope(ctx({ id: 1, role: 'superadmin' }))
    expect(s.isAdmin).toBe(true)
    expect(s.ownerId).toBeNull()
  })

  it('admin is treated as admin (full access)', () => {
    const s = getScope(ctx({ id: 1, role: 'admin' }))
    expect(s.isAdmin).toBe(true)
    expect(s.ownerId).toBeNull()
  })
})

describe('getScope — customer role', () => {
  it('scopes to own id when there is no team owner', () => {
    const s = getScope(ctx({ id: 42, role: 'customer' }))
    expect(s.isAdmin).toBe(false)
    expect(s.ownerId).toBe(42)
  })

  it('scopes team members to the team owner id, not their own id', () => {
    // Middleware resolves team owner via resolveTeamOwner() and stores it as
    // ownerCustomerId. Bob (id=99) is a team member of Alice (id=42).
    const s = getScope(ctx({ id: 99, role: 'customer', ownerCustomerId: 42 }))
    expect(s.isAdmin).toBe(false)
    expect(s.ownerId).toBe(42)
  })

  it('falls back to own id when ownerCustomerId is explicitly null', () => {
    const s = getScope(ctx({ id: 42, role: 'customer', ownerCustomerId: null }))
    expect(s.ownerId).toBe(42)
  })
})
