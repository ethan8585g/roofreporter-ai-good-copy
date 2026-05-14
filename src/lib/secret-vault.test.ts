import { describe, it, expect } from 'vitest'
import { encryptSecret, decryptSecret, isEncrypted, maskSecret, hasVault } from './secret-vault'

// 32-byte key, base64url (no padding). Generated deterministically for tests.
const TEST_KEY = 'aGVsbG9fd29ybGRfdGhpc19pc18zMl9ieXRlc19rZXk'
const envWith = { SIP_ENCRYPTION_KEY: TEST_KEY } as any
const envWithout: any = {}

describe('secret-vault', () => {
  it('reports vault presence', () => {
    expect(hasVault(envWith)).toBe(true)
    expect(hasVault(envWithout)).toBe(false)
    expect(hasVault(null)).toBe(false)
  })

  it('round-trips a secret', async () => {
    const ct = await encryptSecret(envWith, 'super-secret-pass')
    expect(ct.startsWith('v1$')).toBe(true)
    expect(await decryptSecret(envWith, ct)).toBe('super-secret-pass')
  })

  it('uses a fresh nonce per encrypt', async () => {
    const a = await encryptSecret(envWith, 'x')
    const b = await encryptSecret(envWith, 'x')
    expect(a).not.toBe(b)
    expect(await decryptSecret(envWith, a)).toBe('x')
    expect(await decryptSecret(envWith, b)).toBe('x')
  })

  it('passes empty strings through', async () => {
    expect(await encryptSecret(envWith, '')).toBe('')
    expect(await decryptSecret(envWith, '')).toBe('')
    expect(await encryptSecret(envWith, null)).toBe('')
  })

  it('falls back to plaintext when key is missing', async () => {
    expect(await encryptSecret(envWithout, 'plain')).toBe('plain')
    expect(await decryptSecret(envWithout, 'plain')).toBe('plain')
  })

  it('detects legacy plaintext rows on decrypt', async () => {
    expect(await decryptSecret(envWith, 'legacy-plain')).toBe('legacy-plain')
  })

  it('returns empty on tampered ciphertext', async () => {
    const ct = await encryptSecret(envWith, 'abc')
    const tampered = ct.slice(0, -4) + 'AAAA'
    expect(await decryptSecret(envWith, tampered)).toBe('')
  })

  it('isEncrypted flags v1$ values', () => {
    expect(isEncrypted('v1$abc$def')).toBe(true)
    expect(isEncrypted('plain')).toBe(false)
    expect(isEncrypted('')).toBe(false)
    expect(isEncrypted(null)).toBe(false)
  })

  it('maskSecret hides content', () => {
    expect(maskSecret('v1$abc$def')).toBe('(encrypted)')
    expect(maskSecret('legacy12345')).toBe('le…45')
    expect(maskSecret('ab')).toBe('****')
    expect(maskSecret('')).toBe('')
  })
})
