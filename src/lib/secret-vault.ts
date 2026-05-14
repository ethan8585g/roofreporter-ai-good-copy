import type { Bindings } from '../types'
// At-rest encryption for secrets stored in D1 (SIP credentials, OAuth tokens,
// etc.). AES-256-GCM with a 96-bit random nonce per value.
//
// Key source: env SIP_ENCRYPTION_KEY — 32 bytes, base64url. Generate once
// with `openssl rand -base64 32 | tr -d '=' | tr '+/' '-_'` and set via
// `wrangler secret put SIP_ENCRYPTION_KEY`.
//
// Storage format (opaque to callers):
//   v1$<nonceB64>$<ciphertext+tagB64>
//
// When no key is configured, the functions pass values through as-is so
// development without the secret keeps working; a console warning flags it.
// Legacy plaintext values stored before encryption are detected by the
// missing "v1$" prefix and returned unchanged — callers can upgrade on
// next write.

const VERSION = 'v1'
const PREFIX = `${VERSION}$`

function b64urlEncode(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function importKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) {
    throw new Error(`SIP_ENCRYPTION_KEY must decode to 32 bytes (got ${raw.length})`)
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export function hasVault(env: Bindings): boolean {
  return !!(env && env.SIP_ENCRYPTION_KEY)
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX)
}

// Encrypt a string for DB storage. Returns input untouched if vault is not
// configured or the value is empty.
export async function encryptSecret(env: Bindings, plain: string | null | undefined): Promise<string> {
  if (plain == null || plain === '') return ''
  if (!hasVault(env)) {
    console.warn('[secret-vault] SIP_ENCRYPTION_KEY unset — storing secret in plaintext')
    return String(plain)
  }
  const keyBytes = b64urlDecode(String(env.SIP_ENCRYPTION_KEY))
  const key = await importKey(keyBytes)
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, new TextEncoder().encode(plain))
  )
  return `${PREFIX}${b64urlEncode(nonce)}$${b64urlEncode(ct)}`
}

// Decrypt a stored value. Legacy plaintext passes through unchanged.
export async function decryptSecret(env: Bindings, stored: string | null | undefined): Promise<string> {
  if (stored == null || stored === '') return ''
  if (!isEncrypted(stored)) return String(stored) // plaintext legacy row
  if (!hasVault(env)) {
    console.warn('[secret-vault] encrypted value found but SIP_ENCRYPTION_KEY unset')
    return ''
  }
  const rest = String(stored).slice(PREFIX.length)
  const sep = rest.indexOf('$')
  if (sep < 0) return ''
  try {
    const nonce = b64urlDecode(rest.slice(0, sep))
    const ct = b64urlDecode(rest.slice(sep + 1))
    const keyBytes = b64urlDecode(String(env.SIP_ENCRYPTION_KEY))
    const key = await importKey(keyBytes)
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct)
    return new TextDecoder().decode(plain)
  } catch (err) {
    console.warn('[secret-vault] decrypt failed:', (err as any)?.message)
    return ''
  }
}

// Convenience: masked preview for admin UIs. Never decrypts.
export function maskSecret(stored: string | null | undefined): string {
  if (!stored) return ''
  if (isEncrypted(stored)) return '(encrypted)'
  const s = String(stored)
  if (s.length <= 4) return '****'
  return s.slice(0, 2) + '…' + s.slice(-2)
}