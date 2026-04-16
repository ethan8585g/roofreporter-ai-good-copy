// ============================================================
// Public API Routes — /v1/*
// Third-party roof measurement API service.
// Auth: Bearer rm_live_… API key (validated inline per route)
// ============================================================

import { Hono } from 'hono'
import type { Bindings, ApiAccount, ApiKey } from '../types'
import { checkConcurrentJobLimit, generateApiKey, logApiRequest } from '../middleware/api-auth'
import { holdCredit, refundCredit, getLedgerPage } from '../services/api-billing'
import { signPdfUrl, verifyPdfUrl } from '../services/pdf-signing'
import { notifyNewReportRequest } from '../services/email'

export const publicApiRoutes = new Hono<{ Bindings: Bindings }>()

// ── Auth helper (called inline at the start of each protected route) ─────────

const PBKDF2_ITERATIONS = 100000

async function hashApiKeyForVerify(rawKey: string, salt: string): Promise<string> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(rawKey), { name: 'PBKDF2' }, false, ['deriveBits']
  )
  const hashBuffer = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial, 256
  )
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEq(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

interface AuthResult {
  account: ApiAccount
  apiKey: ApiKey
}

async function requireApiAuth(c: any): Promise<AuthResult | Response> {
  const db = c.env.DB
  const authHeader: string = c.req.header('authorization') ?? ''

  if (!authHeader.startsWith('Bearer rm_live_')) {
    return c.json({ error: 'Missing or invalid Authorization header. Use: Bearer rm_live_...' }, 401)
  }

  const rawKey: string = authHeader.slice(7) // strip "Bearer "
  const keyValue: string = rawKey.slice(8)   // strip "rm_live_"
  const prefix: string = keyValue.slice(0, 12)

  const keyRow = await db.prepare(`
    SELECT k.id, k.account_id, k.key_prefix, k.key_hash, k.name,
           k.last_used_at, k.revoked_at, k.created_at as key_created_at,
           a.id as acct_id, a.company_name, a.contact_email,
           a.credit_balance, a.status as acct_status,
           a.webhook_url, a.webhook_secret, a.created_at as acct_created_at,
           a.stripe_customer_id
    FROM api_keys k
    JOIN api_accounts a ON a.id = k.account_id
    WHERE k.key_prefix = ? AND k.revoked_at IS NULL
  `).bind(prefix).first<any>()

  if (!keyRow) {
    return c.json({ error: 'Invalid API key' }, 401)
  }

  // Verify hash
  const storedHash: string = keyRow.key_hash ?? ''
  if (!storedHash.startsWith('pbkdf2:')) {
    return c.json({ error: 'Invalid API key' }, 401)
  }
  const inner = storedHash.slice(7)
  const idx = inner.indexOf(':')
  if (idx < 0) return c.json({ error: 'Invalid API key' }, 401)
  const salt = inner.slice(0, idx)
  const hash = inner.slice(idx + 1)
  const computed = await hashApiKeyForVerify(rawKey, salt)
  if (!timingSafeEq(computed, hash)) {
    return c.json({ error: 'Invalid API key' }, 401)
  }

  if (keyRow.acct_status !== 'active') {
    return c.json({ error: 'Account is suspended. Contact support@roofmanager.ca' }, 403)
  }

  // Update last_used_at (fire-and-forget)
  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?')
    .bind(Math.floor(Date.now() / 1000), keyRow.id).run().catch(() => {})

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
    created_at: keyRow.key_created_at
  }

  return { account, apiKey }
}

// ── POST /v1/reports — Submit a new roof measurement job ────────────────────

publicApiRoutes.post('/reports', async (c) => {
  const auth = await requireApiAuth(c)
  if (auth instanceof Response) return auth
  const { account, apiKey } = auth
  const db = c.env.DB

  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const { address, client_reference, callback_url } = body

  if (!address || typeof address !== 'string' || address.trim().length < 5) {
    return c.json({ error: 'address is required (minimum 5 characters)' }, 400)
  }

  if (address.trim().length > 500) {
    return c.json({ error: 'address exceeds maximum length of 500 characters' }, 400)
  }

  if (callback_url) {
    try {
      const u = new URL(callback_url)
      if (!['https:', 'http:'].includes(u.protocol)) {
        return c.json({ error: 'callback_url must be http or https' }, 400)
      }
    } catch {
      return c.json({ error: 'callback_url is not a valid URL' }, 400)
    }
  }

  // Idempotency
  if (client_reference) {
    const existing = await db.prepare(`
      SELECT * FROM api_jobs WHERE account_id = ? AND client_reference = ?
    `).bind(account.id, String(client_reference)).first<any>()
    if (existing) {
      return c.json(formatJobResponse(existing), 200)
    }
  }

  // Check concurrent job limit
  const withinLimit = await checkConcurrentJobLimit(db, account.id)
  if (!withinLimit) {
    return c.json({ error: 'Too many active jobs. Maximum 20 concurrent jobs allowed.' }, 429)
  }

  // Hold 1 credit
  const jobId = crypto.randomUUID()
  const holdResult = await holdCredit(db, account.id, jobId)
  if (!holdResult.success) {
    return c.json({ error: holdResult.error ?? 'Insufficient credits' }, 402)
  }

  // Geocode the address so the admin trace modal opens on the right property
  let lat: number | null = null
  let lng: number | null = null
  try {
    const geoRes = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address.trim())}&key=${c.env.GOOGLE_MAPS_API_KEY}`
    )
    if (geoRes.ok) {
      const geoData: any = await geoRes.json()
      const loc = geoData?.results?.[0]?.geometry?.location
      if (loc?.lat && loc?.lng) {
        lat = loc.lat
        lng = loc.lng
      }
    }
  } catch { /* geocoding failure is non-fatal; admin can still trace manually */ }

  const now = Math.floor(Date.now() / 1000)

  await db.prepare(`
    INSERT INTO api_jobs
      (id, account_id, api_key_id, status, address, lat, lng, client_reference, credits_held, created_at)
    VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, 1, ?)
  `).bind(
    jobId, account.id, apiKey.id,
    address.trim(), lat, lng,
    client_reference ? String(client_reference) : null,
    now
  ).run()

  const orderNumber = `API-${Date.now().toString(36).toUpperCase()}`
  const orderResult = await db.prepare(`
    INSERT INTO orders (
      order_number, master_company_id, property_address,
      homeowner_name, requester_name, requester_company,
      service_tier, price, status, payment_status,
      estimated_delivery, needs_admin_trace,
      source, api_job_id, latitude, longitude
    ) VALUES (?, 1, ?, ?, ?, ?, 'standard', 0, 'processing', 'paid', datetime('now', '+4 hours'), 1, 'api', ?, ?, ?)
  `).bind(
    orderNumber, address.trim(),
    account.company_name, account.company_name, 'API Client',
    jobId, lat, lng
  ).run()

  await db.prepare('UPDATE api_jobs SET order_id = ? WHERE id = ?')
    .bind(orderResult.meta.last_row_id, jobId).run()

  // Notify sales@roofmanager.ca of new API report request (fire-and-forget)
  notifyNewReportRequest(c.env, {
    order_number: orderNumber,
    property_address: address.trim(),
    requester_name: account.company_name || 'API Client',
    requester_email: account.email || '',
    service_tier: 'api',
    price: 0,
    is_trial: false
  }).catch((e: any) => console.warn('[silent-catch]', e?.message || e))

  const job = await db.prepare('SELECT * FROM api_jobs WHERE id = ?')
    .bind(jobId).first<any>()

  return c.json({
    ...formatJobResponse(job),
    credit_balance: holdResult.balance_after
  }, 202)
})

// ── GET /v1/reports/:jobId — Poll job status ────────────────────────────────

publicApiRoutes.get('/reports/:jobId', async (c) => {
  const auth = await requireApiAuth(c)
  if (auth instanceof Response) return auth
  const { account } = auth
  const jobId = c.req.param('jobId')
  const db = c.env.DB

  const job = await db.prepare(`
    SELECT * FROM api_jobs WHERE id = ? AND account_id = ?
  `).bind(jobId, account.id).first<any>()

  if (!job) return c.json({ error: 'Job not found' }, 404)

  if (job.status === 'ready' && job.pdf_expires_at && job.pdf_expires_at < Math.floor(Date.now() / 1000)) {
    const baseUrl = new URL(c.req.url).origin
    const { url, expiresAt } = await signPdfUrl(baseUrl, c.env.JWT_SECRET, job.id)
    await db.prepare('UPDATE api_jobs SET pdf_signed_url = ?, pdf_expires_at = ? WHERE id = ?')
      .bind(url, expiresAt, job.id).run()
    job.pdf_signed_url = url
    job.pdf_expires_at = expiresAt
  }

  return c.json(formatJobResponse(job))
})

// ── DELETE /v1/reports/:jobId — Cancel a queued job ────────────────────────

publicApiRoutes.delete('/reports/:jobId', async (c) => {
  const auth = await requireApiAuth(c)
  if (auth instanceof Response) return auth
  const { account } = auth
  const jobId = c.req.param('jobId')
  const db = c.env.DB

  const job = await db.prepare(`
    SELECT * FROM api_jobs WHERE id = ? AND account_id = ?
  `).bind(jobId, account.id).first<any>()

  if (!job) return c.json({ error: 'Job not found' }, 404)

  if (job.status !== 'queued') {
    return c.json({ error: `Cannot cancel a job with status '${job.status}'. Only 'queued' jobs can be cancelled.` }, 409)
  }

  await db.prepare(`UPDATE api_jobs SET status = 'cancelled', finalized_at = ? WHERE id = ?`)
    .bind(Math.floor(Date.now() / 1000), jobId).run()

  if (job.order_id) {
    await db.prepare(`UPDATE orders SET status = 'cancelled' WHERE id = ?`)
      .bind(job.order_id).run()
  }

  const refund = await refundCredit(db, account.id, jobId)

  return c.json({ job_id: jobId, status: 'cancelled', credit_balance: refund.balance_after })
})

// ── GET /v1/account — Account info and balance ──────────────────────────────

publicApiRoutes.get('/account', async (c) => {
  const auth = await requireApiAuth(c)
  if (auth instanceof Response) return auth
  const { account } = auth
  const db = c.env.DB

  const fresh = await db.prepare('SELECT credit_balance FROM api_accounts WHERE id = ?')
    .bind(account.id).first<{ credit_balance: number }>()

  const jobStats = await db.prepare(`
    SELECT status, COUNT(*) as cnt FROM api_jobs WHERE account_id = ? GROUP BY status
  `).bind(account.id).all<{ status: string; cnt: number }>()

  const stats: Record<string, number> = {}
  for (const row of jobStats.results ?? []) stats[row.status] = row.cnt

  return c.json({
    account_id: account.id,
    company_name: account.company_name,
    credit_balance: fresh?.credit_balance ?? account.credit_balance,
    status: account.status,
    webhook_url: account.webhook_url,
    job_stats: stats
  })
})

// ── POST /v1/account/webhook — Register or update webhook ──────────────────

publicApiRoutes.post('/account/webhook', async (c) => {
  const auth = await requireApiAuth(c)
  if (auth instanceof Response) return auth
  const { account } = auth
  const db = c.env.DB

  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const { webhook_url } = body
  if (!webhook_url || typeof webhook_url !== 'string') {
    return c.json({ error: 'webhook_url is required' }, 400)
  }
  try {
    const u = new URL(webhook_url)
    if (!['https:', 'http:'].includes(u.protocol)) return c.json({ error: 'webhook_url must use http or https' }, 400)
  } catch { return c.json({ error: 'webhook_url is not a valid URL' }, 400) }

  const newSecret = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  await db.prepare('UPDATE api_accounts SET webhook_url = ?, webhook_secret = ? WHERE id = ?')
    .bind(webhook_url, newSecret, account.id).run()

  return c.json({ webhook_url, webhook_secret: newSecret, message: 'Webhook registered. The webhook_secret is shown once — save it securely.' })
})

// ── GET /v1/account/usage — Credit ledger ───────────────────────────────────

publicApiRoutes.get('/account/usage', async (c) => {
  const auth = await requireApiAuth(c)
  if (auth instanceof Response) return auth
  const { account } = auth
  const db = c.env.DB

  const now = Math.floor(Date.now() / 1000)
  const from = c.req.query('from') ? parseInt(c.req.query('from')!, 10) : now - 30 * 24 * 3600
  const to   = c.req.query('to')   ? parseInt(c.req.query('to')!, 10)   : now
  const page = Math.max(0, parseInt(c.req.query('page') ?? '0', 10))

  const ledger = await getLedgerPage(db, account.id, from, to, 50, page * 50)
  return c.json({ results: ledger.results, page, from, to })
})

// ── GET /v1/pdf/:jobId — Signed PDF delivery ─────────────────────────────────

publicApiRoutes.get('/pdf/:jobId', async (c) => {
  const jobId = c.req.param('jobId')
  const exp   = c.req.query('exp') ?? null
  const sig   = c.req.query('sig') ?? null
  const db    = c.env.DB

  const valid = await verifyPdfUrl(c.env.JWT_SECRET, jobId, exp, sig)
  if (!valid) return c.json({ error: 'Invalid or expired PDF URL' }, 403)

  const job = await db.prepare('SELECT * FROM api_jobs WHERE id = ?')
    .bind(jobId).first<any>()

  if (!job || job.status !== 'ready') return c.json({ error: 'Report not found or not ready' }, 404)
  if (!job.order_id) return c.json({ error: 'Report not available' }, 404)

  const baseUrl = new URL(c.req.url).origin
  const pdfRes = await fetch(`${baseUrl}/api/reports/${job.order_id}/pdf`)
  if (!pdfRes.ok) return c.json({ error: 'Failed to retrieve report PDF' }, 502)

  return new Response(pdfRes.body, {
    headers: {
      'Content-Type': pdfRes.headers.get('Content-Type') ?? 'application/pdf',
      'Content-Disposition': `attachment; filename="roof-report-${job.id.slice(0, 8)}.pdf"`,
      'Cache-Control': 'private, no-store'
    }
  })
})

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatJobResponse(job: any) {
  const base: any = {
    job_id: job.id,
    status: job.status,
    address: job.address,
    client_reference: job.client_reference ?? null,
    created_at: job.created_at,
    finalized_at: job.finalized_at ?? null
  }
  if (job.status === 'ready') {
    base.pdf_url = job.pdf_signed_url
    base.pdf_expires_at = job.pdf_expires_at
  }
  if (job.status === 'failed') {
    base.error_code = job.error_code ?? 'GENERATION_FAILED'
    base.error_message = job.error_message ?? 'Report generation failed'
  }
  return base
}
