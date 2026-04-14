// ============================================================
// API Webhook Dispatch Service
// Signed outbound webhooks with exponential retry schedule.
// Header: X-RoofManager-Signature: sha256=<hex>
// ============================================================

// Retry delays in seconds: 0, 30, 5min, 30min, 2hr, 12hr
const RETRY_DELAYS_SECONDS = [0, 30, 300, 1800, 7200, 43200]
const MAX_ATTEMPTS = RETRY_DELAYS_SECONDS.length
const WEBHOOK_TIMEOUT_MS = 10_000  // 10 second timeout per attempt

// ── Signature ────────────────────────────────────────────────────────────────

async function signPayload(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  const hex = Array.from(new Uint8Array(sigBuf))
    .map(b => b.toString(16).padStart(2, '0')).join('')
  return `sha256=${hex}`
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WebhookPayload {
  event: 'report.ready' | 'report.failed'
  job_id: string
  status: string
  address: string
  client_reference: string | null
  pdf_url?: string
  pdf_expires_at?: number
  error_code?: string
  error_message?: string
  timestamp: number
}

// ── Dispatch (single attempt) ─────────────────────────────────────────────────

async function dispatchOnce(
  url: string,
  secret: string,
  payload: WebhookPayload
): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
  const body = JSON.stringify(payload)
  const signature = await signPayload(secret, body)

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RoofManager-Signature': signature,
        'X-RoofManager-Event': payload.event,
        'User-Agent': 'RoofManager-Webhook/1.0'
      },
      body,
      signal: controller.signal,
      redirect: 'error'   // never follow redirects
    })

    clearTimeout(timeoutId)
    return { ok: res.ok, statusCode: res.status }
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'Unknown error' }
  }
}

// ── Main dispatch + retry loop ────────────────────────────────────────────────
// Called after report finalization. Persists attempt count to DB.
// In Workers, this is fire-and-forget from the finalize handler
// (use waitUntil if available, otherwise background execution via Cloudflare tail).

export async function deliverWebhook(
  db: D1Database,
  jobId: string,
  webhookUrl: string,
  webhookSecret: string,
  payload: WebhookPayload,
  currentAttempts = 0
): Promise<void> {
  if (currentAttempts >= MAX_ATTEMPTS) {
    console.warn(`[webhook] max attempts reached for job ${jobId}`)
    return
  }

  const delay = RETRY_DELAYS_SECONDS[currentAttempts] * 1000
  if (delay > 0) {
    await new Promise(r => setTimeout(r, delay))
  }

  const result = await dispatchOnce(webhookUrl, webhookSecret, payload)
  const newAttempts = currentAttempts + 1

  if (result.ok) {
    const now = Math.floor(Date.now() / 1000)
    await db.prepare(`
      UPDATE api_jobs
      SET webhook_delivered_at = ?, webhook_attempts = ?
      WHERE id = ?
    `).bind(now, newAttempts, jobId).run()
    console.log(`[webhook] delivered job ${jobId} on attempt ${newAttempts}`)
    return
  }

  // Update attempt count even on failure
  await db.prepare('UPDATE api_jobs SET webhook_attempts = ? WHERE id = ?')
    .bind(newAttempts, jobId).run()

  console.warn(`[webhook] attempt ${newAttempts} failed for job ${jobId}:`, result.error ?? result.statusCode)

  // Schedule next retry (recursive, non-blocking)
  if (newAttempts < MAX_ATTEMPTS) {
    // In Cloudflare Workers the event loop keeps going as long as there are
    // pending promises, so this will execute even after response is sent.
    deliverWebhook(db, jobId, webhookUrl, webhookSecret, payload, newAttempts)
      .catch(err => console.error('[webhook] retry error', err))
  }
}

// ── Build payload helper ──────────────────────────────────────────────────────

export function buildWebhookPayload(
  job: {
    id: string
    status: string
    address: string
    client_reference: string | null
    pdf_signed_url: string | null
    pdf_expires_at: number | null
    error_code: string | null
    error_message: string | null
  }
): WebhookPayload {
  const payload: WebhookPayload = {
    event: job.status === 'ready' ? 'report.ready' : 'report.failed',
    job_id: job.id,
    status: job.status,
    address: job.address,
    client_reference: job.client_reference,
    timestamp: Math.floor(Date.now() / 1000)
  }
  if (job.status === 'ready' && job.pdf_signed_url) {
    payload.pdf_url = job.pdf_signed_url
    payload.pdf_expires_at = job.pdf_expires_at ?? undefined
  }
  if (job.status === 'failed') {
    payload.error_code = job.error_code ?? 'GENERATION_FAILED'
    payload.error_message = job.error_message ?? 'Report generation failed'
  }
  return payload
}
