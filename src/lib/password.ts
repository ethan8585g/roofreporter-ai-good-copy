// Unified password hashing — PBKDF2-SHA512, 600,000 iterations (NIST SP 800-63B 2024).
// New format: pbkdf2$sha512$600000$<saltB64>$<hashB64>
// Legacy formats still accepted for login (and auto-upgraded on verify):
//   - pbkdf2:<saltUuid>:<hashHex>            (PBKDF2-SHA256/100k)
//   - <saltUuid>:<hashHex>                    (SHA-256 + salt concat)
//   - <sha256Hex>                             (SHA-256 + hardcoded 'roofreporter_salt_2024')

const NEW_PREFIX = 'pbkdf2$sha512$600000$'
const NEW_ITERATIONS = 600_000
const LEGACY_HARDCODED_SALT = 'roofreporter_salt_2024'

function b64encode(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEq(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

async function pbkdf2Sha512(password: string, salt: Uint8Array, iterations: number, bits = 256): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits'])
  const buf = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-512' }, keyMaterial, bits)
  return new Uint8Array(buf)
}

async function pbkdf2Sha256(password: string, saltStr: string, iterations: number): Promise<string> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits'])
  const buf = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(saltStr), iterations, hash: 'SHA-256' }, keyMaterial, 256)
  return toHex(new Uint8Array(buf))
}

async function sha256Hex(s: string): Promise<string> {
  const enc = new TextEncoder()
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(s))
  return toHex(new Uint8Array(buf))
}

// Hash a password for storage. Always returns the new PBKDF2-SHA512/600k format.
export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(32))
  const derived = await pbkdf2Sha512(plain, salt, NEW_ITERATIONS, 256)
  return `${NEW_PREFIX}${b64encode(salt)}$${b64encode(derived)}`
}

// Verify a password against a stored hash. Accepts new + legacy formats.
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (!stored) return false

  // New format: pbkdf2$sha512$600000$<saltB64>$<hashB64>
  if (stored.startsWith(NEW_PREFIX)) {
    const rest = stored.slice(NEW_PREFIX.length)
    const idx = rest.indexOf('$')
    if (idx < 0) return false
    try {
      const salt = b64decode(rest.slice(0, idx))
      const expected = b64decode(rest.slice(idx + 1))
      const derived = await pbkdf2Sha512(plain, salt, NEW_ITERATIONS, expected.length * 8)
      return timingSafeEq(b64encode(derived), b64encode(expected))
    } catch {
      return false
    }
  }

  // Legacy PBKDF2-SHA256/100k: pbkdf2:<salt>:<hashHex>
  if (stored.startsWith('pbkdf2:')) {
    const inner = stored.slice(7)
    const colon = inner.indexOf(':')
    if (colon < 0) return false
    const salt = inner.slice(0, colon)
    const hash = inner.slice(colon + 1)
    const got = await pbkdf2Sha256(plain, salt, 100_000)
    return timingSafeEq(got, hash)
  }

  // Legacy SHA-256 with salt concat: <salt>:<hashHex>
  if (stored.includes(':')) {
    const [salt, hash] = stored.split(':', 2)
    const got = await sha256Hex(plain + salt)
    return timingSafeEq(got, hash)
  }

  // Legacy SHA-256 with hardcoded salt — platform-admin onboarding path
  if (/^[a-f0-9]{64}$/.test(stored)) {
    const got = await sha256Hex(plain + LEGACY_HARDCODED_SALT)
    return timingSafeEq(got, stored)
  }

  return false
}

// True if the stored hash is NOT in the preferred new format and should be upgraded.
export function isLegacyHash(stored: string): boolean {
  return !!stored && !stored.startsWith(NEW_PREFIX)
}

// Convenience: on successful login with a legacy hash, upgrade it in the DB.
// Caller supplies a short update callback so this module stays storage-agnostic.
export async function upgradeHashIfLegacy(
  plain: string,
  stored: string,
  update: (newHash: string) => Promise<void>
): Promise<void> {
  if (!isLegacyHash(stored)) return
  const fresh = await hashPassword(plain)
  await update(fresh)
}

// Dummy verify — run against a fixed hash when the user is not found, to level
// login latency and block email-enumeration timing oracles.
const DUMMY_HASH = `${NEW_PREFIX}${'A'.repeat(44)}$${'A'.repeat(44)}`
export async function dummyVerify(plain: string): Promise<void> {
  await verifyPassword(plain, DUMMY_HASH).catch(() => false)
}

export { timingSafeEq }
