import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, isLegacyHash, upgradeHashIfLegacy } from './password'

describe('password hashing (new format)', () => {
  it('hashes and verifies', async () => {
    const h = await hashPassword('hunter2!')
    expect(h.startsWith('pbkdf2$sha512$100000$')).toBe(true)
    expect(await verifyPassword('hunter2!', h)).toBe(true)
    expect(await verifyPassword('wrong', h)).toBe(false)
  })
  it('uses a fresh random salt each call', async () => {
    const a = await hashPassword('x')
    const b = await hashPassword('x')
    expect(a).not.toBe(b)
  })
  it('rejects empty stored hash', async () => {
    expect(await verifyPassword('x', '')).toBe(false)
  })
})

describe('password hashing (legacy formats)', () => {
  it('verifies legacy PBKDF2-SHA256 (pbkdf2:salt:hash)', async () => {
    // Build a known legacy hash
    const enc = new TextEncoder()
    const salt = 'test-salt-abc'
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode('pw'), { name: 'PBKDF2' }, false, ['deriveBits'])
    const buf = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100_000, hash: 'SHA-256' }, keyMaterial, 256)
    const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
    const stored = `pbkdf2:${salt}:${hex}`
    expect(await verifyPassword('pw', stored)).toBe(true)
    expect(await verifyPassword('nope', stored)).toBe(false)
    expect(isLegacyHash(stored)).toBe(true)
  })
  it('verifies legacy SHA-256 with hardcoded roofreporter salt', async () => {
    const enc = new TextEncoder()
    const buf = await crypto.subtle.digest('SHA-256', enc.encode('pw' + 'roofreporter_salt_2024'))
    const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
    expect(await verifyPassword('pw', hex)).toBe(true)
    expect(await verifyPassword('wrong', hex)).toBe(false)
    expect(isLegacyHash(hex)).toBe(true)
  })
  it('verifies legacy SHA-256 salt:hash format', async () => {
    const enc = new TextEncoder()
    const salt = 'abc'
    const buf = await crypto.subtle.digest('SHA-256', enc.encode('pw' + salt))
    const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
    expect(await verifyPassword('pw', `${salt}:${hex}`)).toBe(true)
  })
})

describe('upgradeHashIfLegacy', () => {
  it('upgrades legacy hash via callback', async () => {
    const enc = new TextEncoder()
    const buf = await crypto.subtle.digest('SHA-256', enc.encode('pw' + 'roofreporter_salt_2024'))
    const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
    let saved: string | null = null
    await upgradeHashIfLegacy('pw', hex, async (h) => { saved = h })
    expect(saved?.startsWith('pbkdf2$sha512$100000$')).toBe(true)
    expect(await verifyPassword('pw', saved!)).toBe(true)
  })
  it('no-ops for new-format hash', async () => {
    const fresh = await hashPassword('x')
    let called = false
    await upgradeHashIfLegacy('x', fresh, async () => { called = true })
    expect(called).toBe(false)
  })
})
