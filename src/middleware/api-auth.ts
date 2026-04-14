// ============================================================
// API Authentication Middleware
// Validates Bearer API keys, enforces rate limits, logs requests
// ============================================================

import type { Context, Next } from 'hono'
import type { Bindings, ApiAccount, ApiKey } from '../types'

const RATE_LIMIT_MINUTE = 60    // max requests per minute per key
const RATE_LIMIT_HOUR   = 1000  // max requests per hour per key
const MAX_CONCURRENT_JOBS = 20  // max queued|tracing|generating jobs per account

// ── PBKDF2 API key verification (same constants as auth.ts) ──────────────────

async function hashApiKey(rawKey: string, salt: string): Promise<string> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(rawKey), { name: 'PBKDF2' }, false, ['deriveBits']
  )
  const hashBuffer = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  )
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEq(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

// key_hash stored as "pbkdf2:<salt>:<hash>"
async function verifyApiKey(rawKey: string, storedHash: string): Promise<boolean> {
  if (!storedHash.startsWith('pbkdf2:')) return false
  const inner = storedHash.slice(7)
  const idx = inner.indexOf(':')
  if (idx < 0) return false
  const salt = inner.slice(0, idx)
  const hash = inner.slice(idx + 1)
  const computed = await hashApiKey(rawKey, salt)
  return timingSafeEq(computed, hash)
}

// ── Rate limiting (D1 sliding window) ───────────────────────────────────────

async function checkRateLimit(
  db: D1Database,
  accountId: string,
  keyId: string
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const now = Math.floor(Date.now() / 1000)
  const minuteWindow = Math.floor(now / 60) * 60
  const hourWindow   = Math.floor(now / 3600) * 3600

  const minuteKey = `${keyId}:min:${minuteWindow}`
  const hourKey   = `${keyId}:hr:${hourWindow}`

  // Upsert minute bucket
  await db.prepare(`
    INSERT INTO api_rate_buckets (key, count, window_start)
    VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET count = count + 1
  `).bind(minuteKey, minuteWindow).run()

  const minuteRow = await db.prepare(
    'SELECT count FROM api_rate_buckets WHERE key = ?'
  ).bind(minuteKey).first<{ count: number }>()

  if (minuteRow && minuteRow.count > RATE_LIMIT_MINUTE) {
    return { allowed: false, retryAfter: minuteWindow + 60 - now }
  }

  // Upsert hour bucket
  await db.prepare(`
    INSERT INTO api_rate_buckets (key, count, window_start)
    VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET count = count + 1
  `).bind(hourKey, hourWindow).run()

  const hourRow = await db.prepare(
    'SELECT count FROM api_rate_buckets WHERE key = ?'
  ).bind(hourKey).first<{ count: number }>()

  if (hourRow && hourRow.count > RATE_LIMIT_HOUR) {
    return { allowed: false, retryAfter: hourWindow + 3600 - now }
  }

  return { allowed: true }
}

// ── Request audit logging ────────────────────────────────────────────────────

export async function logApiRequest(
  db: D1Database,
  opts: {
    accountId: string | null
    apiKeyId: string | null
    method: string
    path: string
    statusCode: number
    ip: string | null
    userAgent: string | null
    durationMs: number
    bodyHash?: string
  }
) {
  const id = crypto.randomUUID()
  const now = Math.floor(Date.now() / 1000)
  await db.prepare(`
    INSERT INTO api_request_log
      (id, account_id, api_key_id, method, path, status_code, ip, user_agent, duration_ms, request_body_sha256, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    opts.accountId,
    opts.apiKeyId,
    opts.method,
    opts.path,
    opts.statusCode,
    opts.ip,
    opts.userAgent,
    opts.durationMs,
    opts.bodyHash ?? null,
    now
  ).run()
}

// ── Main middleware factory ──────────────────────────────────────────────────

export function apiAuthMiddleware() {
  return async (c: any, next: Next) => {
    try {
    const startMs = Date.now()
    const db = c.env.DB
    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null
    const ua = c.req.header('user-agent') ?? null

    const authHeader = c.req.header('authorization') ?? ''
    if (!authHeader.startsWith('Bearer rm_live_')) {
      logApiRequest(db, {
        accountId: null, apiKeyId: null,
        method: c.req.method, path: c.req.path,
        statusCode: 401, ip, userAgent: ua,
        durationMs: Date.now() - startMs
      }).catch(() => {})
      return c.json({ error: 'Missing or invalid Authorization header. Use: Bearer rm_live_…' }, 401)
    }

    const rawKey = authHeader.slice(7) // strip "Bearer "
    // Prefix is first 12 chars of the key value (after "rm_live_")
    const keyValue = rawKey.slice(8)   // strip "rm_live_"
    const prefix   = keyValue.slice(0, 12)

    // Look up key record by prefix (non-secret, indexed)
    const keyRow = await db.prepare(`
      SELECT k.*, a.id as acct_id, a.company_name, a.contact_email,
             a.credit_balance, a.status as acct_status,
             a.webhook_url, a.webhook_secret, a.created_at as acct_created_at,
             a.stripe_customer_id
      FROM api_keys k
      JOIN api_accounts a ON a.id = k.account_id
      WHERE k.key_prefix = ? AND k.revoked_at IS NULL
    `).bind(prefix).first<any>()

    if (!keyRow) {
      logApiRequest(db, { accountId: null, apiKeyId: null, method: c.req.method, path: c.req.path, statusCode: 401, ip, userAgent: ua, durationMs: Date.now() - startMs }).catch(() => {})
      return c.json({ error: 'Invalid API key' }, 401)
    }

    // Verify full key hash
    const valid = await verifyApiKey(rawKey, keyRow.key_hash)
    if (!valid) {
      logApiRequest(db, { accountId: keyRow.account_id, apiKeyId: keyRow.id, method: c.req.method, path: c.req.path, statusCode: 401, ip, userAgent: ua, durationMs: Date.now() - startMs }).catch(() => {})
      return c.json({ error: 'Invalid API key' }, 401)
    }

    // Check account status
    if (keyRow.acct_status !== 'active') {
      logApiRequest(db, { accountId: keyRow.account_id, apiKeyId: keyRow.id, method: c.req.method, path: c.req.path, statusCode: 403, ip, userAgent: ua, durationMs: Date.now() - startMs }).catch(() => {})
      return c.json({ error: 'Account is suspended. Contact support@roofmanager.ca' }, 403)
    }

    // Rate limit check
    const rateResult = await checkRateLimit(db, keyRow.account_id, keyRow.id)
    if (!rateResult.allowed) {
      logApiRequest(db, { accountId: keyRow.account_id, apiKeyId: keyRow.id, method: c.req.method, path: c.req.path, statusCode: 429, ip, userAgent: ua, durationMs: Date.now() - startMs }).catch(() => {})
      return c.json(
        { error: 'Rate limit exceeded', retry_after: rateResult.retryAfter },
        429,
        { 'Retry-After': String(rateResult.retryAfter ?? 60) }
      )
    }

    // Update last_used_at (fire-and-forget)
    db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?')
      .bind(Math.floor(Date.now() / 1000), keyRow.id).run()
      .catch(() => {})

    // Attach auth context to request
    const account: ApiAccount = {
      id: keyRow.account_id,
      company_name: keyRow.company_name,
      contact_email: keyRow.contact_email,
      credit_balance: keyRow.credit_balance,
      status: keyRow.acct_status,
      webhook_url: keyRow.webhook_url,
      webhook_secret: keyRow.webhook_secret,
      created_at: keyRow.acct_created_at,
      stripe_customer_id: keyRow.stripe_customer_id
    }
    const apiKey: ApiKey = {
      id: keyRow.id,
      account_id: keyRow.account_id,
      key_prefix: keyRow.key_prefix,
      key_hash: keyRow.key_hash,
      name: keyRow.name,
      last_used_at: keyRow.last_used_at,
      revoked_at: keyRow.revoked_at,
      created_at: keyRow.created_at
    }

    c.set('apiAccount' as any, account)
    c.set('apiKey' as any, apiKey)

    await next()

    // Post-response: log outcome (fire-and-forget)
    logApiRequest(db, {
      accountId: account.id,
      apiKeyId: apiKey.id,
      method: c.req.method,
      path: c.req.path,
      statusCode: c.res?.status ?? 200,
      ip, userAgent: ua,
      durationMs: Date.now() - startMs
    }).catch(() => {})

    } catch (err: any) {
      console.error('[api-auth] middleware error:', err?.message ?? err)
      return c.json({ error: 'Internal error', detail: err?.message }, 500)
    }
  }
}

// ── Helpers consumed by route handlers ──────────────────────────────────────

export async function checkConcurrentJobLimit(
  db: D1Database,
  accountId: string
): Promise<boolean> {
  const row = await db.prepare(`
    SELECT COUNT(*) as cnt FROM api_jobs
    WHERE account_id = ? AND status IN ('queued','tracing','generating')
  `).bind(accountId).first<{ cnt: number }>()
  return (row?.cnt ?? 0) < MAX_CONCURRENT_JOBS
}

/** Generate a new API key: returns raw key (shown once) + prefix + hash */
export async function generateApiKey(): Promise<{ raw: string; prefix: string; hash: string }> {
  // Raw key format: rm_live_<24 random bytes base64url>
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  const raw = `rm_live_${b64}`
  const keyValue = raw.slice(8) // strip "rm_live_"
  const prefix = keyValue.slice(0, 12)

  // Hash with PBKDF2
  const salt = crypto.randomUUID()
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(raw), { name: 'PBKDF2' }, false, ['deriveBits']
  )
  const hashBuffer = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  )
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('')

  return { raw, prefix, hash: `pbkdf2:${salt}:${hashHex}` }
}
