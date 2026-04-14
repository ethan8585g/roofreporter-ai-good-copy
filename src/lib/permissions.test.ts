import { describe, it, expect } from 'vitest'
import {
  sanitizePermissions,
  defaultPermissions,
  can,
  redactFinancials,
  ALL_PERMISSION_KEYS,
  MODULE_PERMISSION_KEYS,
  SENSITIVE_PERMISSION_KEYS,
  type PermissionContext,
} from './permissions'

// These tests pin the permission boundary. Regressions here either grant
// unauthorized access or lock out legitimate users, so every branch of the
// decision tree needs coverage.

describe('defaultPermissions', () => {
  it('grants every module by default (backward compat)', () => {
    const d = defaultPermissions()
    for (const k of MODULE_PERMISSION_KEYS) expect(d[k]).toBe(true)
  })
  it('denies every sensitive capability by default (opt-in)', () => {
    const d = defaultPermissions()
    for (const k of SENSITIVE_PERMISSION_KEYS) expect(d[k]).toBe(false)
  })
})

describe('sanitizePermissions', () => {
  it('parses a JSON string blob', () => {
    const p = sanitizePermissions('{"invoices": true, "view_financials": true}')
    expect(p.invoices).toBe(true)
    expect(p.view_financials).toBe(true)
  })

  it('drops unknown keys', () => {
    const p = sanitizePermissions({ invoices: true, admin_god_mode: true } as any)
    expect('admin_god_mode' in p).toBe(false)
  })

  it('treats missing keys as defaults (module=true, sensitive=false)', () => {
    const p = sanitizePermissions({})
    expect(p.invoices).toBe(true)
    expect(p.delete_records).toBe(false)
  })

  it('rejects non-true truthy values (1, "yes", etc.)', () => {
    const p = sanitizePermissions({ invoices: 1, view_financials: 'yes' } as any)
    expect(p.invoices).toBe(false)
    expect(p.view_financials).toBe(false)
  })

  it('handles malformed JSON string by returning defaults', () => {
    const p = sanitizePermissions('not json {')
    expect(p).toEqual(defaultPermissions())
  })

  it('handles null / undefined / non-object raw input', () => {
    expect(sanitizePermissions(null)).toEqual(defaultPermissions())
    expect(sanitizePermissions(undefined)).toEqual(defaultPermissions())
    expect(sanitizePermissions(42 as any)).toEqual(defaultPermissions())
  })

  it('output contains every canonical key and nothing else', () => {
    const p = sanitizePermissions({ view_financials: true })
    expect(Object.keys(p).sort()).toEqual([...ALL_PERMISSION_KEYS].sort())
  })
})

describe('can — role hierarchy', () => {
  const denyAll: PermissionContext['permissions'] = {
    ...defaultPermissions(),
  }
  // Flip everything to false so we can prove owner/admin still bypass.
  for (const k of ALL_PERMISSION_KEYS) (denyAll as any)[k] = false

  it('account owner bypasses every permission', () => {
    const ctx: PermissionContext = { isOwner: true, teamRole: null, permissions: denyAll }
    for (const k of ALL_PERMISSION_KEYS) expect(can(ctx, k)).toBe(true)
  })

  it('team role "admin" bypasses every permission', () => {
    const ctx: PermissionContext = { isOwner: false, teamRole: 'admin', permissions: denyAll }
    for (const k of ALL_PERMISSION_KEYS) expect(can(ctx, k)).toBe(true)
  })

  it('team role "member" is subject to the permissions JSON', () => {
    const perms = sanitizePermissions({ invoices: true, delete_records: false })
    const ctx: PermissionContext = { isOwner: false, teamRole: 'member', permissions: perms }
    expect(can(ctx, 'invoices')).toBe(true)
    expect(can(ctx, 'delete_records')).toBe(false)
  })

  it('members with unknown role still enforce permissions (fails closed)', () => {
    const ctx: PermissionContext = { isOwner: false, teamRole: 'intern' as any, permissions: denyAll }
    expect(can(ctx, 'invoices')).toBe(false)
  })
})

describe('redactFinancials', () => {
  it('nulls out every known financial field', () => {
    const row = {
      id: 7,
      invoice_number: 'INV-1',
      total: 199.99,
      subtotal: 150,
      tax_amount: 49.99,
      my_cost: 80,
      customer_name: 'Acme',
    }
    const redacted = redactFinancials(row)
    expect(redacted.id).toBe(7)
    expect(redacted.invoice_number).toBe('INV-1')
    expect(redacted.customer_name).toBe('Acme')
    expect(redacted.total).toBeNull()
    expect(redacted.subtotal).toBeNull()
    expect(redacted.tax_amount).toBeNull()
    expect(redacted.my_cost).toBeNull()
  })

  it('does not mutate the input object', () => {
    const row = { total: 100 }
    redactFinancials(row)
    expect(row.total).toBe(100)
  })

  it('is a no-op on rows without financial fields', () => {
    const row = { id: 1, status: 'draft' }
    expect(redactFinancials(row)).toEqual(row)
  })
})
