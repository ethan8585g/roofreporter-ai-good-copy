// ============================================================
// EMAIL WRAPPER — single entry point for every outbound email
// the platform sends.
//
// Responsibilities (in order):
//   1. Suppression check — short-circuit if recipient is on the list
//   2. Dedup check — same recipient+subject+body within 30s ⇒ skip
//   3. Insert email_sends row as 'pending' with body + metadata
//   4. Inject tracking pixel + click-wrap links (skippable per call)
//   5. Send via Gmail OAuth2 → Resend fallback → GCP SA fallback
//   6. Update row with final status, provider_message_id, error
//
// Callers MUST pass `category` so the dashboard can group correctly.
// Body storage: full HTML for everything EXCEPT category='customer'
// when an order_id is present — those store only first 500 chars
// (report bodies are large and regeneratable from the order).
// ============================================================

import type { Bindings } from '../types'
import {
  buildTrackingPixel,
  wrapEmailLinks,
} from './email-tracking'
import {
  loadGmailCreds,
  sendGmailOAuth2,
  sendGmailOAuth2WithAttachment,
  sendViaResend,
  sendGmailEmail,
} from './email'

export type EmailCategory = 'customer' | 'internal' | 'cart' | 'alert' | 'lead' | 'manual'

export interface LogAndSendEmailParams {
  env: Bindings
  to: string
  subject: string
  html: string
  text?: string
  /**
   * Short machine identifier for this send — e.g. 'report_ready',
   * 'cart_recovery_2h', 'lead_notification', 'health_alert'.
   */
  kind: string
  category: EmailCategory
  /**
   * Override sender. Defaults to 'sales@roofmanager.ca' for customer-
   * and lead-facing categories, 'support@roofmanager.ca' otherwise.
   */
  from?: string
  customerId?: number | null
  orderId?: number | null
  /**
   * Inject the open-pixel + click-wrap links. Default true. Set false
   * for internal alert mail to Christine — her client marks-as-read
   * is instant, so opens would be misleading. Cart recovery + customer
   * email should always track.
   */
  track?: boolean
  /**
   * Skip the 30s dedup check. Default false. Useful for "compose new
   * email" UI where the admin is intentionally re-sending.
   */
  skipDedup?: boolean
  /**
   * One or more file attachments. When present, uses the Gmail
   * multipart/mixed send path. Resend fallback is skipped because
   * we don't currently wire Resend attachments through.
   */
  attachments?: Array<{ filename: string; mimeType: string; bytes: Uint8Array }>
  /**
   * Optional Reply-To. Used by lead notifications so super-admin can
   * reply directly to the lead from their inbox.
   */
  replyTo?: string
  /**
   * If this is a manual resend of an earlier email_sends row, pass
   * the original id here so the audit chain stays connected.
   */
  retryOfId?: number
  /**
   * Marks where the row was created — 'platform' (auto-fired by a
   * code path), 'composer' (admin-typed in the dashboard), or
   * 'gmail_mirror' (back-filled from Gmail Sent folder sync).
   */
  source?: 'platform' | 'composer' | 'gmail_mirror'
}

export interface LogAndSendEmailResult {
  ok: boolean
  emailSendId: number | null
  trackingToken: string | null
  status: 'sent' | 'failed' | 'suppressed' | 'deduped' | 'pending'
  error?: string
  providerMessageId?: string
  method?: 'gmail_oauth2' | 'resend' | 'gcp_sa' | 'none'
}

function randomToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * SHA-256(recipient|subject|body) → first 16 hex chars. Used to skip
 * back-to-back duplicate sends (noisy monitor alerts, accidental
 * double-fires). Cheap collisions are fine — we only check against
 * rows from the last 30 seconds.
 */
async function dedupKeyFor(recipient: string, subject: string, html: string): Promise<string> {
  const enc = new TextEncoder().encode(`${recipient.toLowerCase()}|${subject}|${html}`)
  const digest = await crypto.subtle.digest('SHA-256', enc)
  const bytes = new Uint8Array(digest)
  let hex = ''
  for (let i = 0; i < 8; i++) hex += bytes[i].toString(16).padStart(2, '0')
  return hex
}

function defaultFromFor(category: EmailCategory): string {
  if (category === 'customer' || category === 'lead' || category === 'manual') return 'sales@roofmanager.ca'
  return 'support@roofmanager.ca'
}

/**
 * Truncate large report bodies before storing in body_html. Reports
 * average 50-200KB and can be rebuilt from order_id when the admin
 * clicks "Regenerate" in the email-tracker modal.
 */
function bodyForStorage(html: string, category: EmailCategory, orderId: number | null | undefined): string {
  if (category === 'customer' && orderId) {
    if (html.length > 4000) return html.slice(0, 4000) + '\n<!-- TRUNCATED: regenerate from order_id=' + orderId + ' -->'
  }
  // 256KB cap for everything else — protects D1 row size on edge cases
  if (html.length > 256_000) return html.slice(0, 256_000) + '\n<!-- TRUNCATED: max body length -->'
  return html
}

export async function isSuppressed(env: Bindings, email: string): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      `SELECT id FROM email_suppressions WHERE LOWER(email) = LOWER(?) AND released_at IS NULL LIMIT 1`
    ).bind(email).first()
    return !!row
  } catch {
    return false
  }
}

/**
 * Main entry point. Never throws — failures are recorded on the row
 * and surfaced via `result.error`. Returns the row id so the caller
 * can correlate later (e.g. provider webhooks → row update).
 */
export async function logAndSendEmail(p: LogAndSendEmailParams): Promise<LogAndSendEmailResult> {
  const env = p.env
  const track = p.track !== false
  const category = p.category
  const source = p.source || 'platform'
  const from = p.from || defaultFromFor(category)
  const to = (p.to || '').trim()

  if (!to || !/.+@.+\..+/.test(to)) {
    return { ok: false, emailSendId: null, trackingToken: null, status: 'failed', error: 'Invalid recipient address', method: 'none' }
  }

  // 1. Suppression
  if (await isSuppressed(env, to)) {
    const id = await insertRow(env, {
      ...p, from, html: p.html, trackingToken: null,
      status: 'suppressed', source, error: 'Recipient on suppression list',
    })
    return { ok: false, emailSendId: id, trackingToken: null, status: 'suppressed', error: 'Recipient on suppression list', method: 'none' }
  }

  // 2. Dedup
  let dedupKey: string | null = null
  if (!p.skipDedup) {
    try {
      dedupKey = await dedupKeyFor(to, p.subject, p.html)
      const recent = await env.DB.prepare(
        `SELECT id FROM email_sends
         WHERE dedup_key = ?
           AND sent_at >= datetime('now', '-30 seconds')
           AND status IN ('sent','pending')
         LIMIT 1`
      ).bind(dedupKey).first()
      if (recent) {
        const id = await insertRow(env, {
          ...p, from, html: p.html, trackingToken: null,
          status: 'deduped', source, error: `Duplicate of email_sends.id=${(recent as any).id} within 30s`,
          dedupKey,
        })
        return { ok: false, emailSendId: id, trackingToken: null, status: 'deduped', error: 'Duplicate send skipped', method: 'none' }
      }
    } catch {
      // dedup failure ⇒ proceed without dedup
    }
  }

  // 3. Insert pending row
  const trackingToken = track ? randomToken() : null
  let pixel = ''
  let trackedHtml = p.html
  if (trackingToken) {
    pixel = buildTrackingPixel(trackingToken)
    trackedHtml = wrapEmailLinks(p.html + '\n' + pixel, trackingToken)
  }

  const rowId = await insertRow(env, {
    ...p, from, html: p.html, trackingToken,
    status: 'pending', source, dedupKey,
  })

  // 4. Send via Gmail OAuth2 → Resend → GCP SA
  const creds = await loadGmailCreds(env).catch(() => null)
  let sent = false
  let method: 'gmail_oauth2' | 'resend' | 'gcp_sa' | 'none' = 'none'
  let providerMessageId = ''
  let lastError = ''

  if (creds?.clientId && creds.clientSecret && creds.refreshToken) {
    try {
      let r: { id: string }
      if (p.attachments && p.attachments.length) {
        r = await sendGmailOAuth2WithAttachment(
          creds.clientId, creds.clientSecret, creds.refreshToken,
          to, p.subject, trackedHtml,
          p.attachments.length === 1 ? p.attachments[0] : p.attachments,
          from, p.replyTo || null,
        )
      } else {
        r = await sendGmailOAuth2(
          creds.clientId, creds.clientSecret, creds.refreshToken,
          to, p.subject, trackedHtml,
          from, env,
        )
      }
      sent = true
      method = 'gmail_oauth2'
      providerMessageId = r?.id || ''
    } catch (e: any) {
      lastError = `Gmail OAuth2: ${e?.message || e}`
    }
  }

  if (!sent && env.RESEND_API_KEY && (!p.attachments || !p.attachments.length)) {
    try {
      await sendViaResend(env.RESEND_API_KEY, to, p.subject, trackedHtml, from)
      sent = true
      method = 'resend'
    } catch (e: any) {
      lastError = (lastError ? lastError + ' | ' : '') + `Resend: ${e?.message || e}`
    }
  }

  if (!sent && env.GCP_SERVICE_ACCOUNT_JSON && (!p.attachments || !p.attachments.length)) {
    try {
      await sendGmailEmail(env.GCP_SERVICE_ACCOUNT_JSON, to, p.subject, trackedHtml, from)
      sent = true
      method = 'gcp_sa'
    } catch (e: any) {
      lastError = (lastError ? lastError + ' | ' : '') + `GCP SA: ${e?.message || e}`
    }
  }

  // 5. Update row with final state
  try {
    if (sent) {
      await env.DB.prepare(
        `UPDATE email_sends
         SET status = 'sent', provider_message_id = ?, send_error = NULL, sent_at = datetime('now')
         WHERE id = ?`
      ).bind(providerMessageId || null, rowId).run()
    } else {
      await env.DB.prepare(
        `UPDATE email_sends
         SET status = 'failed', send_error = ?
         WHERE id = ?`
      ).bind((lastError || 'All transports failed').slice(0, 1000), rowId).run()
    }
  } catch {
    // row update failure is non-fatal; main signal still in app logs
  }

  return {
    ok: sent,
    emailSendId: rowId,
    trackingToken,
    status: sent ? 'sent' : 'failed',
    method,
    providerMessageId,
    error: sent ? undefined : (lastError || 'All transports failed'),
  }
}

/**
 * Lower-level row insert used by all three branches (success, dedup,
 * suppressed). Kept tiny + tolerant — failures don't abort the send.
 */
async function insertRow(
  env: Bindings,
  args: LogAndSendEmailParams & {
    from: string
    html: string
    trackingToken: string | null
    status: string
    source: string
    error?: string
    dedupKey?: string | null
  },
): Promise<number | null> {
  try {
    const storedBody = bodyForStorage(args.html, args.category, args.orderId ?? null)
    const result = await env.DB.prepare(
      `INSERT INTO email_sends
        (customer_id, recipient, kind, subject, tracking_token, sent_at,
         body_html, body_text, from_addr, category, order_id, retry_of_id,
         status, source, dedup_key, send_error)
       VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      args.customerId ?? null,
      args.to.slice(0, 320),
      args.kind.slice(0, 100),
      (args.subject || '').slice(0, 500),
      args.trackingToken || ('untracked-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)),
      storedBody,
      args.text ? args.text.slice(0, 64_000) : null,
      args.from.slice(0, 320),
      args.category,
      args.orderId ?? null,
      args.retryOfId ?? null,
      args.status,
      args.source,
      args.dedupKey ?? null,
      args.error ? args.error.slice(0, 1000) : null,
    ).run()
    return Number((result as any).meta?.last_row_id || 0) || null
  } catch (e: any) {
    console.warn('[email-wrapper] insertRow failed:', e?.message || e)
    return null
  }
}

/**
 * Re-send an email by id. Reconstructs the body from the stored row
 * (or, for truncated customer-report rows, the caller passes a fresh
 * html in `overrideHtml`). Links back to the original via retry_of_id.
 */
export async function resendEmail(env: Bindings, emailSendId: number, opts?: {
  overrideHtml?: string
  adminId?: number | null
}): Promise<LogAndSendEmailResult> {
  const row: any = await env.DB.prepare(
    `SELECT * FROM email_sends WHERE id = ?`
  ).bind(emailSendId).first()
  if (!row) {
    return { ok: false, emailSendId: null, trackingToken: null, status: 'failed', error: 'Original row not found', method: 'none' }
  }
  const html = opts?.overrideHtml || row.body_html || ''
  if (!html) {
    return { ok: false, emailSendId: null, trackingToken: null, status: 'failed', error: 'No body stored and no overrideHtml provided', method: 'none' }
  }
  return logAndSendEmail({
    env,
    to: row.recipient,
    subject: row.subject || '(no subject)',
    html,
    kind: row.kind,
    category: (row.category as EmailCategory) || 'manual',
    from: row.from_addr || undefined,
    customerId: row.customer_id,
    orderId: row.order_id,
    retryOfId: emailSendId,
    skipDedup: true,
    source: 'composer',
  })
}
