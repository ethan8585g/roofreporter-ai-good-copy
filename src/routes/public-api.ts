// ============================================================
// Public API Routes — /v1/*
// Third-party roof measurement API service.
// Auth: Bearer rm_live_… API key
// All routes require apiAuthMiddleware().
// ============================================================

import { Hono } from 'hono'
import type { Bindings, ApiAccount, ApiKey } from '../types'
import { apiAuthMiddleware, checkConcurrentJobLimit, generateApiKey } from '../middleware/api-auth'
import { holdCredit, refundCredit, getLedgerPage } from '../services/api-billing'
import { signPdfUrl, verifyPdfUrl } from '../services/pdf-signing'

type Variables = {
  apiAccount: ApiAccount
  apiKey: ApiKey
}

export const publicApiRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ── Apply auth middleware to all /v1/* except /v1/pdf/:jobId ────────────────
publicApiRoutes.use('/reports*', apiAuthMiddleware())
publicApiRoutes.use('/account*', apiAuthMiddleware())

// ── POST /v1/reports — Submit a new roof measurement job ────────────────────

publicApiRoutes.post('/reports', async (c) => {
  const account = c.get('apiAccount')
  const apiKey  = c.get('apiKey')
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

  // Validate callback_url if provided
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

  // Idempotency: if client_reference already exists for this account, return existing job
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

  // Hold 1 credit (atomic — returns error if insufficient balance)
  const jobId = crypto.randomUUID()
  const holdResult = await holdCredit(db, account.id, jobId)
  if (!holdResult.success) {
    return c.json({ error: holdResult.error ?? 'Insufficient credits' }, 402)
  }

  const now = Math.floor(Date.now() / 1000)

  // Create API job
  await db.prepare(`
    INSERT INTO api_jobs
      (id, account_id, api_key_id, status, address, client_reference, credits_held, created_at)
    VALUES (?, ?, ?, 'queued', ?, ?, 1, ?)
  `).bind(
    jobId,
    account.id,
    apiKey.id,
    address.trim(),
    client_reference ? String(client_reference) : null,
    now
  ).run()

  // Create an order in the main orders table so it shows in admin tracing queue
  const orderNumber = `API-${Date.now().toString(36).toUpperCase()}`
  const orderResult = await db.prepare(`
    INSERT INTO orders (
      order_number, master_company_id,
      property_address,
      homeowner_name, requester_name, requester_company,
      service_tier, price, status, payment_status,
      estimated_delivery, needs_admin_trace,
      source, api_job_id
    ) VALUES (?, 1, ?, ?, ?, ?, 'standard', 0, 'processing', 'paid', datetime('now', '+4 hours'), 1, 'api', ?)
  `).bind(
    orderNumber,
    address.trim(),
    account.company_name,       // homeowner_name = API account company
    account.company_name,       // requester_name
    'API Client',
    jobId
  ).run()

  // Link order back to job
  await db.prepare('UPDATE api_jobs SET order_id = ? WHERE id = ?')
    .bind(orderResult.meta.last_row_id, jobId).run()

  const job = await db.prepare('SELECT * FROM api_jobs WHERE id = ?')
    .bind(jobId).first<any>()

  return c.json({
    ...formatJobResponse(job),
    credit_balance: holdResult.balance_after
  }, 202)
})

// ── GET /v1/reports/:jobId — Poll job status ────────────────────────────────

publicApiRoutes.get('/reports/:jobId', async (c) => {
  const account = c.get('apiAccount')
  const jobId = c.req.param('jobId')
  const db = c.env.DB

  const job = await db.prepare(`
    SELECT * FROM api_jobs WHERE id = ? AND account_id = ?
  `).bind(jobId, account.id).first<any>()

  // Always 404 regardless of existence — prevents enumeration
  if (!job) {
    return c.json({ error: 'Job not found' }, 404)
  }

  // If ready but PDF URL has expired, regenerate it
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
  const account = c.get('apiAccount')
  const jobId = c.req.param('jobId')
  const db = c.env.DB

  const job = await db.prepare(`
    SELECT * FROM api_jobs WHERE id = ? AND account_id = ?
  `).bind(jobId, account.id).first<any>()

  if (!job) return c.json({ error: 'Job not found' }, 404)

  if (job.status !== 'queued') {
    return c.json({ error: `Cannot cancel a job with status '${job.status}'. Only 'queued' jobs can be cancelled.` }, 409)
  }

  // Cancel job and refund credit
  await db.prepare(`UPDATE api_jobs SET status = 'cancelled', finalized_at = ? WHERE id = ?`)
    .bind(Math.floor(Date.now() / 1000), jobId).run()

  // Also cancel the linked order
  if (job.order_id) {
    await db.prepare(`UPDATE orders SET status = 'cancelled' WHERE id = ?`)
      .bind(job.order_id).run()
  }

  const refund = await refundCredit(db, account.id, jobId)

  return c.json({
    job_id: jobId,
    status: 'cancelled',
    credit_balance: refund.balance_after
  })
})

// ── GET /v1/account — Account info and balance ──────────────────────────────

publicApiRoutes.get('/account', async (c) => {
  const account = c.get('apiAccount')
  const db = c.env.DB

  // Fetch fresh balance (middleware account may be slightly stale)
  const fresh = await db.prepare('SELECT credit_balance FROM api_accounts WHERE id = ?')
    .bind(account.id).first<{ credit_balance: number }>()

  // Count active jobs
  const jobStats = await db.prepare(`
    SELECT status, COUNT(*) as cnt FROM api_jobs
    WHERE account_id = ?
    GROUP BY status
  `).bind(account.id).all<{ status: string; cnt: number }>()

  const stats: Record<string, number> = {}
  for (const row of jobStats.results ?? []) {
    stats[row.status] = row.cnt
  }

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
  const account = c.get('apiAccount')
  const db = c.env.DB

  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const { webhook_url } = body
  if (!webhook_url || typeof webhook_url !== 'string') {
    return c.json({ error: 'webhook_url is required' }, 400)
  }

  try {
    const u = new URL(webhook_url)
    if (!['https:', 'http:'].includes(u.protocol)) {
      return c.json({ error: 'webhook_url must use http or https' }, 400)
    }
  } catch {
    return c.json({ error: 'webhook_url is not a valid URL' }, 400)
  }

  // Rotate webhook secret on every update
  const newSecret = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')

  await db.prepare('UPDATE api_accounts SET webhook_url = ?, webhook_secret = ? WHERE id = ?')
    .bind(webhook_url, newSecret, account.id).run()

  return c.json({
    webhook_url,
    webhook_secret: newSecret,
    message: 'Webhook registered. The webhook_secret is shown once — save it securely.'
  })
})

// ── GET /v1/account/usage — Credit ledger ───────────────────────────────────

publicApiRoutes.get('/account/usage', async (c) => {
  const account = c.get('apiAccount')
  const db = c.env.DB

  const now = Math.floor(Date.now() / 1000)
  const fromParam = c.req.query('from')
  const toParam   = c.req.query('to')
  const page      = Math.max(0, parseInt(c.req.query('page') ?? '0', 10))
  const limit     = 50

  const from = fromParam ? parseInt(fromParam, 10) : now - 30 * 24 * 3600
  const to   = toParam   ? parseInt(toParam, 10)   : now

  const ledger = await getLedgerPage(db, account.id, from, to, limit, page * limit)

  return c.json({
    results: ledger.results,
    page,
    limit,
    from,
    to
  })
})

// ── GET /v1/pdf/:jobId — Signed PDF delivery ─────────────────────────────────
// No auth middleware — validated by HMAC sig param instead.

publicApiRoutes.get('/pdf/:jobId', async (c) => {
  const jobId = c.req.param('jobId')
  const exp   = c.req.query('exp')
  const sig   = c.req.query('sig')
  const db    = c.env.DB

  const valid = await verifyPdfUrl(c.env.JWT_SECRET, jobId, exp ?? null, sig ?? null)
  if (!valid) {
    return c.json({ error: 'Invalid or expired PDF URL' }, 403)
  }

  const job = await db.prepare('SELECT * FROM api_jobs WHERE id = ?')
    .bind(jobId).first<any>()

  if (!job || job.status !== 'ready') {
    return c.json({ error: 'Report not found or not ready' }, 404)
  }

  // Proxy the PDF from the internal report endpoint
  if (!job.order_id) {
    return c.json({ error: 'Report not available' }, 404)
  }

  // Redirect to the internal PDF endpoint (superadmin access level — served by reports route)
  const baseUrl = new URL(c.req.url).origin
  const pdfInternalUrl = `${baseUrl}/api/reports/${job.order_id}/pdf`

  const pdfRes = await fetch(pdfInternalUrl)
  if (!pdfRes.ok) {
    return c.json({ error: 'Failed to retrieve report PDF' }, 502)
  }

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
