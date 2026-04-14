// ============================================================
// PDF URL Signing Service
// HMAC-SHA256 signed, short-lived PDF delivery URLs.
// Format: /v1/pdf/:jobId?exp=<unix>&sig=<hex>
// ============================================================

const DEFAULT_TTL_SECONDS = 15 * 60  // 15 minutes
const MAX_TTL_SECONDS     = 24 * 60 * 60  // 24 hours

// ── HMAC helpers ─────────────────────────────────────────────────────────────

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  return crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign', 'verify']
  )
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

// Message is: "<jobId>|<expiry>" — simple, unambiguous, no URL chars
function buildMessage(jobId: string, expiry: number): string {
  return `${jobId}|${expiry}`
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate a signed PDF URL for a job.
 * @param baseUrl  e.g. "https://www.roofmanager.ca"
 * @param secret   JWT_SECRET from environment
 * @param jobId    UUID of the api_job
 * @param ttl      seconds until expiry (default 15 min)
 */
export async function signPdfUrl(
  baseUrl: string,
  secret: string,
  jobId: string,
  ttl = DEFAULT_TTL_SECONDS
): Promise<{ url: string; expiresAt: number }> {
  const clampedTtl = Math.min(Math.max(ttl, 60), MAX_TTL_SECONDS)
  const expiresAt  = Math.floor(Date.now() / 1000) + clampedTtl

  const message = buildMessage(jobId, expiresAt)
  const key = await importHmacKey(secret)
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  const sig = toHex(sigBuf)

  const url = `${baseUrl}/v1/pdf/${jobId}?exp=${expiresAt}&sig=${sig}`
  return { url, expiresAt }
}

/**
 * Verify a signed PDF URL.
 * Returns the jobId if valid, null if expired or tampered.
 */
export async function verifyPdfUrl(
  secret: string,
  jobId: string,
  exp: string | null,
  sig: string | null
): Promise<boolean> {
  if (!exp || !sig) return false

  const expiry = parseInt(exp, 10)
  if (isNaN(expiry)) return false

  // Reject expired
  if (Math.floor(Date.now() / 1000) > expiry) return false

  const message = buildMessage(jobId, expiry)
  const key = await importHmacKey(secret)

  // Decode hex sig back to buffer for constant-time verify
  const sigBytes = new Uint8Array(sig.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)))
  const valid = await crypto.subtle.verify(
    'HMAC', key,
    sigBytes,
    new TextEncoder().encode(message)
  )
  return valid
}
